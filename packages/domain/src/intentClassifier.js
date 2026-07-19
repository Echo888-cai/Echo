/**
 * 研究意图分类——纯规则，不读时钟/数据库/网络，因此留在领域包。
 *
 * `answerComposer` 用它决定提示词走哪套作答规则（护城河/商业模式/竞品/财务质量/
 * 证伪各有专属段落结构，而不是所有问题都套同一份完整研究模板）。
 * 分类是领域规则，注入 composer 的时钟/档案端口留在应用层。
 *
 * 顺序即优先级，几处是踩过真实误判改出来的，改动前先看 RULES 里的注释。
 *
 * 中英双语：产品覆盖美股与港股，英文问法是一等公民而不是可选项。2026-07-17 的回归
 * 测评里 8/8 条英文问句全部落进 companyStatus 兜底、套完整研究模板——正是本文件开头
 * 说要避免的那件事。每条规则的中英模式写在同一个正则里，就是为了让"只加了中文、
 * 忘了英文"在 review 时一眼可见。
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

/**
 * 顺序即优先级。规则之间**必然**互相重叠（"深度研究一下它的护城河和估值"同时命中三条），
 * 所以这个数组的顺序本身就是产品决策，不是实现细节。
 *
 * 总原则：**产出形态 > 具体主题**。用户说"给我一份完整报告"时他要的是一份报告，
 * 至于报告里覆盖护城河还是风险，那是报告的内容，不是问题的类型。
 */
const RULES = [
  // 深度研究必须最先判。它以前排在最后，于是被前面每一条抢走：
  // "写一份研究报告，重点覆盖风险" → riskEvent（用户要报告，被降级成单点风险问答）、
  // "深度研究一下它的护城河和估值" → moat。两条都是 2026-07-17 回归实测抓到的。
  {
    intent: RESEARCH_INTENTS.deepResearch,
    re: /深度研究|完整报告|研究报告|全面分析|深度分析|详细报告|[出写来给]\s*[一份]{0,2}\s*.{0,6}报告|full\s+(research\s+)?report|deep\s+(dive|research)|comprehensive\s+(analysis|report)|detailed\s+report|write\s+(me\s+)?an?\s+.{0,12}report/i
  },
  // 证伪/推翻逻辑：优先于风险事件，避免被"风险"两字抢走。
  {
    intent: RESEARCH_INTENTS.falsify,
    re: /证伪|证伪条件|什么情况会(证伪|推翻)|什么会(证伪|推翻|让.{0,4}(看错|错))|哪些.{0,6}(会推翻|证伪)|看错|逻辑(被)?推翻|bear\s*case|what\s+would\s+(prove|make)\s+.{0,20}wrong|falsif|downside\s+case|invalidate\s+the\s+thesis/i
  },
  // 点名的具体事件 > 泛化的财务词。"腾讯游戏版号收紧对利润影响多大" 问的是版号这件事，
  // 不是"腾讯利润怎么样"——但 financialQuality 的正则含"利润"，排在它前面就会把这句抢走
  // （2026-07-17 实测）。这条只收**具体到能指认的事件**，不收"风险/事件"这种泛化词
  // （那些仍留在下面的 riskEvent 里，优先级低于财务质量，避免"有什么风险"抢走财务问题）。
  {
    intent: RESEARCH_INTENTS.riskEvent,
    re: /版号|关税|制裁|反垄断|罚款|处罚|停牌|退市|做空|集体诉讼|数据泄露|召回|暴雷|爆雷|限售|减持|tariff|sanction|antitrust|delist|short\s+(seller|report)|class\s+action|data\s+breach|recall\b|probe\b/i
  },
  {
    intent: RESEARCH_INTENTS.competitors,
    re: /竞争对手|竞品|同行|同业|可比公司|可比对象|竞争格局|市场格局|行业格局|替代品|谁在抢|和谁竞争|主要竞争|竞争压力|competitors?\b|rivals?\b|competitive\s+landscape|market\s+share|who\s+(are|is)\s+.{0,14}(compet|rival)|peer\s+group/i
  },
  {
    intent: RESEARCH_INTENTS.businessModel,
    // "收入靠交易费还是订阅" 问的是收入**结构**（商业模式），不是收入好不好（财务质量）。
    // 靠"收入"两个字判断会被 financialQuality 抢走，所以这里认的是"靠…/…还是…/结构/构成"
    // 这类在问**成分**的句式。
    re: /靠什么赚钱|怎么赚钱|如何赚钱|盈利模式|商业模式|收入来源|主要收入|利润来源|赚的是什么钱|谁付钱|变现方式|谁给.{0,8}付钱|收入(主要)?靠|利润(主要)?靠|收入(结构|构成|拆分|分部)|靠.{0,10}还是.{0,10}[?？]?$|business\s+model|(how|where)\s+does\s+.{0,16}\s+make\s+money|revenue\s+(stream|source|mix|model|breakdown|split)|monetiz|who\s+pays/i
  },
  {
    intent: RESEARCH_INTENTS.moat,
    re: /护城河|竞争优势|壁垒|不可替代|垄断|网络效应|优势在哪|优势是什么|溢价能.{0,4}持续|\bmoat\b|competitive\s+(advantage|edge)|barrier\s+to\s+entry|network\s+effect|pricing\s+power|defensib|durable\s+advantage/i
  },
  // 估值必须排在财务质量之前。财务质量的正则含"利润"，而"腾讯的估值和利润哪个先修复"
  // 的主语明明是估值——排在后面就被"利润"两个字抢走了（2026-07-17 实测）。
  // 反向误伤要小得多：真正问财务的句子很少同时出现估值词。
  {
    intent: RESEARCH_INTENTS.valuation,
    re: /估值|贵不贵|便宜|PE|PB|PS|市盈率|市净率|市销率|目标价|赔率|性价比|多少倍|几倍算|高估|低估|历史分位|\bvaluation\b|expensive|\bcheap\b|overvalu|undervalu|price\s+target|fair\s+value|trading\s+at\s+\d|\bmultiples?\b/i
  },
  // 财务质量：补齐"赚钱吗/赚不赚钱/能不能赚钱"这类口语，避免落进 company_status 套全模板。
  {
    intent: RESEARCH_INTENTS.financialQuality,
    re: /赚钱吗|赚不赚钱|能不能赚钱|能赚钱|赚不赚|是否赚钱|有没有赚钱|盈不盈利|盈利吗|赚钱能力|利润|毛利|净利|现金流|自由现金流|财务质量|经营质量|收入|亏损|盈利|应收|存货|资本开支|回本|占比多少|增速|GMV|口径|profitab|margins?\b|cash\s*flow|\bfcf\b|revenue|earnings\s+quality|financials\b|loss[- ]making|burn\s+rate|receivable|inventory|capex|balance\s+sheet/i
  },
  {
    intent: RESEARCH_INTENTS.riskEvent,
    re: /为什么跌|为什么涨|下跌|大跌|暴跌|上涨|大涨|风险|监管|处罚|事故|事件|怎么了|关税|版号|制裁|会不会影响|why\s+(did|is|has)\s+.{0,16}(drop|fall|plunge|surge|jump|rally|rise|down|up)\b|sell-?off|\brisks?\b|regulat|lawsuit|investigat|tariff|sanction|what\s+happened/i
  }
];

