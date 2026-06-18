/**
 * Agent 系统入口
 *
 * 集合所有工具、Provider 和 Agent，对外暴露简洁的工厂方法。
 * 移植自 honeclaw 的模块化 Agent 架构。
 */
import { Tool } from "./tool.js";
import { ToolRegistry } from "./toolRegistry.js";
import { LLMProvider } from "./provider.js";
import { Agent } from "./agent.js";
import { MarketTool } from "./tools/market.js";
import { FinancialsTool } from "./tools/financials.js";
import { NewsTool } from "./tools/news.js";
import { CompanyTool } from "./tools/company.js";
import { ResearchTool } from "./tools/research.js";

export { Tool, ToolRegistry, LLMProvider, Agent, MarketTool, FinancialsTool, NewsTool, CompanyTool, ResearchTool };

/**
 * 创建预配置的 Agent 实例
 *
 * @param {object} [opts]
 * @param {string} [opts.systemPrompt] - 自定义 system prompt（使用默认值）
 * @param {import("./provider.js").LLMProvider} [opts.provider] - LLM provider（默认从环境变量创建）
 * @param {number} [opts.maxIterations] - 最大工具调用轮次
 * @returns {{ agent: Agent, provider: LLMProvider, registry: ToolRegistry } | null}
 */
export function createResearchAgent(opts = {}) {
  const provider = opts.provider || LLMProvider.fromEnv();
  if (!provider || !provider.isAvailable) {
    return null;
  }

  const registry = new ToolRegistry();
  registry.register(new MarketTool());
  registry.register(new FinancialsTool());
  registry.register(new NewsTool());
  registry.register(new CompanyTool());
  registry.register(new ResearchTool());

  const systemPrompt = opts.systemPrompt || `你是一个港股价值投资研究助手，名叫 Luvio。

你的工作流程：
1. 先用 get_company_profile 获取公司基本信息
2. 用 get_market_data 获取行情数据
3. 用 get_financial_data 获取财务数据
4. 用 get_news_and_filings 获取新闻和公告
5. 获取齐全数据后，调用 summarize_research 生成最终报告

规则：
- 可以同时调用多个工具（并行），提高效率
- 所有数据到位后才调用 summarize_research
- 数据缺失不能编造，标注原因
- 用中文回答
- 保持冷静、客观、基于证据的判断`;

  const agent = new Agent({
    systemPrompt,
    tools: registry,
    provider,
    maxIterations: opts.maxIterations || 15
  });

  return { agent, provider, registry };
}
