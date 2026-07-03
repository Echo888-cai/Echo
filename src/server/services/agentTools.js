// EA-1 工具层：把已有能力包成统一签名 { name, description, inputSchema, run() }，
// 供后续 EA-2 受控规划器按框架/问题类型串联调用。全部是对现有服务的薄包装——
// 不重复实现业务逻辑，出错时 run() 返回 { status: "error", error } 而不是抛出，
// 让规划器能拿"已取到的部分 + 诚实缺口"降级作答，而不是整轮失败。
import { findCompany, companyByTicker } from "../../data.js";
import { runAgent } from "./agentService.js";
import { runScreener, runMacro } from "./discovery.js";
import { buildCompareSummary } from "../routes/chat.js";
import { researchWebEvidence } from "./webEvidenceService.js";

async function safeRun(fn) {
  try {
    return { status: "ok", data: await fn() };
  } catch (error) {
    return { status: "error", error: error?.message || String(error) };
  }
}

export const agentTools = {
  resolveCompany: {
    name: "resolveCompany",
    description: "把自由文本/代码解析成已知公司档案（ticker/名称/板块）。",
    inputSchema: { query: "string" },
    run: ({ query } = {}) =>
      safeRun(() => {
        const company = companyByTicker(query) || findCompany(query);
        if (!company) throw new Error(`未识别公司：${query}`);
        return company;
      })
  },
  researchCompany: {
    name: "researchCompany",
    description: "对指定公司跑完整研究管道（数据聚合 + 本地/模型决策面板）。",
    inputSchema: { question: "string", company: "object", options: "object?" },
    run: ({ question, company, options = {} } = {}) =>
      safeRun(() => runAgent({ question, company }, { persist: false, useModelPanel: false, ...options }))
  },
  screenStocks: {
    name: "screenStocks",
    description: "按自然语言筛选条件（市场/赛道/PE 等）跑选股，返回候选名单。",
    inputSchema: { question: "string" },
    run: ({ question } = {}) => safeRun(() => runScreener(question))
  },
  compareCompanies: {
    name: "compareCompanies",
    description: "拉取一只标的的轻量行情/财报/估值快照，用于对话内并排对比。",
    inputSchema: { ticker: "string", nameZh: "string?" },
    run: ({ ticker, nameZh } = {}) =>
      safeRun(async () => {
        const summary = await buildCompareSummary({ ticker, nameZh });
        if (!summary) throw new Error(`未取到对比对象行情：${ticker}`);
        return summary;
      })
  },
  macroRead: {
    name: "macroRead",
    description: "回答宏观/大盘问题：指数行情 + 网页证据 + 框架化短评。",
    inputSchema: { question: "string" },
    run: ({ question } = {}) => safeRun(() => runMacro(question))
  },
  webEvidence: {
    name: "webEvidence",
    description: "按研究意图检索网页证据（一手来源优先）。",
    inputSchema: { company: "object", question: "string", intent: "string?" },
    run: ({ company, question, intent } = {}) => safeRun(() => researchWebEvidence({ company, question, intent }))
  }
};

export function listTools() {
  return Object.values(agentTools);
}

export function getTool(name) {
  return agentTools[name] || null;
}