export function classifyResearchIntent(question = "") {
  const text = String(question || "");
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.intent;
  }
  return RESEARCH_INTENTS.companyStatus;
}

export const RESEARCH_DEPTHS = {
  brief: "brief",
  standard: "standard",
  deep: "deep"
};

const EXPLICIT_BRIEF = /一句话|简单(说|讲|回答|看看)?|简短|直接说|只说结论|quick\s+answer|briefly|in\s+one\s+sentence/i;
const EXPLICIT_DEEP = /深度|完整|全面|详细|系统性|从头到尾|研究报告|deep|comprehensive|detailed|full\s+report/i;
const MULTI_PART = /分别|逐一|同时|以及|并且|然后|对比|比较|vs|还要|另外|一方面.{0,40}另一方面|第一.{0,40}第二/i;

function uniqueIntentMatches(text) {
  const matches = [];
  for (const rule of RULES) {
    if (rule.re.test(text) && !matches.includes(rule.intent)) matches.push(rule.intent);
  }
  return matches;
}

export function planResearchStages(intent, depth) {
  const stages = ["routing", "resolving", "market_financials"];
  if (depth !== RESEARCH_DEPTHS.brief && [
    RESEARCH_INTENTS.companyStatus,
    RESEARCH_INTENTS.moat,
    RESEARCH_INTENTS.competitors,
    RESEARCH_INTENTS.riskEvent,
    RESEARCH_INTENTS.deepResearch
  ].includes(intent)) stages.push("evidence");
  if ([
    RESEARCH_INTENTS.companyStatus,
    RESEARCH_INTENTS.valuation,
    RESEARCH_INTENTS.falsify,
    RESEARCH_INTENTS.deepResearch
  ].includes(intent)) stages.push("valuation");
  stages.push("generating", "fact_check");
  return stages;
}

/**
 * A deterministic first-pass router for the application-level cascade.
 *
 * High-confidence, obvious questions never pay for a second model call. Ambiguous
 * questions deliberately return a lower confidence so the application layer can
 * ask the configured model for a small structured routing decision. The returned
 * depth controls data collection and answer length, not just copy styling.
 */
export function routeResearchIntent(question = "") {
  const text = String(question || "").trim();
  const compactLength = text.replace(/\s+/g, "").length;
  const matches = uniqueIntentMatches(text);
  const intent = matches[0] || RESEARCH_INTENTS.companyStatus;
  const explicitlyDeep = intent === RESEARCH_INTENTS.deepResearch || EXPLICIT_DEEP.test(text);
  const explicitlyBrief = EXPLICIT_BRIEF.test(text);
  const multiPart = matches.length > 1 || MULTI_PART.test(text);
  const naturallyBrief = compactLength > 0 && compactLength <= 34 && intent !== RESEARCH_INTENTS.companyStatus && !multiPart;
  const depth = explicitlyDeep
    ? RESEARCH_DEPTHS.deep
    : explicitlyBrief || naturallyBrief
      ? RESEARCH_DEPTHS.brief
      : RESEARCH_DEPTHS.standard;
  const confidence = matches.length === 0 ? 0.46 : matches.length === 1 ? 0.94 : 0.78;
  return {
    intent,
    depth,
    confidence,
    source: "rules",
    multiPart,
    answerStyle: depth === RESEARCH_DEPTHS.brief ? "direct" : depth === RESEARCH_DEPTHS.deep ? "report" : "research",
    plan: planResearchStages(intent, depth)
  };
}
