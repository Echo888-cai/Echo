/**
 * Agent - 函数调用 Agent 循环
 *
 * 移植自 honeclaw 的 FunctionCallingAgent 模式。
 *
 * 工作流程：
 * 1. 构建 system prompt + 上下文 + 用户输入
 * 2. 调用 LLM（携带可用工具 schema）
 * 3. LLM 返回文本 或 工具调用
 * 4. 如果是工具调用：执行工具 → 结果加入消息 → 回到步骤 2
 * 5. 如果是文本：返回最终结果
 */
export class Agent {
  /**
   * @param {object} opts
   * @param {string} opts.systemPrompt - 系统提示词
   * @param {import("./toolRegistry.js").ToolRegistry} opts.tools - 工具注册表
   * @param {import("./provider.js").LLMProvider} opts.provider - LLM provider
   * @param {number} opts.maxIterations - 最大工具调用轮次（默认 10）
   */
  constructor({ systemPrompt, tools, provider, maxIterations = 10 }) {
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.provider = provider;
    this.maxIterations = maxIterations;
  }

  /**
   * 执行一次 Agent 调用
   * @param {string} input - 用户输入
   * @param {object} [context={}] - 上下文
   * @param {Array} [context.messages] - 历史消息 [{ role, content }]
   * @returns {Promise<{content: string, toolCallsMade: Array, iterations: number, success: boolean}>}
   */
  async run(input, context = {}) {
    const messages = [
      { role: "system", content: this.buildSystemPrompt(context) },
      ...this.buildContextMessages(context),
      { role: "user", content: input }
    ];

    const toolCallsMade = [];
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;
      const response = await this.provider.chat(messages, this.tools.getToolsSchema());

      // 模型返回了工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        const assistantMsg = {
          role: "assistant",
          content: response.content || null,
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }))
        };
        messages.push(assistantMsg);

        for (const tc of response.toolCalls) {
          const name = tc.function.name;
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            args = {};
          }

          try {
            const result = await this.tools.executeTool(name, args);
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: typeof result === "string" ? result : JSON.stringify(result)
            });
            toolCallsMade.push({ name, arguments: args, result });
          } catch (err) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ error: err.message })
            });
            toolCallsMade.push({ name, arguments: args, error: err.message });
          }
        }
        continue;
      }

      // 模型返回了文本 —— 完成
      return {
        content: response.content,
        toolCallsMade,
        iterations,
        success: true
      };
    }

    return {
      content: "已达到最大迭代次数，没有生成完整回答。",
      toolCallsMade,
      iterations,
      success: false
    };
  }

  /**
   * 构建系统提示词（可被子类覆写加入动态上下文）
   */
  buildSystemPrompt(context) {
    const toolNames = this.tools.listToolNames().join(", ");
    return `${this.systemPrompt}

可用工具：${toolNames}

规则：
- 如果需要获取数据，使用对应工具
- 分析时区分事实、假设和观点
- 不要编造数据，缺失数据标注原因
- 最终回答用中文`;
  }

  /**
   * 从上下文构建历史消息
   */
  buildContextMessages(context) {
    const msgs = [];
    if (context.messages && Array.isArray(context.messages)) {
      for (const m of context.messages) {
        if (m.role === "user" || m.role === "assistant") {
          msgs.push({ role: m.role, content: m.content });
        }
      }
    }
    return msgs;
  }
}
