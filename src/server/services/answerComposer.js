import { RESEARCH_STATUS_LABELS } from "../schemas/agentPanel.js";
import { companies, companyByTicker } from "../../data.js";
import { classifyResearchIntent, RESEARCH_INTENTS } from "./intentClassifier.js";
import { webEvidenceToPrompt } from "./webEvidenceService.js";
import { computeFinancialQuality } from "@echo/domain";
import { financialsToMarkdown } from "../../financialData.js";
import { detectMarket } from "../../market.js";
import { beijingMinute } from "../utils/time.js";

const COMPETITOR_MAP = {
  "0992.HK": [
    { name: "HP Inc.", angle: "PC 与商用终端", note: "直接竞争全球 PC 份额、渠道和企业客户。" },
    { name: "Dell Technologies", angle: "PC、服务器与企业基础设施", note: "同时在商用 PC、服务器、存储和企业方案上重叠。" },
    { name: "Apple", angle: "高端个人电脑与生态体验", note: "不完全同价位竞争，但会影响高端 PC 和创作者人群定价。" },
    { name: "华硕 / 宏碁", angle: "消费 PC 与游戏本", note: "在消费端、区域渠道和性价比机型上竞争。" },
    { name: "华为 / 小米 / 荣耀", angle: "中国智能终端", note: "在中国 PC、平板、手机和多设备生态里争夺用户心智。" },
    { name: "HPE / Supermicro / 浪潮信息 / 新华三", angle: "服务器与 AI 基础设施", note: "在数据中心、AI 服务器、存储和企业客户项目上竞争。" }
  ],
  "0700.HK": [
    { name: "网易", angle: "游戏", note: "在游戏研发、发行和玩家时间上直接竞争。" },
    { name: "字节跳动 / 快手", angle: "广告与内容时间", note: "争夺广告预算、用户时长和短视频内容生态。" },
    { name: "阿里巴巴 / 京东 / 美团", angle: "本地商业与支付场景", note: "部分竞争交易场景、商家服务和生态入口。" },
    { name: "Bilibili / 小红书", angle: "年轻用户内容社区", note: "在内容消费和广告增量上形成替代压力。" }
  ],
  "9988.HK": [
    { name: "京东", angle: "电商与供应链", note: "在自营零售、物流体验和高客单品类上竞争。" },
    { name: "拼多多", angle: "低价电商与用户心智", note: "持续压制平台 take rate、商家预算和价格带。" },
    { name: "抖音电商 / 快手电商", angle: "内容电商", note: "争夺商家广告预算、流量入口和冲动消费场景。" },
    { name: "腾讯云 / 华为云 / 百度智能云", angle: "云计算与 AI 基础设施", note: "在企业云、AI 云和政企客户上竞争。" }
  ]
};

function cleanSentence(value) {
  return String(value || "").replace(/[。；;,\s]+$/g, "").trim();
}

function driver(panel, name) {
  return (panel?.keyDrivers || []).find((item) => item.name === name) || null;
}

function usefulSummary(item, fallback) {
  const text = String(item?.summary || "").trim();
  if (!text) return fallback;
  if (/^(新闻源不可用|缺|缺失|未接入|暂不评分)/.test(text) || /缺失，|缺失$/.test(text)) return fallback;
  return text;
}

function humanStatus(status = "") {
  const text = String(status || "").trim();
  if (!text || /暂不评分|缺失|未接入|数据不足/.test(text)) return "当前未核到完整口径";
  return text;
}

function backendGapLines(panel, dataSources = {}) {
  const gaps = [];
  const missing = new Set(Array.isArray(panel?.missingData) ? panel.missingData : []);
  const financialMissing = dataSources.financials?.status !== "ok" || [...missing].some((item) => /财报|利润|现金流|估值|PE|三表|收入/.test(item));
  const filingsMissing = dataSources.filings?.status !== "ok" || [...missing].some((item) => /公告|回购|分红|年报|中报/.test(item));
  const newsMissing = dataSources.news?.status !== "ok" || [...missing].some((item) => /新闻|舆情|监管/.test(item));
  const estimatesMissing = dataSources.estimates?.status !== "ok" || [...missing].some((item) => /一致预期|评级|目标价/.test(item));
  if (financialMissing) gaps.push("完整财报三表、利润率和自由现金流还没核到，会拉低财务结论的置信度。");
  if (filingsMissing) gaps.push("最近年报/中报、业绩公告和回购分红口径还没核到，股东回报判断暂为低置信度。");
  if (newsMissing) gaps.push("近期新闻、监管和行业事件还缺可信外部证据，风险信号本轮主要靠商业逻辑推断。");
  if (estimatesMissing) gaps.push("一致预期、目标价和盈利预测还没核到，估值判断暂不锁定区间。");
  return gaps.length ? gaps : ["关键证据基本到位，下一步主要做交叉校验。"];
}

function sentenceJoin(items = [], fallback = "") {
  const clean = items.map((item) => String(item || "").replace(/[。；;,\s]+$/g, "").trim()).filter(Boolean);
  if (!clean.length) return fallback;
  return clean.join("；") + "。";
}

function metricsText(profile) {
  if (!Array.isArray(profile?.metrics) || !profile.metrics.length) return "";
  return profile.metrics
    .slice(0, 4)
    .map((metric) => {
      const [name, value, note] = metric;
      return `${name}偏${value}${note ? `，需要跟踪${note}` : ""}`;
    })
    .join("；") + "。";
}

function buildInferenceSection({ panel, question, dataSources }) {
  const profile = companyByTicker(panel?.ticker) || {};
  const name = panel?.companyName || profile.nameZh || panel?.ticker || "这家公司";
  const business = sentenceJoin(
    profile.businessModel || [],
    `${name} 的商业模式需要从收入来源、利润池、客户粘性和资本开支强度拆开看。`
  );
  const moat = sentenceJoin(
    (profile.moat || []).slice(0, 5).map((item) => `${item}是核心壁垒之一`),
    "目前只能先从规模效应、客户关系、品牌和渠道判断壁垒。"
  );
  const risks = sentenceJoin(
    (profile.risks || []).slice(0, 5).map((item) => `${item}会削弱这个逻辑`),
    "主要证伪点在竞争、监管、利润率和现金流。"
  );
  const metrics = metricsText(profile);
  const questionHint = /赚|盈利|利润|现金流/.test(question)
    ? "所以问它赚不赚钱，不能只看净利润，而要看高毛利业务占比、经营现金流、资本开支和股东回报是不是同向。"
    : "所以问它最近怎么样，重点不是短期涨跌，而是这些利润池有没有继续兑现、风险有没有收敛。";
  const financialGap = dataSources.financials?.status !== "ok";
  const filingsGap = dataSources.filings?.status !== "ok";
  const gapText = financialGap || filingsGap
    ? "本轮财报三表或公告口径还没补齐，所以这个推断不能写成确定结论；但商业逻辑本身仍然可以先判断。"
    : "这轮数据源能支撑更强判断，下一步是把结论和最新财报逐项对齐。";

  return [
    `${name} 的判断不能停在“数据不足”。先按商业逻辑做推断，再用财报和公告去验证。`,
    `第一层是赚钱机制：${business}${questionHint}`,
    `第二层是护城河：${moat}护城河真正有价值的地方，不是听起来强，而是能不能带来更低获客成本、更高留存、更稳利润率和更强自由现金流。`,
    metrics ? `第三层是财务兑现：${metrics}如果这些指标不能同步改善，商业模式再好也会变成估值故事。` : `第三层是财务兑现：目前缺少完整三表，先看收入质量、利润率、自由现金流和回购/分红四个方向。`,
    `第四层是重估变量：市场愿不愿意给它更高估值，取决于增长叙事是否重新成立，以及利润和现金流能否证明投入不是无底洞。${risks}`,
    `${gapText} 换句话说，现在最有价值的不是硬给结论，而是把“什么会让逻辑变好/变坏”先讲清楚。`
  ].join("\n\n");
}

function thesisLine(prefix, items, fallback) {
  const text = sentenceJoin(items || [], fallback).replace(/。$/g, "");
  return `${prefix}：${text}。`;
}

