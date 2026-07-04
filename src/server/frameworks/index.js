// EA-1 分析框架注册表：把 prompts.js 里"焊死在提示词里"的角色框架收敛成一份可查询、
// 可被后续 EA-2 规划器按 questionKind 选用的登记表。内容原样迁移自 prompts.js 的 PROMPTS——
// 零行为变更，只是把"框架是什么、适用什么问题"从散落的 import 变成声明式清单，
// 为柱 4（框架资产化）和柱 5/EA-6（未来用户自定义框架）打地基。
import { PROMPTS, RESEARCH_DISCIPLINE } from "../../prompts.js";
import { RESEARCH_INTENTS } from "../services/intentClassifier.js";

const I = RESEARCH_INTENTS;

// appliesTo：如实登记"现状"——哪类问题（questionKind，取 RESEARCH_INTENTS 的值，
// 或顶层路由 kind "company"/"screener"/"macro"/"portfolio_review"）实际在用这个框架，
// 而不是设计一套尚无消费方的理想分类。EA-2 规划器接入时按需细化。
const APPLIES_TO = {
  cio: ["company", I.companyStatus, I.valuation, I.riskEvent, I.deepResearch],
  chat: [I.companyStatus, I.businessModel, I.competitors, I.moat, I.financialQuality, I.valuation, I.riskEvent, I.falsify],
  macro: ["macro"],
  research: [I.deepResearch],
  valuation: [I.valuation],
  risk: [I.riskEvent, I.falsify],
  debate: [I.deepResearch],
  memo: [I.deepResearch],
  portfolioCoach: ["portfolio_review"]
};

function toEntry(id, prompt) {
  return {
    id,
    name: prompt.name,
    role: prompt.role,
    appliesTo: APPLIES_TO[id] || [],
    systemPrompt: prompt.system,
    rubric: prompt.outputContract || []
  };
}

export const FRAMEWORKS = Object.fromEntries(
  Object.entries(PROMPTS).map(([id, prompt]) => [id, toEntry(id, prompt)])
);

export function listFrameworks() {
  return Object.values(FRAMEWORKS);
}

export function getFramework(id) {
  return FRAMEWORKS[id] || null;
}

// 按 questionKind 找适用框架；找不到时返回空数组，由调用方自行兜底（如落回 chat 框架）。
export function frameworksFor(questionKind) {
  return listFrameworks().filter((framework) => framework.appliesTo.includes(questionKind));
}

export { RESEARCH_DISCIPLINE };
