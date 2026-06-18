/**
 * ToolRegistry - 工具注册与发现
 *
 * 移植自 honeclaw 的 ToolRegistry。
 * 管理所有可用工具的注册、查询和 schema 导出。
 */
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /** 注册一个工具 */
  register(tool) {
    const name = tool.name();
    this.tools.set(name, tool);
  }

  /** 按名称获取工具 */
  get(name) {
    return this.tools.get(name) || null;
  }

  /** 列出所有工具名称 */
  listToolNames() {
    return [...this.tools.keys()];
  }

  /** 获取所有工具的 OpenAI Function Calling schema */
  getToolsSchema() {
    return [...this.tools.values()].map(t => t.toOpenAISchema());
  }

  /** 执行指定工具 */
  async executeTool(name, args) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }
    return await tool.execute(args);
  }
}