function sourceLines(panel, dataSources = {}, webEvidence = null) {
  const seenUrl = new Set();
  const lines = [];
  // 1. Curated panel sources (official IR / HKEX / market — real, working links).
  if (Array.isArray(panel?.sources)) {
    for (const source of panel.sources) {
      if (!source?.label && !source?.url) continue;
      if (source.url) {
        if (seenUrl.has(source.url)) continue;
        seenUrl.add(source.url);
      }
      lines.push(`- ${source.label || source.type || "来源"}${source.timestamp ? `（${source.timestamp}）` : ""}${source.url ? `：${source.url}` : ""}`);
      if (lines.length >= 5) break;
    }
  }
  // 2. Validated web evidence (already liveness-checked upstream — no dead links).
  const evidence = Array.isArray(webEvidence?.evidence) ? webEvidence.evidence : [];
  for (const item of evidence) {
    if (!item.url || seenUrl.has(item.url)) continue;
    seenUrl.add(item.url);
    lines.push(`- ${item.title || item.source || item.sourceType || "Web"}：${item.url}`);
    if (lines.length >= 7) break;
  }
  if (lines.length) return lines;
  // 3. Fallback: data-source providers (only when nothing citable exists).
  return [
    `- 行情：${dataSources.market?.provider || panel?.price?.source || "公开行情"}${dataSources.market?.asOf ? `（${dataSources.market.asOf}）` : ""}`,
    `- 公司档案：Echo Research 本地研究档案`
  ];
}

function isMoatQuestion(question = "") {
  return classifyResearchIntent(question) === RESEARCH_INTENTS.moat;
}

function isBusinessModelQuestion(question = "") {
  return classifyResearchIntent(question) === RESEARCH_INTENTS.businessModel;
}

function isCompetitorQuestion(question = "") {
  return classifyResearchIntent(question) === RESEARCH_INTENTS.competitors;
}

function isFinancialQualityQuestion(question = "") {
  return classifyResearchIntent(question) === RESEARCH_INTENTS.financialQuality;
}

function isFalsifyQuestion(question = "") {
  return classifyResearchIntent(question) === RESEARCH_INTENTS.falsify;
}

function peerCompanies(profile = {}) {
  const pool = companies
    .filter((company) => company.ticker !== profile.ticker)
    .filter((company) => profile.industry && company.industry === profile.industry);
  const fallbackPool = pool.length
    ? pool
    : companies
        .filter((company) => company.ticker !== profile.ticker)
        .filter((company) => profile.sector && company.sector === profile.sector);
  return fallbackPool
    .slice(0, 8)
    .map((company) => ({
      name: company.nameZh,
      ticker: company.ticker,
      angle: company.industry || company.sector || "同业可比",
      note: `${company.nameZh} 属于${company.industry || company.sector || "同业"}，可作为估值、增长和利润率的参照。`
    }));
}

