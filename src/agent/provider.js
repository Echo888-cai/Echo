/**
 * LLM Provider 抽象 - 移植自 honeclaw LlmProvider trait
 *
 * 支持 OpenAI 兼容接口的模型（OpenAI、DeepSeek 等）。
 * 自动从环境变量读取配置。
 */

const DEEPSEEK_BASE = "https://api.deepseek.com";

export class LLMProvider {
  constructor(config = {}) {
    this.provider = config.provider || "openai";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "gpt-4.1-mini";
    this.baseURL = config.baseURL || null;
  }

  /** 检查是否有可用的 API Key */
  get isAvailable() {
    return Boolean(this.apiKey);
  }

  /** 从环境变量创建 Provider */
  static fromEnv() {
    const deepSeekKey = process.env.DEEPSEEK_API_KEY;
    const openAIKey = process.env.OPENAI_API_KEY;
    const openAIModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const deepSeekModel = process.env.DEEPSEEK_MODEL;

    if (deepSeekKey) {
      return new LLMProvider({
        provider: "deepseek",
        apiKey: deepSeekKey,
        model: deepSeekModel || "deepseek-v4-pro",
        baseURL: DEEPSEEK_BASE
      });
    }

    if (openAIKey) {
      return new LLMProvider({
        provider: "openai",
        apiKey: openAIKey,
        model: openAIModel
      });
    }

    return new LLMProvider({ provider: "openai", apiKey: "" });
  }

  /**
   * 非流式聊天调用
   * @param {Array} messages - OpenAI 格式消息数组
   * @param {Array} tools - OpenAI Function Calling 工具 schema
   * @returns {Promise<{content: string, toolCalls: Array, usage: object|null, finishReason: string}>}
   */
  async chat(messages, tools = []) {
    if (!this.apiKey) {
      throw new Error("未配置 API Key，无法调用模型");
    }

    const url = this.baseURL
      ? `${this.baseURL}/chat/completions`
      : "https://api.openai.com/v1/chat/completions";

    const body = {
      model: this.model,
      messages,
      temperature: 0.2,
      max_tokens: 8192
    };

    if (tools.length > 0) body.tools = tools;

    if (this.provider === "deepseek") {
      body.reasoning_effort = "high";
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`模型调用失败 [${response.status}]: ${errText.slice(0, 200)}`);
    }

    const result = await response.json();
    const choice = result.choices?.[0];
    const message = choice?.message || {};

    return {
      content: message.content || "",
      toolCalls: message.tool_calls || [],
      usage: result.usage || null,
      finishReason: choice?.finish_reason || "stop"
    };
  }
}
