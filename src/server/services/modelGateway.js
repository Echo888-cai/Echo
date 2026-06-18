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
 */

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
      throw new Error(`${provider.label} 请求超时 (${PROVIDER_TIMEOUT_MS}ms)`);
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
    try {
      const result = await tryProvider(provider);
      // Clean up
      for (const p of providers) delete p.cachedMessages;
      return result;
    } catch (err) {
      errors.push(`${provider.label}: ${err.message}`);
    }
  }

  // Clean up
  for (const p of providers) delete p.cachedMessages;

  // All providers failed — log errors and return null
  console.warn("模型网关: 所有 provider 均失败", errors.join(" | "));
  return null;
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