function competitorSetFor(profile = {}) {
  const mapped = COMPETITOR_MAP[profile.ticker] || [];
  if (mapped.length >= 4) return mapped.slice(0, 8);
  const peers = peerCompanies(profile);
  const seen = new Set();
  return [...mapped, ...peers]
    .filter((item) => {
      const key = `${item.name}-${item.ticker || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function evidenceSignalsFromWeb(webEvidence = null) {
  const evidence = Array.isArray(webEvidence?.evidence) ? webEvidence.evidence : [];
  return evidence
    .filter((item) => /竞争|竞品|对手|市场份额|出货|行业格局|PC|server|AI|IDC|Canalys|Gartner|Counterpoint|HP|Dell|HPE|Supermicro|competition|competitor|market share|shipment/i.test(`${item.title || ""} ${item.snippet || ""}`))
    .filter((item) => !/售后|保修|驱动|下载|应用商店|官方商城|购物|促销|优惠|support|drivers|troubleshooting|warranty|repair|store|shopping/i.test(`${item.title || ""} ${item.snippet || ""} ${item.url || ""}`))
    .slice(0, 5)
    .map((item, index) => {
      const source = item.source || item.sourceType || "web evidence";
      const date = item.publishedAt ? `，${item.publishedAt}` : "";
      const url = item.url ? `：${item.url}` : "";
      return `${index + 1}. ${item.title || item.url}（${source}${date}）${url}`;
    });
}

function evidenceSignalsFromNews(newsSnapshot = null) {
  const articles = newsSnapshot?.providerStatus === "ok" ? newsSnapshot.articles || [] : [];
  return articles
    .filter((article) => /竞争|市场份额|价格战|出货|PC|server|AI|competition|market share|shipment|price/i.test(`${article.title || ""} ${article.description || ""} ${article.scope || ""}`))
    .slice(0, 4)
    .map((article, index) => {
      const source = article.source || "web evidence";
      const date = article.publishedAt ? `，${article.publishedAt}` : "";
      const url = article.url ? `：${article.url}` : "";
      return `${index + 1}. ${article.title}（${source}${date}）${url}`;
    });
}

// 通用"已验证外部信号"：从本轮校验过的网页证据 + 实时新闻里取最相关的几条，供**本地兜底**
// 的事实/判断直接引用——之前证据只进了模型 prompt，本地兜底（模型超时/无 key 时）完全没用
// 上证据，对着 seed 档案空谈。这里让本地兜底也接地：带来源与日期，永远有出处。
function validatedSignalLines(context = {}, limit = 3) {
  const out = [];
  const seen = new Set();
  const push = (title, src, date) => {
    const key = String(title || "").trim().toLowerCase();
    if (!title || seen.has(key)) return;
    seen.add(key);
    // 这里只做行内摘要；完整链接在下方“来源”独占一行。把多个 URL 塞进同一段并以中文
    // 分号连接会被 Markdown 自动链接器误吞，生成不可点击的拼接 URL。
    out.push(`${title}（${src}${date ? `，${date}` : ""}）`);
  };
  for (const item of Array.isArray(context.webEvidence?.evidence) ? context.webEvidence.evidence : []) {
    if (out.length >= limit) break;
    push(item.title || item.url, item.source || item.sourceType || "网页证据", item.publishedAt);
  }
  if (out.length < limit && context.newsSnapshot?.providerStatus === "ok") {
    for (const a of context.newsSnapshot.articles || []) {
      if (out.length >= limit) break;
      push(a.title, a.source || "新闻", a.publishedAt);
    }
  }
  return out;
}

function competitorReplyFromPanel(panel, _question = "", dataSources = {}, context = {}) {
  const profile = companyByTicker(panel?.ticker) || {};
  const name = panel?.companyName || profile.nameZh || panel?.ticker || "这家公司";
  const competitors = competitorSetFor({ ...profile, ticker: panel?.ticker || profile.ticker });
  const moat = Array.isArray(profile.moat) && profile.moat.length ? profile.moat.slice(0, 4) : ["规模", "渠道", "品牌", "客户关系"];
  const risks = Array.isArray(profile.risks) && profile.risks.length ? profile.risks.slice(0, 4).map(cleanSentence) : ["价格竞争", "技术变化", "客户流失", "利润率下滑"];
  const monitors = Array.isArray(profile.monitors) && profile.monitors.length ? profile.monitors.slice(0, 5) : ["收入增速", "利润率", "市场份额", "客户留存", "现金流"];
  const evidenceSignals = [...evidenceSignalsFromWeb(context.webEvidence), ...evidenceSignalsFromNews(context.newsSnapshot)].slice(0, 5);

  return [
    `北京时间 ${beijingMinute()}，${name}的竞争对手不能只按“同一个行业”列名字，要按它在哪些利润池里赚钱来拆。`,
    "",
    "简单结论",
    `${name}的竞争不是单线竞争，而是多战场竞争。真正要看的是：哪些对手在抢收入，哪些对手在压利润率，哪些对手会削弱它的估值叙事。`,
    "",
    "主要竞争对手",
    ...(competitors.length
      ? competitors.map((item, index) => `${index + 1}. ${item.name}${item.ticker ? `（${item.ticker}）` : ""}：${item.angle}。${item.note}`)
      : ["1. 当前本地档案没有足够可比公司，需要用行业分类、公告和网页证据补齐。"]),
    "",
    "怎么理解竞争格局",
    `第一，直接对手会抢订单、渠道和客户预算；第二，替代型对手会改变用户行为或企业采购口径；第三，低价或高效率对手会压低行业利润率。${name}的核心防守点是：${moat.join("、")}。这些防守点只有在毛利率、收入增速和现金流里兑现，才算真壁垒。`,
    "",
    "我的判断",
    `${name}的竞争风险不在于“有没有竞争对手”，而在于竞争是否开始改变利润池。如果竞争只是份额波动，问题还可控；如果竞争导致价格下降、渠道费用上升、库存恶化或服务利润率被打穿，那就会变成估值重估。`,
    "",
    "接下来重点看",
    ...monitors.map((item, index) => `${index + 1}. ${item}。`),
    "",
    "主要风险",
    ...risks.map((item, index) => `${index + 1}. ${item}。`),
    "",
    ...(evidenceSignals.length
      ? ["已抓到的外部信号", ...evidenceSignals, ""]
      : []),
    "还缺什么",
    `还缺最新市场份额、分业务收入和同业利润率的硬数据；下一步重点核验“份额、出货量、云/服务器订单、价格竞争”这几个事实，再把结论从阶段判断升级。`,
    "",
    "来源：",
    ...sourceLines(panel, dataSources, context.webEvidence)
  ].join("\n");
}

function businessModelReplyFromPanel(panel, _question = "", dataSources = {}) {
  const profile = companyByTicker(panel?.ticker) || {};
  const name = panel?.companyName || profile.nameZh || panel?.ticker || "这家公司";
  const rawBusiness = Array.isArray(profile.businessModel) ? profile.businessModel : [];
  const shareholderReturns = rawBusiness.filter((item) => /回购|分红|每股价值|股东回报/.test(String(item)));
  const business = rawBusiness.filter((item) => !/回购|分红|每股价值|股东回报/.test(String(item)));
  const businessLines = business.length
    ? business
    : ["核心收入来源还需要用最新财报拆分，但可以先从主业收入、利润率和现金流判断。"];
  const metrics = Array.isArray(profile.metrics) ? profile.metrics : [];
  const risks = Array.isArray(profile.risks) ? profile.risks : [];
  const sources = sourceLines(panel, dataSources);
  const qualityLine = metrics.length
    ? metrics.slice(0, 4).map((m) => `${m[0]}：${m[1]}，${m[2] || "待验证"}`).join("；")
    : "还缺完整财报三表，暂时不能精确拆收入和利润占比。";
  const riskLine = risks.length
    ? risks.slice(0, 4).map(cleanSentence).join("、")
    : "竞争、监管、利润率和现金流波动";

  return [
    `北京时间 ${beijingMinute()}，${name} 靠什么赚钱，核心不是一句“做平台”，而是看哪些业务真正贡献高质量利润。`,
    "",
    "简单说",
    `${name} 的经营赚钱机制主要来自：${businessLines.map(cleanSentence).join("；")}。`,
    "",
    "拆开看",
    ...businessLines.slice(0, 4).map((item, index) => `${index + 1}. ${cleanSentence(item)}。这部分要继续看收入增速、毛利率和现金流质量。`),
    "",
    "关键判断",
    `真正值钱的是高毛利、低边际成本、可持续复购或高留存的利润池。当前可用画像显示：${qualityLine}。所以不能只问“有没有收入”，还要问这些收入是不是能稳定变成自由现金流。${shareholderReturns.length ? `另外，${shareholderReturns.map(cleanSentence).join("、")}是股东回报机制，不是经营收入来源。` : ""}`,
    "",
    "主要风险",
    `${riskLine}会影响它赚钱的稳定性。如果这些风险开始压低利润率或现金流，商业模式看起来再好，也会被市场重新定价。`,
    "",
    "来源：",
    ...sources
  ].join("\n");
}

function moatReplyFromPanel(panel, _question = "", dataSources = {}) {
  const profile = companyByTicker(panel?.ticker);
  const name = panel?.companyName || profile?.nameZh || panel?.ticker || "这家公司";
  const moat = profile?.moat?.length ? profile.moat : ["用户/客户关系", "规模效应", "品牌与渠道", "技术或数据积累"];
  const business = profile?.businessModel?.length ? profile.businessModel : [];
  const risks = profile?.risks?.length ? profile.risks : ["竞争加剧", "利润率下滑", "监管或商业模式变化"];
  const sources = sourceLines(panel, dataSources);

  return [
    `北京时间 ${beijingMinute()}，${name} 的护城河不能只看“规模大”，要看它能不能持续带来定价权、用户留存、低获客成本和现金流。`,
    "",
    "结论",
    `${name} 的护城河是“多层叠加型”，不是单一技术壁垒。最核心的是：${moat.slice(0, 3).join("、")}。但护城河强不等于利润永远稳定，关键要看这些优势能不能继续转化成利润率、现金流和股东回报。`,
    "",
    "护城河拆解",
    ...moat.slice(0, 6).map((item, index) => `${index + 1}. ${item}：这是它相对普通公司的优势来源，但需要用收入质量、利润率和现金流去验证。`),
    "",
    "商业模式",
    ...(business.length
      ? business.slice(0, 4).map((item, index) => `${index + 1}. ${item}`)
      : ["1. 当前缺少更完整的业务拆分，但可以先从客户粘性、交易频次、利润池和资本开支强度判断。"]),
    "",
    "我的判断",
    `${name} 的护城河如果要成立，必须满足三个条件：用户或客户离不开它，竞争对手很难用补贴长期打穿它，它的优势最终能落到利润和自由现金流上。只说“它很大”没有意义，真正要验证的是“它的大是否还能赚钱”。`,
    "",
    "风险 / 证伪",
    ...risks.slice(0, 5).map((item, index) => `${index + 1}. ${item}。`),
    "",
    "下一步看什么",
    "1. 核心业务收入是否还在增长。",
    "2. 高毛利业务占比是否提高。",
    "3. 获客成本和补贴是否压低利润。",
    "4. 自由现金流和回购/分红能否持续。",
    "",
    "来源：",
    ...sources
  ].join("\n");
}

function financialQualityReplyFromPanel(panel, _question = "", dataSources = {}, context = {}) {
  const profile = companyByTicker(panel?.ticker) || {};
  const name = panel?.companyName || profile.nameZh || panel?.ticker || "这家公司";
  const financialsData = context.financialsData || null;
  const marketSnapshot = context.marketSnapshot || null;
  const quality = computeFinancialQuality(financialsData, {
    marketCap: marketSnapshot?.marketCap,
    pe: marketSnapshot?.pe
  });
  const hasMetrics = Array.isArray(quality.metrics) && quality.metrics.length > 0;

  const rawBusiness = Array.isArray(profile.businessModel) ? profile.businessModel : [];
  const earnLines = (rawBusiness.filter((item) => !/回购|分红|每股价值|股东回报/.test(String(item))).length
    ? rawBusiness.filter((item) => !/回购|分红|每股价值|股东回报/.test(String(item)))
    : rawBusiness
  ).slice(0, 3);
  const shareholderReturns = rawBusiness.filter((item) => /回购|分红|每股价值|股东回报/.test(String(item)));
  const risks = Array.isArray(profile.risks) && profile.risks.length
    ? profile.risks.slice(0, 4).map(cleanSentence)
    : ["利润率下滑", "竞争加剧", "现金流转弱", "监管或商业模式变化"];
  const monitors = Array.isArray(profile.monitors) && profile.monitors.length
    ? profile.monitors.slice(0, 5)
    : ["收入增速", "毛利率", "经营利润率", "自由现金流", "回购/分红"];

  const profitLines = hasMetrics
    ? quality.metrics
        .filter((m) => ["收入增速", "毛利率", "经营利润率", "净利率", "ROE"].includes(m.name))
        .map((m) => `${m.name} ${m.display}`)
    : [];
  const cashLines = hasMetrics
    ? quality.metrics
        .filter((m) => ["自由现金流", "回购金额", "分红"].includes(m.name))
        .map((m) => `${m.name} ${m.display}`)
    : [];

  const qualityVerdict = quality.quality?.qualityScore != null
    ? `综合财务质量约 ${quality.quality.qualityScore}/100（基于已核到的口径加权）`
    : "完整三表还没核到，财务质量先做低置信度判断";

  const lines = [
    `北京时间 ${beijingMinute()}，${name} 赚不赚钱，要分三层看：靠什么赚钱、利润是不是高质量、现金流能不能兜住。`,
    "",
    "我的判断",
    `${name} 的赚钱机制${earnLines.length ? "本身成立" : "需要用最新财报进一步确认"}：${qualityVerdict}。真正决定它“值不值钱”的，不是有没有收入，而是高毛利业务占比、经营现金流和股东回报能不能同向兑现。`,
    "",
    "靠什么赚钱",
    ...(earnLines.length
      ? earnLines.map((item, index) => `${index + 1}. ${cleanSentence(item)}。`)
      : ["1. 核心收入来源需要用最新财报拆分；先从主业收入、利润率和现金流判断。"]),
    "",
    "利润质量",
    profitLines.length
      ? profitLines.map((line) => `· ${line}`).join("\n")
      : "· 当前未核到完整利润口径，先看高毛利业务占比是否提升、利润率是否稳定，而不是只看一次性净利润。",
    "",
    "现金流",
    cashLines.length
      ? cashLines.map((line) => `· ${line}`).join("\n")
      : `· 自由现金流和股东回报还没核到完整数据。${shareholderReturns.length ? `公司有${shareholderReturns.map(cleanSentence).join("、")}机制，但要看是否可持续。` : "重点看经营现金流能否持续覆盖资本开支与回购分红。"}`,
    "",
    "主要风险",
    ...risks.map((item, index) => `${index + 1}. ${item}。`),
    "",
    "下一步看什么",
    ...monitors.map((item, index) => `${index + 1}. ${item}。`),
    "",
    "来源：",
    ...sourceLines(panel, dataSources, context.webEvidence),
    ...(quality.missing?.length ? [`\n还缺什么（不影响当前判断）：${quality.missing.slice(0, 6).join("、")}，补齐后可把财务质量从低置信度升到中高。`] : [])
  ];
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function falsifyReplyFromPanel(panel, _question = "", dataSources = {}, context = {}) {
  const profile = companyByTicker(panel?.ticker) || {};
  const name = panel?.companyName || profile.nameZh || panel?.ticker || "这家公司";
  const bear = Array.isArray(profile.bear) && profile.bear.length
    ? profile.bear.map(cleanSentence)
    : ["收入增速或利润率持续走弱", "竞争导致价格战、份额流失或费用上升", "自由现金流转负或股东回报中断"];
  const risks = Array.isArray(profile.risks) && profile.risks.length ? profile.risks.slice(0, 4).map(cleanSentence) : [];
  const monitors = Array.isArray(profile.monitors) && profile.monitors.length
    ? profile.monitors.slice(0, 5)
    : ["收入增速", "毛利率", "自由现金流", "回购/分红", "监管与竞争"];
  const bull = Array.isArray(profile.bull) && profile.bull.length ? cleanSentence(profile.bull[0]) : "核心业务能持续增长、利润率稳定、现金流改善";
  const triggers = [...bear, ...risks].filter((item, index, arr) => item && arr.indexOf(item) === index).slice(0, 6);

  const lines = [
    `北京时间 ${beijingMinute()}，要把 ${name} 的多头逻辑证伪，关键不是“出利空”，而是看到下面这些事实真正发生、并且改变利润池。`,
    "",
    "我的判断",
    `${name} 当前逻辑成立的前提是：${bull}。一旦这个前提被下面任意一两条打穿，就不该再用“便宜/被低估”来安慰自己，而要按逻辑重估。`,
    "",
    "会推翻逻辑的关键事实",
    ...triggers.map((item, index) => `${index + 1}. ${item}。`),
    "",
    "怎么提前观察",
    ...monitors.map((item, index) => `${index + 1}. ${item}：作为先行指标盯住趋势，而不是等财报盖棺。`),
    "",
    "来源：",
    ...sourceLines(panel, dataSources, context.webEvidence)
  ];
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

export function researchReplyFromPanel(panel, question = "", dataSources = {}, context = {}) {
  if (!panel) return "我还没有拿到足够上下文。先告诉我公司名称或港股代码，我会先做阶段判断。";
  if (isBusinessModelQuestion(question)) return businessModelReplyFromPanel(panel, question, dataSources);
  if (isCompetitorQuestion(question)) return competitorReplyFromPanel(panel, question, dataSources, context);
  if (isMoatQuestion(question)) return moatReplyFromPanel(panel, question, dataSources);
  if (isFinancialQualityQuestion(question)) return financialQualityReplyFromPanel(panel, question, dataSources, context);
  if (isFalsifyQuestion(question)) return falsifyReplyFromPanel(panel, question, dataSources, context);

  const status = RESEARCH_STATUS_LABELS[panel.researchStatus] || panel.researchStatus || "待判断";
  const missing = Array.isArray(panel.missingData) ? panel.missingData : [];
  const price = panel.price?.value && panel.price.value !== "暂不可用" ? panel.price.value : "暂不可用";
  const priceTime = panel.price?.timestamp || dataSources.market?.asOf || "时间待核";
  const fundamental = driver(panel, "基本面");
  const valuation = driver(panel, "估值");
  const risk = driver(panel, "风险信号");
  const shareholder = driver(panel, "股东回报");
  const name = panel.companyName || panel.ticker || "这家公司";
  const profile = companyByTicker(panel.ticker) || {};
  const fundamentalText = usefulSummary(
    fundamental,
    "结构化财务字段还不完整，先按商业模式、行业位置和后续财报验证做低置信度判断"
  );
  const valuationText = usefulSummary(
    valuation,
    "估值口径还没补齐，不能只用当前股价或单一倍数判断便宜"
  );
  const riskText = usefulSummary(
    risk,
    "外部新闻源本轮不足，风险先看行业竞争、监管、客户结构、利润率和公告缺口"
  );
  const shareholderText = usefulSummary(
    shareholder,
    "股东回报需要看回购、分红和自由现金流是否能持续"
  );
  const holding = panel.userContext?.cost || panel.userContext?.shares
    ? `你提供的持仓是成本 ${panel.userContext?.cost || "未提供"}，持股 ${panel.userContext?.shares || "未提供"}，这会影响回本赔率和仓位风险。`
    : "你还没有提供成本、持股和周期，所以我先按公司质量和研究赔率判断。";
  // 已验证外部信号（网页证据 + 实时新闻）——让本地兜底也基于真实证据，不只是 seed 档案。
  const signals = validatedSignalLines(context);
  const signalsFact = signals.length
    ? `6. 外部信号（本轮已验证，来自网页证据/实时新闻）：${signals.join("；")}。`
    : null;
  // 区间回报（近1月/年初至今）——美股可得时给动量上下文。
  const ranges = context.marketSnapshot?.ranges;
  const rangeFact = ranges?.providerStatus === "ok" && (ranges.oneMonthPct !== null || ranges.ytdPct !== null)
    ? `区间回报：近 1 月 ${fmtPct(ranges.oneMonthPct)}、年初至今 ${fmtPct(ranges.ytdPct)}（截至 ${ranges.asOf}）。这是市场位置，不等于公司价值。`
    : null;

  const lines = [
    `北京时间 ${beijingMinute()}，${name} 最近的状态是：${String(panel.oneLineView || panel.dataReadiness || `研究状态为${status}`).replace(/。$/, "")}。我不会因为数据缺口就停止判断，但会把置信度和证据缺口说清楚。`,
    "",
    "结论",
    `${name} 当前更适合归为“${status}”，不是一句买或卖能解决的问题。核心矛盾是：${fundamentalText}；同时 ${valuationText}。${holding}`,
    "",
    "事实",
    `1. 行情：当前可用价格口径是 ${price}，来源 ${panel.price?.source || dataSources.market?.provider || "未接入"}，时间 ${priceTime}。这只能说明市场状态，不能直接等同于公司价值。`,
    rangeFact,
    `2. 基本面：${humanStatus(fundamental?.status)}。${fundamentalText}。`,
    `3. 估值：${humanStatus(valuation?.status)}。${valuationText}。`,
    `4. 股东回报：${humanStatus(shareholder?.status)}。${shareholderText}。`,
    `5. 风险：${humanStatus(risk?.status)}。${riskText}。`,
    signalsFact,
    "",
    "推断",
    buildInferenceSection({ panel, question, dataSources }),
    "",
    "估值 / 风险",
    thesisLine("Bull Thesis", profile.bull, "如果后续财报证明收入恢复、利润率稳定、自由现金流没有继续恶化，同时估值口径补齐后仍有安全边际，市场会重新给它研究价值"),
    thesisLine("Bear Thesis", profile.bear, "如果竞争、监管、投入周期或客户需求继续压低利润和现金流，所谓便宜可能只是逻辑重估，而不是赔率改善"),
    `Base Case：我会把它先放在观察池，而不是给硬判断。观察重点是：${(profile.monitors || ["收入增速", "利润率", "自由现金流", "回购/分红", "监管和竞争"]).slice(0, 5).join("、")}。这些指标改善，赔率才会变好；如果同步恶化，低估值也可能是价值陷阱。`,
    "",
    "动作",
    "以下内容仅供分析参考，不构成投资建议。",
    "1. 先补最新财报和公告，确认收入、利润率、现金流是否同向改善。",
    "2. 如果有持仓，记录成本、股数、可承受回撤和计划周期，避免只按股价波动做判断。",
    "3. 如果需要更完整的材料，点击输入框里的“深度研究”，系统会把本轮对话、来源和证据补进当前对话流。",
    "",
    "证伪条件",
    `1. ${fundamental?.summary ? "基本面指标与当前判断相反" : "收入、利润率或现金流继续走弱"}。`,
    `2. ${risk?.summary || "行业竞争、监管、客户集中或资产负债风险持续扩大"}。`,
    `3. ${valuation?.summary ? "估值修复没有基本面支撑" : "估值口径补齐后发现并不便宜"}。`,
    `4. ${missing.length ? `关键证据长期补不上：${missing.slice(0, 4).join("、")}` : "新增公告出现与当前判断相反的信息"}。`,
    "",
    `我的判断：${name} 现在不能只看价格，也不能因为缺几项数据就放弃判断。${signals.length ? `本轮已把 ${signals.length} 条已验证外部信号纳入交叉印证（见“事实”第 6 条），而非只对着本地档案空谈；` : ""}更准确的说法是：商业逻辑先成立一部分，但最终要靠利润质量、自由现金流和股东回报来兑现。关键不是赌一个反弹，而是确认业务增长、利润质量和现金流能不能穿透当前风险。`,
    "",
    "还缺什么（不影响当前判断，只影响置信度）",
    backendGapLines(panel, dataSources)[0] || "关键证据基本到位，下一步主要做交叉校验。",
    "",
    "来源：",
    ...sourceLines(panel, dataSources, context.webEvidence)
  ];

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

export function normalizeResearchAnswer(content, panel, dataSources = {}) {
  if (!panel) return content;
  let text = String(content || "").trim();
  // 模型有时把开头写成"北京时间2026…"（漏空格），先补空格，避免下面的去重判断误判。
  text = text.replace(/^北京时间(\d{4})/, "北京时间 $1");
  // 仅当模型自己没带时间前缀时才补一句；正则放宽到"北京时间 + 日期"，不强求时分，
  // 防止重复塞前缀。oneLineView 已自带句号，先去掉避免出现"。。"。
  if (!/^北京时间\s*\d{4}-\d{2}-\d{2}/.test(text)) {
    const view = String(panel.oneLineView || panel.dataReadiness || "需要继续验证").replace(/。+$/, "");
    text = `北京时间 ${beijingMinute()}，${panel.companyName || panel.ticker} 最近的状态是：${view}。\n\n${text}`;
  }
  if (!/来源[:：]/.test(text)) {
    text += `\n\n来源：\n${sourceLines(panel, dataSources).join("\n")}`;
  }
  return text;
}

// 涨跌百分比格式化（带 +/- 号）。null → "—"。
function fmtPct(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return "—";
  const n = Number(pct);
  return `${n > 0 ? "+" : ""}${n}%`;
}

// 对话上文：把最近几轮对话压缩进 prompt，让追问能承接（"它的竞对是谁""那第二个呢"）。
// 当前研究主体仍以最新问题 + 已接入数据为准——这里只供承接语义，明确叮嘱不要从上文
// 翻出旧公司当新主题，避免张冠李戴。assistant 内容截断，避免把整段长回答塞回去。
function conversationHistoryBlock(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const turns = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-6)
    .map((m) => {
      const who = m.role === "user" ? "用户" : "你";
      const limit = m.role === "user" ? 200 : 420;
      let text = String(m.content).replace(/\s+/g, " ").trim();
      if (text.length > limit) text = `${text.slice(0, limit)}…`;
      return `${who}：${text}`;
    });
  if (!turns.length) return "";
  return `对话上文（最近几轮，供承接追问用；当前研究主体仍以"用户问题"和下面已接入数据为准，不要从这里翻出旧公司当成本轮新主题）：
${turns.join("\n")}
`;
}

// 对话内对比块：把"对比对象"那一家本轮已核到的数据收成一段，喂给作答 agent 并排比较。
function buildCompareBlock(compare) {
  if (!compare) return "";
  const ms = compare.marketSnapshot || {};
  const price = ms.price != null
    ? `${ms.price}${ms.currency ? ` ${ms.currency}` : ""}${ms.changePercent != null ? `（${Number(ms.changePercent).toFixed(2)}%）` : ""}`
    : "未核到";
  const r = ms.ranges;
  const rangeStr = r?.providerStatus === "ok" ? `；区间回报 近1月 ${fmtPct(r.oneMonthPct)}、年初至今 ${fmtPct(r.ytdPct)}` : "";
  const finStr = compare.financialsData?.providerStatus === "ok"
    ? financialsToMarkdown(compare.financialsData)
    : "完整三表未核到";
  const valStr = compare.valuation ? valuationPromptLine(compare.valuation) : "暂无自洽估值口径";
  const anaStr = compare.analyst?.target
    ? `分析师一致目标价 ${compare.analyst.target}${compare.analyst.upsidePct != null ? `（较现价 ${compare.analyst.upsidePct}%）` : ""}`
    : "暂无一致预期";
  // A-P1.2：对比对象的近期头条（2-3 条），让对比散文能引用对方一手事件，而非只比行情/财报。
  const news = compare.newsSnapshot?.providerStatus === "ok" ? compare.newsSnapshot.articles || [] : [];
  const newsStr = news.length
    ? news.slice(0, 3).map((a) => `- ${a.title}${a.source ? `（${String(a.source).split(" · ")[0]}）` : ""}`).join("\n")
    : "近期新闻未核到";
  return `
【对比对象：${compare.name}（${compare.ticker}）——本轮已核到的真实数据，用于并排比较】
现价：${price}${rangeStr}
估值：${valStr}
分析师：${anaStr}
财务（实时口径）：${finStr}
近期头条：
${newsStr}
`;
}

// P0 对话内多标的块：把"当前公司之外、用户提到的其他持仓"各自本轮已核到的真实数据收成一段。
// 关键反幻觉约束：以这里的真实行情为准，即使模型印象里某公司"尚未上市/是私人公司"。
function buildHoldingsBlock(otherHoldings) {
  if (!Array.isArray(otherHoldings) || !otherHoldings.length) return "";
  const lines = otherHoldings.map((h) => {
    const c = h.company || {};
    const ms = h.summary?.marketSnapshot || {};
    const price = ms.price != null
      ? `${ms.price}${ms.currency ? ` ${ms.currency}` : ""}${ms.changePercent != null ? `（${Number(ms.changePercent).toFixed(2)}%）` : ""}`
      : "本轮未核到实时行情";
    const pos = [];
    if (h.shares != null) pos.push(`持股 ${h.shares}`);
    if (h.cost != null) pos.push(`成本 ${h.cost}`);
    if (ms.price != null && h.cost != null) {
      const pnlPct = ((ms.price - h.cost) / h.cost) * 100;
      pos.push(`浮动 ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`);
    }
    const valStr = h.summary?.valuation ? valuationPromptLine(h.summary.valuation) : "暂无自洽估值口径";
    const anaStr = h.summary?.analyst?.target
      ? `分析师一致目标价 ${h.summary.analyst.target}${h.summary.analyst.upsidePct != null ? `（较现价 ${h.summary.analyst.upsidePct}%）` : ""}`
      : "暂无一致预期";
    return `- ${c.nameZh || h.summary?.name || c.ticker}（${c.ticker}）：现价 ${price}${pos.length ? `；${pos.join("、")}` : ""}；估值 ${valStr}；${anaStr}`;
  }).join("\n");
  return `
【本轮已核到的其他标的（用户在本对话里提到的其他持仓）——以下行情/估值是真实数据，是这些标的的唯一事实源】
${lines}
（重要：上面这些公司都是**已校验的上市标的**，请直接基于这里的真实行情判断；即使你印象里某家"尚未上市/是私人公司"，也以本轮已核到的真实代码与行情为准，绝不据旧知识否定它已上市。）
`;
}

export function buildChatPrompt(question, panel, dataSources = {}, context = {}) {
  const drivers = (panel.keyDrivers || []).map((d) => `- ${d.name}：${d.status}。${d.summary}`).join("\n");
  const missing = (panel.missingData || []).join("、") || "无";
  const connected = (panel.connectedData || []).join("、") || "无";
  const sources = sourceLines(panel, dataSources).join("\n");
  const profile = companyByTicker(panel.ticker);
  const moat = profile?.moat?.join("、") || "本地档案暂缺";
  const businessModel = profile?.businessModel?.join("；") || "本地档案暂缺";
  const profileMetrics = Array.isArray(profile?.metrics)
    ? profile.metrics.map((m) => `${m[0]}=${m[1]}（${m[2] || "待验证"}）`).join("；")
    : "本地档案暂缺";
  const bull = profile?.bull?.join("；") || "本地档案暂缺";
  const bear = profile?.bear?.join("；") || "本地档案暂缺";
  const monitors = profile?.monitors?.join("、") || "收入增速、利润率、自由现金流、回购/分红";
  const moatMode = isMoatQuestion(question);
  const businessMode = isBusinessModelQuestion(question);
  const competitorMode = isCompetitorQuestion(question);
  const financialMode = isFinancialQualityQuestion(question);
  const falsifyMode = isFalsifyQuestion(question);
  const hasLiveFin = context.financialsData?.providerStatus === "ok";
  // Real three-statement data (US via FMP) is the single source of truth for any
  // financial number — foreground it so the model stops reasoning from the seed archive.
  const liveFinancialsBlock = hasLiveFin
    ? financialsToMarkdown(context.financialsData)
    : (() => {
        const fq = computeFinancialQuality(context.financialsData || null, {
          marketCap: context.marketSnapshot?.marketCap,
          pe: context.marketSnapshot?.pe
        });
        return Array.isArray(fq.metrics) && fq.metrics.length
          ? fq.metrics.map((m) => `${m.name}=${m.display}`).join("；")
          : "完整三表暂未核到（仅本地档案口径）";
      })();
  const competitorCandidates = competitorSetFor(profile || { ticker: panel.ticker })
    .map((item) => `- ${item.name}${item.ticker ? `（${item.ticker}）` : ""}：${item.angle}。${item.note}`)
    .join("\n") || "本地档案暂缺";
  const newsSignals = [...evidenceSignalsFromWeb(context.webEvidence), ...evidenceSignalsFromNews(context.newsSnapshot)].slice(0, 8).join("\n") || "本轮没有抓到可直接使用的竞争/行业外部信号";
  const webEvidencePrompt = webEvidenceToPrompt(context.webEvidence);
  const portraitBlock = context.portraitContext ? `\n${context.portraitContext}\n` : "";
  const historyBlock = conversationHistoryBlock(context.history);
  const ranges = context.marketSnapshot?.ranges;
  const rangeLine = ranges?.providerStatus === "ok" && (ranges.oneMonthPct !== null || ranges.ytdPct !== null)
    ? `区间回报：近1月 ${fmtPct(ranges.oneMonthPct)}、年初至今 ${fmtPct(ranges.ytdPct)}（截至 ${ranges.asOf}）`
    : "";
  const compareBlock = buildCompareBlock(context.compare);
  const dual = context.dualListing;
  const dualQuote = context.dualQuote;
  const dualAskedHk = !!(dual && dual.asked && /\.HK$/i.test(dual.asked));
  const holdingsBlock = buildHoldingsBlock(context.otherHoldings);
  const hasHoldings = !context.compare && Boolean(context.otherHoldings?.length);
  // P-CN-3：A 股专属分析师视角要素——只在研究对象是 A 股时注入，避免给港股/美股问题
  // 塞进不相关的交易机制细节。涨跌停/T+1 是交易约束，只用于解释流动性/波动，不越权给
  // 买卖时点建议；商誉/解禁没有专门的一手数据源（P-CN-2 阶段只摄取三大报表关键行，
  // 不含资产负债表商誉明细、也不含限售股解禁日历），所以只能定性提示"存在这类结构性
  // 风险"，不能编造具体商誉规模/减值金额/解禁日期——编具体数字比不提更糟。
  const cnContextLine = detectMarket(panel.ticker) === "CN"
    ? `\n- 本标的是 A 股（沪深上市）：交易机制上 T+1 交收（当日买入次日才能卖出）、涨跌幅限制通常 ±10%（ST/*ST 股 ±5%，创业板/科创板 ±20%），讨论流动性/短期波动风险时可以提及这些约束，但不能当成买卖时点建议；财务风险描述可以提示"关注资产负债表商誉减值风险""关注股东限售解禁/减持计划对短期股价的压制"这类定性判断，但本轮未核到具体商誉规模或解禁日期的，绝不能编造具体数字或日期；北向资金（沪深港通）持仓变化只能当资金面/情绪参考信号，不能作为基本面判断的主证据。`
    : "";
  return `用户问题：${question}
${historyBlock}${portraitBlock}
当前研究对象：${panel.companyName}（${panel.ticker}）
研究状态：${RESEARCH_STATUS_LABELS[panel.researchStatus] || panel.researchStatus}
数据完整度：${panel.dataCompleteness}%
一句话判断：${panel.oneLineView || "尚无——请基于下方材料自行形成（不要把数据可用性描述当判断）"}
用户上下文：成本 ${panel.userContext?.cost || "未提供"}，持股 ${panel.userContext?.shares || "未提供"}，周期 ${panel.userContext?.horizon || "未提供"}
北京时间：${beijingMinute()}

关键卡片：
${drivers}

已接入数据：${connected}
缺失数据：${missing}
行情：${dataSources.market?.provider || panel.price?.source || "缺失"}，${panel.price?.value || "缺失"}${panel.price?.change && panel.price.change !== "暂不可用" ? `（${panel.price.change}）` : ""}${panel.price?.timestamp ? `，截至 ${panel.price.timestamp}` : ""}
${rangeLine ? `${rangeLine}\n` : ""}${compareBlock}${holdingsBlock}来源候选：
${sources}
${hasLiveFin
    ? `已核到的实时财报（来源 ${context.financialsData.source}${context.financialsData.period ? ` · 截至 ${context.financialsData.period}` : ""}）——本轮所有财务数字的唯一事实源：\n${liveFinancialsBlock}`
    : `实时财报：${liveFinancialsBlock}`}
本地公司档案（定性参考，不能当财务数字来源）：
- 护城河：${moat}
- 商业模式：${businessModel}
- 财务观察（定性，非实时）：${profileMetrics}
- 估值区间（与前端可视化口径一致，回答涉及估值/赔率时必须对齐，禁止给出与之矛盾的目标价）：${valuationPromptLine(context.valuation)}${compPeersPromptLine(context.valuation?.compPeers)}
- 下一业绩日：${earningsPromptLine(context.earnings)}
- Bull：${bull}
- Bear：${bear}
- 监控项：${monitors}
- 竞品候选：
${competitorCandidates}
- 新闻头条（仅作情绪参考，不能当基本面主证据；基本面结论以上面的财报/估值/指引等一手口径为准）：
${newsSignals}
- 公开网页证据：
${webEvidencePrompt}

回答规则：
- 输出中文纯文本，可以用短标题，但不要 Markdown 表格。
- 第一行必须以“北京时间 ${beijingMinute()}，”开头。若是泛研究问题，用“${panel.companyName} 最近的状态是：……”；若是单点追问，直接回答用户问的那个点。
- 保持像真实投研对话，不要写成产品说明，不要说“我将/我会获取”。
- ${context.compare ? `本轮是【对比任务】：把当前研究对象 ${panel.companyName} 与上面"对比对象 ${context.compare.name}"并排比较。段落固定用：简单结论、现价与估值、利润质量、护城河与商业模式、区间回报与动量、分析师预期、风险与赔率、我的判断。每个维度都要两家都讲、点明谁更优及原因；"我的判断"明确给出谁的赔率/质量更好以及成立前提。只用两家已核到的真实数据，缺的维度说一句即可。禁止买卖建议。不要输出单公司的完整研究模板。` : hasHoldings ? `本轮用户同时问了多只持仓/标的，这是【多标的/组合任务】。必须**逐只**基于上面"本轮已核到的其他标的"的真实行情/估值给判断，并给出**组合合计**视角。段落固定用：结论（点明组合整体盈亏方向 + 各标的浮动）、分标的看（每只一段：性质/估值/赔率/各自浮动盈亏）、组合视角（集中度与风险结构、谁稳谁弹）、动作（研究语言、禁买卖建议）、证伪条件、来源。合计盈亏要把当前研究对象的成本/持股 + 上面其他标的的成本/持股一起算。严禁因旧知识否定任何已核到的标的（例如说某股"还没上市"）。不要输出单公司的完整研究模板。` : businessMode ? "用户问的是靠什么赚钱/商业模式/收入来源。只回答这个问题，段落用：简单说、拆开看、关键判断、主要风险、来源。不要输出完整研究模板。" : competitorMode ? "用户问的是竞争对手/竞品/竞争格局。只回答竞争格局，段落用：简单结论、主要竞争对手、怎么理解竞争格局、我的判断、接下来重点看、来源。不要输出完整研究模板，不要写估值/动作大模板。" : moatMode ? "用户问的是护城河/竞争优势。只围绕护城河回答，段落用：结论、护城河拆解、商业模式、我的判断、风险 / 证伪、下一步看什么、来源。不要输出完整行情模板。" : financialMode ? "用户问的是赚不赚钱/盈利质量/利润/现金流。只回答财务质量，段落用：我的判断、靠什么赚钱、利润质量、现金流、主要风险、下一步看什么、来源。先给判断再讲依据，优先使用上面‘已核到的实时财务口径’，缺数据只说一句、放到末尾，不要输出完整研究模板。" : falsifyMode ? "用户问的是什么情况会证伪/会推翻逻辑。只回答证伪，段落用：我的判断、会推翻逻辑的关键事实、怎么提前观察、来源。先点明当前多头逻辑成立的前提，再列出哪些事实出现就要重估，使用 Bull/Bear/监控项档案，不要输出完整研究模板。" : "必须包含这些段落，顺序固定：结论、事实、推断、估值 / 风险、动作、证伪条件、我的判断、还缺什么（折叠在末尾、只影响置信度）、来源。"}
- “事实”尽量编号，引用当前可用数据；不能编造具体数值。若某项缺失，写“当前未核到/来源缺失”，但继续给推断。
- 凡涉及收入/利润/利润率/现金流/EPS/回购分红的具体数字，只能引用上面“已核到的实时财报”块；本地档案只提供定性判断（护城河/商业模式/多空逻辑），不得作为财务数字来源。${hasLiveFin ? "本轮已有实时财报，必须用真实数字支撑财务判断，不要再写“未核到完整三表/仅本地档案口径”。" : "本轮无实时财报：严禁给出任何具体财务数字或其估算值（包括收入/利润/EPS/利润率/现金流的绝对值，以及“约”“大约”“行业常见范围”这类措辞），只能定性描述赚钱机制与风险并说明置信度下降；要数字就明说“需核最新财报”。"}
- 讨论同业/竞对的估值倍数（PE/EV-Sales 等具体数字）时，只能引用上面"同业对照"里列出的公司和倍数；讨论下一次财报/业绩日时，只能引用上面"下一业绩日"给的日期；两者都没核到时只能说"未核到"，不能凭自己的知识编造其它公司、倍数或日期。**"按行业常识/框架推演/仅供参考"这类免责措辞不能当成编数字的许可证**——给同业公司点名却配一个编出来的倍数，本质还是编数字，标不标"框架"都不行；没有真实数据就只做定性描述，不点具体公司名+具体数字的组合。
- 不要使用“暂不评分”“完整度xx%”“需要补充材料”“未接入”这种产品状态词，改成研究语言：当前未核到、置信度下降。
- 用户提到的任何股票代码/公司，即使你印象里它“没上市/不是标准代码/是私人公司”，也**绝不**断言它不存在、拒绝评估、或建议换成别的代码——它很可能是你知识截止后才上市的新票（如刚 IPO 的标的）。本轮没核到它的实时数据时，只说“本轮未能核到 X 的实时数据、置信度下降”，照常基于其余已核到的标的给判断。${dual ? `\n- 本标的港美双重上市（港股 ${dual.hk}｜美股 ${dual.us}）。基本面/估值本轮一律按**美股 ADR ${dual.us}** 口径（数据更全）。${dualQuote ? `用户问的是港股，已核到**港股 ${dualQuote.ticker} 实时价 ${dualQuote.price} ${dualQuote.currency}${dualQuote.changePct != null ? `（${dualQuote.changePct >= 0 ? "+" : ""}${dualQuote.changePct}%）` : ""}**：盈亏**必须**用这个港股价 + 用户 HKD 成本算${dualQuote.cost != null ? `（成本 ${dualQuote.cost}${dualQuote.shares != null ? `、持股 ${dualQuote.shares}` : ""}${dualQuote.pnlPct != null ? ` → 浮动 ${dualQuote.pnlPct >= 0 ? "+" : ""}${dualQuote.pnlPct}%` : ""}）` : ""}，**绝不**用 ADR 美元价算港股盈亏；估值/基本面继续用 ADR ${dual.us} 口径。` : dualAskedHk ? `用户问的是**港股 ${dual.hk}**：本轮未取到港股实时价，盈亏只说明口径（按港股价 + HKD 成本），**不要**用 ADR 美元价硬算港股盈亏，提示用户可按港股实时价换算。` : `若用户持有的是港股 ${dual.hk}，提示其盈亏需按港股价 + HKD 成本另算，不要用 ADR 美元价硬套。`}` : ""}${cnContextLine}
- “还缺什么”只在末尾出现一段，且只说还缺哪些事实会提高置信度（如完整三表、最新公告、一致预期），不要写产品后台/数据源厂商名字，不要让缺口抢正文。
- “推断”必须是全回答的信息密度最高部分，不能少于 4 个自然段；必须依次讲：赚钱机制、护城河是否能转成利润、财务兑现路径、估值重估变量。必须使用上面的本地公司档案，不能只写“第一层/第二层”的空框架。
- 对“赚不赚钱”，必须先回答赚钱机制和盈利质量：是否有收入来源、利润是否稳定、现金流是否支撑。
- 不允许只说数据不足；数据不足只能作为置信度和证伪条件的一部分。
- 禁止买入/卖出/持有建议，使用“观察、补充验证、赔率改善、逻辑重估”等研究语言。
- 长度控制在 900-1800 字，信息密度优先。`;
}

/**
 * Merge validated web evidence into the decision panel so it persists with the
 * session and powers the clickable provenance UI. Evidence is appended to
 * panel.sources (deduped) with its source type, date and credibility.
 */
/** One-line valuation summary for the model prompt, so prose matches the bar. */
function valuationPromptLine(valuation) {
  if (!valuation || valuation.cannotValueReason) return "暂无自洽估值口径（缺 EPS/FCF，待财报或 FMP 补齐）。";
  const price = parseFloat(valuation.currentPrice);
  const bull = parseFloat(valuation.bull);
  const bear = parseFloat(valuation.bear);
  const odds = price && bull && bear && price > bear ? ((bull - price) / (price - bear)).toFixed(1) : null;
  const analyst = valuation.analyst?.target
    ? `；分析师一致目标价 ${valuation.analyst.target}${valuation.analyst.upside ? `（较现价 ${valuation.analyst.upside}）` : ""}${valuation.analyst.low && valuation.analyst.high ? `，区间 ${valuation.analyst.low}~${valuation.analyst.high}` : ""}`
    : "";
  return `方法 ${valuation.method}；看空 ${valuation.bear} / 中性 ${valuation.base} / 看多 ${valuation.bull}，现价 ${valuation.currentPrice}${odds ? `，回报:风险赔率约 ${odds}:1` : ""}${analyst}。`;
}

/**
 * G-3/R3：同业清单渲染成一行 prompt 文本——不接这个，模型讨论"同业对比"时只能凭自己的
 * 通用知识编竞对（实测过：会说出真实 Finnhub 同业清单里根本没有的公司），R3 的数字级
 * 校验也会把几乎所有"同业倍数"判成"未核到"。明确要求模型只能引用这里列出的公司和倍数。
 */
function compPeersPromptLine(compPeers) {
  if (!compPeers || compPeers.providerStatus !== "ok" || !compPeers.peers?.length) {
    // 用 compPeers.detail 给的真实原因（如"财务数据不足，无法判断估值阶段"），不要写死
    // 港股 ADR 措辞——之前固定写"Finnhub 无法识别港股 ADR 映射"，对美股这类原因完全不成立，
    // 读起来像技术故障而不是清楚的"没有这项数据"，反而更容易被模型当成可以绕过的空子
    // （真实实测过：AAPL 同业缺失时，模型仍然按"行业常识"编了微软/谷歌/Meta 的具体 PE
    // 倍数，还美其名曰"框架推演"）。
    const reason = compPeers?.detail || "同业数据未核到";
    return `；${reason}——讨论同业时只能定性描述（如"该行业倍数通常偏高/偏低"），绝对不能给任何具体公司的具体倍数数字，哪怕标注"仅供参考"或"行业常识估算"也不行；只要点了公司名就必须配一个真实数字，宁可不点名。反面例子（禁止这样写）："苹果PE约30倍""腾讯约20倍PE""国内厂商8-15x"——这些都是编数字，就算加"约""常识估算"也不行；正确写法只能是"苹果等同业公司的估值暂未核到，无法直接对标"，不点出任何具体倍数`;
  }
  const peerList = compPeers.peers
    .map((p) => `${p.ticker}${p.multiple != null ? ` ${p.multipleType} ${Number(p.multiple).toFixed(1)}x` : "（数据不可用）"}`)
    .join("、");
  const anchor = compPeers.anchor
    ? `；同业锚点 ${compPeers.anchor.multipleType} p25 ${compPeers.anchor.p25.toFixed(1)}x / 中位 ${compPeers.anchor.median.toFixed(1)}x / p75 ${compPeers.anchor.p75.toFixed(1)}x（${compPeers.anchor.n} 家计入）`
    : "；同业数量不足未生成锚点";
  return `\n  同业对照（Finnhub 自动匹配，讨论同业/竞对估值倍数时只能引用这里列出的公司和倍数，不能凭自己的知识编造其它公司或倍数，也不能给清单之外的公司编具体数字）：${peerList}${anchor}`;
}

/** G-2/R3：下一业绩日渲染成一行 prompt 文本，供正文引用；没核到就明说，不能编日期。 */
function earningsPromptLine(earnings) {
  if (!earnings || earnings.providerStatus !== "ok" || !earnings.nextDate) {
    return `未核到${earnings?.detail ? `（${earnings.detail}）` : ""}，不能编造具体日期`;
  }
  return `${earnings.nextDate}（来源 ${earnings.source}${earnings.stale ? "，缓存数据" : ""}）`;
}

export function mergeEvidenceIntoPanel(panel, webEvidence) {
  if (!panel) return panel;
  const evidence = Array.isArray(webEvidence?.evidence) ? webEvidence.evidence : [];
  if (!evidence.length) return panel;
  const sources = Array.isArray(panel.sources) ? [...panel.sources] : [];
  const seen = new Set(sources.map((s) => s.url).filter(Boolean));
  for (const item of evidence.slice(0, 6)) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    sources.push({
      label: item.title || item.source || "网页证据",
      url: item.url,
      type: item.sourceType || "web",
      timestamp: item.publishedAt || null,
      credibility: item.credibilityScore ?? null,
      origin: "web_evidence"
    });
  }
  panel.sources = sources.slice(0, 12);
  return panel;
}

/**
 * Deep-research report prompt — judgment-first, research-grade. Unlike the
 * chat prompt, this asks for a full structured report, but keeps data-gap talk
 * minimal and never exposes backend/vendor language to the reader.
 */
export function buildReportPrompt(question, panel, dataSources = {}, context = {}) {
  const profile = companyByTicker(panel.ticker) || {};
  const name = panel.companyName || profile.nameZh || panel.ticker;
  const moat = profile?.moat?.join("、") || "本地档案暂缺";
  const businessModel = profile?.businessModel?.join("；") || "本地档案暂缺";
  const bull = profile?.bull?.join("；") || "本地档案暂缺";
  const bear = profile?.bear?.join("；") || "本地档案暂缺";
  const monitors = profile?.monitors?.join("、") || "收入增速、利润率、自由现金流、回购/分红";
  const hasLiveFin = context.financialsData?.providerStatus === "ok";
  const liveFinancialsBlock = hasLiveFin
    ? financialsToMarkdown(context.financialsData)
    : (() => {
        const fq = computeFinancialQuality(context.financialsData || null, {
          marketCap: context.marketSnapshot?.marketCap,
          pe: context.marketSnapshot?.pe
        });
        return Array.isArray(fq.metrics) && fq.metrics.length
          ? fq.metrics.map((m) => `${m.name}=${m.display}`).join("；")
          : "完整三表暂未核到（以本地档案与商业逻辑为主）";
      })();
  const competitorCandidates = competitorSetFor(profile || { ticker: panel.ticker })
    .map((item) => `- ${item.name}${item.ticker ? `（${item.ticker}）` : ""}：${item.angle}`)
    .join("\n") || "本地档案暂缺";
  const webEvidencePrompt = webEvidenceToPrompt(context.webEvidence);
  const price = panel.price?.value && panel.price.value !== "暂不可用" ? panel.price.value : "暂不可用";

  return `请基于以下材料，为 ${name}（${panel.ticker}）写一份资深买方研究员风格的深度研究报告。
用户问题：${question || `${name} 值不值得研究`}
北京时间：${beijingMinute()}
当前价格口径：${price}（来源 ${panel.price?.source || dataSources.market?.provider || "公开行情"}）
一句话判断（参考，可改写）：${panel.oneLineView || "尚无既有判断，请基于本轮证据自行给出"}

${hasLiveFin
    ? `已核到的实时财报（来源 ${context.financialsData.source}${context.financialsData.period ? ` · 截至 ${context.financialsData.period}` : ""}）——本报告所有财务数字的唯一事实源：\n${liveFinancialsBlock}\n`
    : `实时财报：${liveFinancialsBlock}\n`}
公司档案（定性参考，不能当财务数字来源）：
- 护城河：${moat}
- 商业模式：${businessModel}
- 估值区间（与前端可视化口径一致，回答涉及估值/赔率时必须对齐，禁止给出与之矛盾的目标价）：${valuationPromptLine(context.valuation)}
- Bull：${bull}
- Bear：${bear}
- 监控项：${monitors}
- 主要竞争对手：
${competitorCandidates}
- 公开网页证据（已校验可用链接）：
${webEvidencePrompt}

写作规则：
- 输出中文 Markdown（可用 ## 小标题、有序/无序列表，但不要表格）。
- 判断优先：开头第一段直接给“核心判断”——它现在赚不赚钱、质量如何、最大的赌点和最大的风险各是什么。不要用“我将分析/数据不足”开场。
- 固定结构，依次：## 核心判断、## 赚钱机制与护城河、## 财务质量、## 估值与赔率、## 风险与证伪条件、## 关键监控与下一步、## 来源。
- 财务/估值用上面“已核到的实时财务口径”，不能编造具体数值；缺某项就用研究语言说“当前未核到/置信度下降”，但仍要给方向性判断。
- 严禁出现“数据完整度xx%、暂不评分、未接入、需要补充材料、配置 API_KEY、FMP/EODHD/Finnhub”等任何后台/产品/厂商词。缺口最多在“关键监控与下一步”里用一两句研究语言带过。
- “## 来源”只列上面给出的可用链接与公司官方/行情来源，不要编造链接。
- 不给买入/卖出/持有指令，用“观察、补充验证、赔率改善、逻辑重估”等研究语言。结尾不需要再写免责声明（系统会附加）。
- 长度 1500-3000 字，信息密度优先。`;
}
