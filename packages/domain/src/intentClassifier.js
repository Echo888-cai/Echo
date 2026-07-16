/**
 * 研究意图分类——纯规则，不读时钟/数据库/网络，因此留在领域包。
 *
 * `answerComposer` 用它决定提示词走哪套作答规则（护城河/商业模式/竞品/财务质量/
 * 证伪各有专属段落结构，而不是所有问题都套同一份完整研究模板）。
 * 分类是领域规则，注入 composer 的时钟/档案端口留在应用层。
 *
 * 顺序即优先级，几处是踩过真实误判改出来的，改动前先看注释。
 */

export const RESEARCH_INTENTS = {
  companyStatus: "company_status",
  businessModel: "business_model",
  competitors: "competitors",
  moat: "moat",
  financialQuality: "financial_quality",
  valuation: "valuation",
  riskEvent: "risk_event",
  falsify: "falsify",
  deepResearch: "deep_research"
};

export function classifyResearchIntent(question = "") {
  const text = String(question || "");
  // 证伪/推翻逻辑：优先于风险事件，避免被"风险"两字抢走。
  if (/证伪|证伪条件|什么情况会(证伪|推翻)|什么会(证伪|推翻|让.{0,4}(看错|错))|哪些.{0,6}(会推翻|证伪)|看错|逻辑(被)?推翻|bear\s*case/i.test(text)) return RESEARCH_INTENTS.falsify;
  if (/竞争对手|竞品|同行|同业|可比公司|可比对象|竞争格局|市场格局|行业格局|替代品|谁在抢|和谁竞争|主要竞争|竞争压力/.test(text)) return RESEARCH_INTENTS.competitors;
  if (/靠什么赚钱|怎么赚钱|如何赚钱|盈利模式|商业模式|收入来源|主要收入|利润来源|赚的是什么钱|谁付钱|变现方式/.test(text)) return RESEARCH_INTENTS.businessModel;
  if (/护城河|竞争优势|壁垒|不可替代|垄断|网络效应|优势在哪|优势是什么/.test(text)) return RESEARCH_INTENTS.moat;
  // 财务质量：补齐"赚钱吗/赚不赚钱/能不能赚钱"这类口语，避免落进 company_status 套全模板。
  if (/赚钱吗|赚不赚钱|能不能赚钱|能赚钱|赚不赚|是否赚钱|有没有赚钱|盈不盈利|盈利吗|赚钱能力|利润|毛利|净利|现金流|自由现金流|财务质量|经营质量|收入|亏损|盈利/.test(text)) return RESEARCH_INTENTS.financialQuality;
  if (/估值|贵不贵|便宜|PE|PB|PS|市盈率|目标价|赔率/.test(text)) return RESEARCH_INTENTS.valuation;
  if (/为什么跌|为什么涨|下跌|大跌|暴跌|上涨|大涨|风险|监管|处罚|事故|事件|怎么了/.test(text)) return RESEARCH_INTENTS.riskEvent;
  if (/深度研究|完整报告|研究报告|全面分析/.test(text)) return RESEARCH_INTENTS.deepResearch;
  return RESEARCH_INTENTS.companyStatus;
}
