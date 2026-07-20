/**
 * 模型网关：providerConfig 选择、OpenAI 兼容流式读取与统一的 modelAnswer 入口。
 *
 * 从 research.ts 抽出成独立模块，原因有二：
 * 1. companyResolution（服务端公司解析的 LLM 兜底）也需要 modelAnswer，而 research.ts
 *    反过来要调 companyResolution——不抽出来就是循环依赖；
 * 2. 模型调用与研究编排本来就是两层（一个是 IO 网关，一个是用例），混在一个 1000 行
 *    文件里只是历史沿革。
 *
 * 行为与抽出前逐字一致：审计写 llm_audit，失败返回 null 而不是抛错。
 */
import { insertLlmAudit } from "@echo/db/repositories/llmAuditRepository.js";

export function providerConfig() {
  if (process.env.DEEPSEEK_API_KEY) return { id: "deepseek", key: process.env.DEEPSEEK_API_KEY, base: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" };
  if (process.env.OPENAI_API_KEY) return { id: "openai", key: process.env.OPENAI_API_KEY, base: "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-5-mini" };
  if (process.env.MODEL_API_KEY && process.env.MODEL_BASE_URL) return { id: "generic", key: process.env.MODEL_API_KEY, base: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME || "default" };
  return null;
}

export type TokenCallback = (delta: string) => void | Promise<void>;

// Provider deltas often arrive sub-word (DeepSeek/OpenAI can emit hundreds of
// tiny deltas for a page of Markdown). Forwarding every single one as its own
// SSE frame/UI state update is what the client re-renders on — at that
// frequency it re-parses the whole accumulated Markdown on every delta and
// can peg the main thread badly enough to make the page briefly unresponsive
// (found via a real E2E regression, not a hunch). Coalescing into ~24-char
// chunks keeps the real first-token-latency win (still flushed as they fill,
// not batched to the end) while keeping event/render frequency in the same
// ballpark as the old fixed-size chunker this replaces.
const STREAM_CHUNK_SIZE = 24;

/**
 * Reads an OpenAI-compatible `stream: true` chat/completions body (SSE frames,
 * `data: {...}\n\n`, terminated by `data: [DONE]`), forwarding coalesced
 * content chunks to `onToken` as they arrive and accumulating the full text —
 * so the caller gets real token-by-token latency instead of waiting for the
 * whole response before the first byte reaches the client.
 *
 * `visibleText` 由调用方注入（研究链路传 streamSafeResearchText，剥 FALSIFIERS_JSON
 * 机器行），网关本身不掺业务裁剪逻辑。
 */
async function readStreamedCompletion(response: Response, onToken?: TokenCallback, visibleText: (content: string) => string = (s) => s) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("model stream has no body");
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let pendingChars = 0;
  let emitted = 0;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const flush = async () => {
    pendingChars = 0;
    if (!onToken) return;
    const visible = visibleText(content);
    if (visible.length <= emitted) return;
    const chunk = visible.slice(emitted);
    emitted = visible.length;
    await onToken(chunk);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: any;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = String(json.choices?.[0]?.delta?.content || "");
      if (delta) {
        content += delta;
        pendingChars += delta.length;
        if (pendingChars >= STREAM_CHUNK_SIZE) await flush();
      }
      if (json.usage) usage = json.usage;
    }
  }
  await flush();
  return { content: content.trim(), usage };
}

export type ModelAnswerOptions = {
  kind?: "chat" | "router" | "report" | "resolver";
  thinking?: boolean;
  maxTokens?: number;
  json?: boolean;
  /** 流式时对累计正文做可见性裁剪（如剥机器行）后再增量下发。 */
  visibleText?: (content: string) => string;
};

export async function modelAnswer(system: string, user: string, userId: string, onToken?: TokenCallback, options: ModelAnswerOptions = {}) {
  const provider = providerConfig();
  if (!provider) return null;
  const started = Date.now();
  const streaming = Boolean(onToken);
  try {
    const response = await fetch(`${provider.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${provider.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: provider.model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }],
        ...(provider.id === "deepseek" && options.thinking !== undefined ? { thinking: { type: options.thinking ? "enabled" : "disabled" } } : {}),
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
        ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {})
      }),
      signal: AbortSignal.timeout(options.kind === "report" ? 120_000 : 60_000)
    });
    if (!response.ok) throw new Error(`model ${response.status}`);
    let content: string;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (streaming) {
      ({ content, usage } = await readStreamedCompletion(response, onToken, options.visibleText));
    } else {
      const body: any = await response.json();
      content = String(body.choices?.[0]?.message?.content || "").trim();
      usage = body.usage;
    }
    await insertLlmAudit({ provider: provider.id, model: provider.model, kind: options.kind || "chat", status: "ok", latencyMs: Date.now() - started,
      inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens, userId });
    return content ? { content, provider: provider.id, model: provider.model } : null;
  } catch (error) {
    await insertLlmAudit({ provider: provider.id, model: provider.model, kind: options.kind || "chat", status: "error", latencyMs: Date.now() - started,
      errorDetail: error instanceof Error ? error.message : String(error), userId });
    return null;
  }
}

/** Strips a ```json fence if present and parses; null on any parse failure. */
export function parseJsonObject(content: string) {
  const text = String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(text); } catch { return null; }
}
