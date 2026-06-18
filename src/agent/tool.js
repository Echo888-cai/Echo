/**
 * Tool 基类 - 移植自 honeclaw Tool trait 模式
 *
 * 所有工具必须实现：
 * - name(): 工具名称（英文）
 * - description(): 工具描述（给 LLM 看）
 * - parameters(): 参数列表 [{ name, type, description, required, enum, items }]
 * - execute(args): 执行方法
 *
 * 自动生成 OpenAI Function Calling schema。
 */
export class Tool {
  name() { throw new Error("子类必须实现 name()"); }
  description() { throw new Error("子类必须实现 description()"); }
  parameters() { return []; }
  async execute(_args) { throw new Error("子类必须实现 execute()"); }

  /** 转换为 OpenAI Function Calling 格式 */
  toOpenAISchema() {
    const properties = {};
    const required = [];
    for (const p of this.parameters()) {
      const prop = { type: p.type, description: p.description };
      if (p.enum) prop.enum = p.enum;
      if (p.items) prop.items = p.items;
      properties[p.name] = prop;
      if (p.required !== false) required.push(p.name);
    }
    return {
      type: "function",
      function: {
        name: this.name(),
        description: this.description(),
        parameters: { type: "object", properties, required }
      }
    };
  }
}
