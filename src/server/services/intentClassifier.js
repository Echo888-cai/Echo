import { anchorQueryToDate, beijingYear } from "../utils/time.js";

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

// ── P6 发现层意图：筛选器 / 宏观（不绑定单一公司的问题）────
// 与公司研究意图分开：这两类不进公司研究管道，走 /api/discover。
// 前端 sendChat 在公司解析之前先做同样的判定（src/ui/resolve.js 有镜像实现）。

const SCREEN_VERB = /帮我筛|筛选|筛一下|筛一筛|筛出|选股|挑(几只|一些|几个|出)|找(几只|一些|几个)|有(哪些|什么).{0,12}(股票|公司|标的)(值得|可以|推荐)?/;
const SCREEN_COND = /(PE|PB|市盈率|市净率|市值|股息率?|分红率?|价格|营收增速|增速)\s*(小于|大于|低于|高于|超过|不到|少于|多于|以上|以下|<|>|≤|≥|＜|＞)/i;

// 宏观信号：大盘/指数/央行/宏观数据/市场事件。绑定了具体公司的问题不算（调用方需先排除）。
const MACRO_SIGNAL = /大盘|宏观|美联储|议息|加息|降息|非农|CPI|PPI|通胀|国债收益率|流动性|美股(今晚|今天|今年|本周|下周|最近|接下来|怎么|如何|行情|市场)|港股(今晚|今天|本周|大盘|行情|市场|最近|怎么)|恒生指数|恒指|纳斯达克|纳指|标普|道琼斯|道指|指数(怎么|如何|走势)|今晚.{0,10}(关键事件|有什么事件|数据|财报|事件)|市场情绪|风险偏好|宏观经济/;

export function isScreenerQuestion(question = "") {
  const text = String(question || "");
  return SCREEN_VERB.test(text) || SCREEN_COND.test(text);
}

export function isMacroQuestion(question = "") {
  return MACRO_SIGNAL.test(String(question || ""));
}

// 发现层路由：screener 优先（"筛出 PE<20"同时含数字条件与宏观词时按筛选处理）。
// 返回 "screener" | "macro" | null。注意：这里不判"是否点名公司"，那是调用方（前端
// sendChat / discover 路由）的职责——公司问题永远优先走公司研究管道。
export function classifyDiscoveryIntent(question = "") {
  if (isScreenerQuestion(question)) return "screener";
  if (isMacroQuestion(question)) return "macro";
  return null;
}

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

function compactName(company = {}) {
  return [company.nameZh, company.nameZh?.replace(/[-－].*$/, ""), company.nameEn, company.ticker]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter((item, index, arr) => item && arr.indexOf(item) === index)
    .slice(0, 4);
}

export function buildEvidenceQueries({ company = {}, question = "", intent = classifyResearchIntent(question) } = {}) {
  const names = compactName(company);
  const main = names[0] || company.ticker || "company";
  const en = company.nameEn || main;
  const zh = company.nameZh || main;
  const ticker = company.ticker || "";
  const year = beijingYear();
  const isUs = ticker && !/\.(HK|SS|SZ)$/i.test(ticker);
  // B-P2：一手源优先——美股先指向 IR / 业绩新闻稿 / 8-K / SEC，而非泛新闻转述。
  const base = [
    `"${en}" ${ticker}`.trim(),
    `"${zh}" ${ticker}`.trim(),
    ...(isUs ? [
      `${en} investor relations earnings press release guidance ${year}`,
      `${en} ${ticker} 8-K earnings results SEC filing`
    ] : [])
  ];
  const templates = {
    [RESEARCH_INTENTS.competitors]: [
      `${en} competitors market share ${year}`,
      `${en} industry competition market share shipments`,
      `${en} competitors IDC Gartner Canalys Counterpoint`,
      `site:canalys.com ${en} market share shipments`,
      `site:idc.com ${en} market share shipments`,
      `site:counterpointresearch.com ${en} market share`,
      `${zh} 竞争对手 市场份额 行业格局`
    ],
    [RESEARCH_INTENTS.businessModel]: [
      `${en} revenue segments business model latest annual report`,
      `${en} earnings revenue profit margin latest results`,
      `${zh} 收入构成 盈利模式 最新财报`,
      `${zh} 主要收入 利润率 现金流`
    ],
    [RESEARCH_INTENTS.moat]: [
      `${en} competitive advantage moat market share`,
      `${en} latest earnings users revenue margin`,
      `${zh} 护城河 竞争优势 市场份额`,
      `${zh} 竞争优势 利润率 现金流`
    ],
    [RESEARCH_INTENTS.financialQuality]: [
      `${en} latest earnings revenue profit cash flow`,
      `${en} annual report free cash flow margin`,
      `${zh} 最新业绩 收入 利润 现金流`,
      `${zh} 毛利率 自由现金流 财报`
    ],
    [RESEARCH_INTENTS.valuation]: [
      `${en} valuation PE target price analyst estimates`,
      `${en} market cap forward PE buyback dividend`,
      `${zh} 估值 市盈率 目标价 回购 分红`,
      `${zh} 便宜 贵不贵 一致预期`
    ],
    [RESEARCH_INTENTS.riskEvent]: [
      `${en} shares fall why latest news earnings risk`,
      `${en} latest news regulation competition margin`,
      `${zh} 股价 下跌 原因 最新消息`,
      `${zh} 风险 监管 竞争 财报`
    ],
    [RESEARCH_INTENTS.falsify]: [
      `${en} bear case risks margin decline competition`,
      `${en} downside risk regulation slowing growth`,
      `${zh} 风险 证伪 利润率 下滑 竞争`,
      `${zh} 看空 逻辑 监管 增长放缓`
    ],
    [RESEARCH_INTENTS.companyStatus]: [
      `${en} latest earnings stock news ${year}`,
      `${en} latest results revenue profit outlook`,
      `${zh} 最近怎么样 最新财报 股价 新闻`,
      `${zh} 业绩 展望 风险`
    ],
    [RESEARCH_INTENTS.deepResearch]: [
      `${en} annual report earnings investor relations`,
      `${en} latest financial results presentation`,
      `${zh} 年报 中报 业绩公告 投资者关系`,
      `${zh} 深度研究 财报 风险 竞争`
    ]
  };
  return [...base, ...(templates[intent] || templates[RESEARCH_INTENTS.companyStatus])]
    .map((query) => query.replace(/\s+/g, " ").trim())
    // 相对时间问题（今天/最新/盘前…）先把绝对日期锚进查询，避免拿模糊词原样搜。
    .map((query) => anchorQueryToDate(query, question))
    .filter(Boolean)
    .filter((query, index, arr) => arr.indexOf(query) === index)
    .slice(0, 6);
}
