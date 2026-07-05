/**
 * Model gateway — multi-provider with automatic fallback chain.
 *
 * Provider order (configured via env) with automatic failover:
 *   1. GLM (if GLM_API_KEY is set) — uses OpenAI-compatible API
 *   2. DeepSeek (if DEEPSEEK_API_KEY is set)
 *   3. OpenAI (if OPENAI_API_KEY is set)
 *
 * All providers use OpenAI-compatible chat completions format.
 * Each call has a timeout. On failure, the next provider in the chain is tried.
 * Returns `{ provider, model, content, latencyMs }` or `null` if all fail.
 *
 * E4：每次 provider 尝试（成功或失败，含 failover 链路里被跳过前的那几跳）都落一行
 * 到 llm_audit（`insertLlmAudit`，失败不抛错），取代此前纯 console 的运维盲区。
 */
import { insertLlmAudit } from "../repositories/llmAuditRepository.js";

const PROVIDER_TIMEOUT_MS = 45000;

/** Define each provider with its base URL and model default. */
const PROVIDERS = [
  {
    id: "glm",
    envKey: "GLM_API_KEY",
    envModel: "GLM_MODEL",
    defaultModel: "glm-4-plus",
    baseURL: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    urlPath: "/chat/completions",
    priority: 10,
    label: "GLM (智谱)"
  },
  {
    id: "deepseek",
    envKey: "DEEPSEEK_API_KEY",
    envModel: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-v4-pro",
    baseURL: "https://api.deepseek.com",
    urlPath: "/chat/completions",
    priority: 20,
    label: "DeepSeek"
  },
  {
    id: "openai",
    envKey: "OPENAI_API_KEY",
    envModel: "OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
    baseURL: "https://api.openai.com",
    urlPath: "/v1/chat/completions",
    priority: 30,
    label: "OpenAI"
  },
  {
    id: "generic",
    envKey: "MODEL_API_KEY",
    envModel: "MODEL_MODEL",
    defaultModel: "default",
    baseURL: process.env.MODEL_BASE_URL || "",
    urlPath: "/chat/completions",
    priority: 40,
    label: "Generic OpenAI-compatible"
  }
];

/** Apply model-specific overrides (reasoning effort for DeepSeek, etc.) */
function buildRequestBody(providerId, model, messages) {
  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 8192
  };
  if (providerId === "deepseek" && /^deepseek-v4/i.test(model)) {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = "high";
  }
  return body;
}

/** Get the list of configured providers, sorted by priority. */
function configuredProviders() {
  const configured = PROVIDERS
    .filter((p) => {
      if (p.id === "generic") return !!process.env.MODEL_BASE_URL && !!process.env.MODEL_API_KEY;
      return !!process.env[p.envKey];
    })
    .sort((a, b) => a.priority - b.priority);
  return configured;
}

/**
 * Call a single provider. Returns null on any error (timeout/network/API).
 */
async function tryProvider(provider) {
  const apiKey = process.env[provider.envKey];
  const model = process.env[provider.envModel] || provider.defaultModel;
  const url = `${provider.baseURL}${provider.urlPath}`;
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildRequestBody(provider.id, model, provider.cachedMessages || [])),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${response.status} ${errText.slice(0, 200)}`);
    }

    const result = await response.json();
    const latencyMs = Date.now() - start;
    return {
      provider: provider.id,
      model,
      content: result.choices?.[0]?.message?.content || result.output_text || result.output?.[0]?.content || "",
      latencyMs,
      label: provider.label
    };
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      throw new Error(`${provider.label} 请求超时 (${PROVIDER_TIMEOUT_MS}ms)`, { cause: error });
    }
    throw error;
  }
}

/**
 * callModel — try each configured provider in priority order until one succeeds.
 *
 * @param {object} opts
 * @param {string} opts.system - system prompt
 * @param {string} opts.user - user prompt
 * @returns {Promise<{provider, model, content, latencyMs, label}|null>}
 */
export async function callModel({ system, user }) {
  const providers = configuredProviders();
  if (!providers.length) return null;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];

  // Inject messages into each provider config
  for (const p of providers) p.cachedMessages = messages;

  const errors = [];
  for (const provider of providers) {
    const attemptStart = Date.now();
    try {
      const result = await tryProvider(provider);
      insertLlmAudit({ provider: provider.id, model: result.model, kind: "chat", status: "ok", latencyMs: result.latencyMs });
      // Clean up
      for (const p of providers) delete p.cachedMessages;
      return result;
    } catch (err) {
      insertLlmAudit({ provider: provider.id, model: process.env[provider.envModel] || provider.defaultModel, kind: "chat", status: "error", latencyMs: Date.now() - attemptStart, errorDetail: err.message });
      errors.push(`${provider.label}: ${err.message}`);
    }
  }

  // Clean up
  for (const p of providers) delete p.cachedMessages;

  // All providers failed — log errors and return null
  console.warn("模型网关: 所有 provider 均失败", errors.join(" | "));
  return null;
}

const STREAM_TIMEOUT_MS = 60000; // 流式整体预算更宽：思考型模型出首字慢，但总时长允许更长。

/**
 * callModelStream — 与 callModel 同样的 provider 优先级 + 失败回退，但用 OpenAI 兼容的
 * `stream: true` 增量返回。每个内容增量回调 onToken(delta)，最终返回 { provider, model,
 * content, latencyMs, label }；全部失败返回 null。
 *
 * 注意：只取 delta.content（最终答案），忽略 deepseek 的 delta.reasoning_content（思考过程）。
 */
export async function callModelStream({ system, user, onToken, onReasoning }) {
  const providers = configuredProviders();
  if (!providers.length) return null;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  const errors = [];
  for (const provider of providers) {
    const attemptStart = Date.now();
    try {
      const result = await streamProvider(provider, messages, onToken, onReasoning);
      insertLlmAudit({ provider: provider.id, model: result.model, kind: "stream", status: "ok", latencyMs: result.latencyMs });
      return result;
    } catch (err) {
      insertLlmAudit({ provider: provider.id, model: process.env[provider.envModel] || provider.defaultModel, kind: "stream", status: "error", latencyMs: Date.now() - attemptStart, errorDetail: err.message });
      errors.push(`${provider.label}: ${err.message}`);
    }
  }
  console.warn("模型网关(流式): 所有 provider 均失败", errors.join(" | "));
  return null;
}

async function streamProvider(provider, messages, onToken, onReasoning) {
  const apiKey = process.env[provider.envKey];
  const model = process.env[provider.envModel] || provider.defaultModel;
  const url = `${provider.baseURL}${provider.urlPath}`;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  try {
    const body = buildRequestBody(provider.id, model, messages);
    body.stream = true;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      const errText = response.ok ? "无响应体" : await response.text().catch(() => "");
      throw new Error(`${response.status} ${String(errText).slice(0, 200)}`);
    }

    let full = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      // SSE 帧以 \n 分隔，内容行以 "data:" 开头；[DONE] 收尾。
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { buffer = ""; break; }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta || {};
          // 思考型模型（deepseek-v4）先吐 reasoning_content（思考过程），content 才是最终
          // 答案。reasoning 期不进 full、只回调 onReasoning，让前端显示"正在推理"而非空白。
          if (delta.reasoning_content) onReasoning?.(delta.reasoning_content);
          if (delta.content) { full += delta.content; onToken?.(delta.content); }
        } catch { /* 心跳/分片非 JSON 行，忽略 */ }
      }
    }
    clearTimeout(timer);
    if (!full) throw new Error("流式返回空内容");
    return { provider: provider.id, model, content: full, latencyMs: Date.now() - start, label: provider.label };
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") throw new Error(`${provider.label} 流式请求超时 (${STREAM_TIMEOUT_MS}ms)`, { cause: error });
    throw error;
  }
}

/** Return the status summary for /api/status (which providers are configured). */
export function getProviderStatus() {
  const providers = configuredProviders();
  return {
    configured: providers.length > 0,
    providers: providers.map((p) => ({
      id: p.id,
      label: p.label,
      model: process.env[p.envModel] || p.defaultModel
    })),
    // Legacy single flag for backward compat
    provider: providers[0]?.id || null
  };
}
