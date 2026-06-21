import { RESEARCH_STATUS_LABELS } from "../schemas/agentPanel.js";
import { companies, companyByTicker } from "../../data.js";
import { classifyResearchIntent, RESEARCH_INTENTS } from "./intentClassifier.js";
import { webEvidenceToPrompt } from "./webEvidenceService.js";
import { computeFinancialQuality } from "./financialQuality.js";

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

function formatBeijingMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
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
    `- 公司档案：Luvio 本地研究档案`
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

function competitorReplyFromPanel(panel, question = "", dataSources = {}, context = {}) {
  const profile = companyByTicker(panel?.ticker) || {};
  const name = panel?.companyName || profile.nameZh || panel?.ticker || "这家公司";
  const competitors = competitorSetFor({ ...profile, ticker: panel?.ticker || profile.ticker });
  const moat = Array.isArray(profile.moat) && profile.moat.length ? profile.moat.slice(0, 4) : ["规模", "渠道", "品牌", "客户关系"];
  const risks = Array.isArray(profile.risks) && profile.risks.length ? profile.risks.slice(0, 4).map(cleanSentence) : ["价格竞争", "技术变化", "客户流失", "利润率下滑"];
  const monitors = Array.isArray(profile.monitors) && profile.monitors.length ? profile.monitors.slice(0, 5) : ["收入增速", "利润率", "市场份额", "客户留存", "现金流"];
  const evidenceSignals = [...evidenceSignalsFromWeb(context.webEvidence), ...evidenceSignalsFromNews(context.newsSnapshot)].slice(0, 5);

  return [
    `北京时间 ${formatBeijingMinute()}，${name}的竞争对手不能只按“同一个行业”列名字，要按它在哪些利润池里赚钱来拆。`,
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

function businessModelReplyFromPanel(panel, question = "", dataSources = {}) {
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
    `北京时间 ${formatBeijingMinute()}，${name} 靠什么赚钱，核心不是一句“做平台”，而是看哪些业务真正贡献高质量利润。`,
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

function moatReplyFromPanel(panel, question = "", dataSources = {}) {
  const profile = companyByTicker(panel?.ticker);
  const name = panel?.companyName || profile?.nameZh || panel?.ticker || "这家公司";
  const moat = profile?.moat?.length ? profile.moat : ["用户/客户关系", "规模效应", "品牌与渠道", "技术或数据积累"];
  const business = profile?.businessModel?.length ? profile.businessModel : [];
  const risks = profile?.risks?.length ? profile.risks : ["竞争加剧", "利润率下滑", "监管或商业模式变化"];
  const sources = sourceLines(panel, dataSources);

  return [
    `北京时间 ${formatBeijingMinute()}，${name} 的护城河不能只看“规模大”，要看它能不能持续带来定价权、用户留存、低获客成本和现金流。`,
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

function financialQualityReplyFromPanel(panel, question = "", dataSources = {}, context = {}) {
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
    `北京时间 ${formatBeijingMinute()}，${name} 赚不赚钱，要分三层看：靠什么赚钱、利润是不是高质量、现金流能不能兜住。`,
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

function falsifyReplyFromPanel(panel, question = "", dataSources = {}, context = {}) {
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
    `北京时间 ${formatBeijingMinute()}，要把 ${name} 的多头逻辑证伪，关键不是“出利空”，而是看到下面这些事实真正发生、并且改变利润池。`,
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

  const lines = [
    `北京时间 ${formatBeijingMinute()}，${name} 最近的状态是：${String(panel.oneLineView || `研究状态为${status}`).replace(/。$/, "")}。我不会因为数据缺口就停止判断，但会把置信度和证据缺口说清楚。`,
    "",
    "结论",
    `${name} 当前更适合归为“${status}”，不是一句买或卖能解决的问题。核心矛盾是：${fundamentalText}；同时 ${valuationText}。${holding}`,
    "",
    "事实",
    `1. 行情：当前可用价格口径是 ${price}，来源 ${panel.price?.source || dataSources.market?.provider || "未接入"}，时间 ${priceTime}。这只能说明市场状态，不能直接等同于公司价值。`,
    `2. 基本面：${humanStatus(fundamental?.status)}。${fundamentalText}。`,
    `3. 估值：${humanStatus(valuation?.status)}。${valuationText}。`,
    `4. 股东回报：${humanStatus(shareholder?.status)}。${shareholderText}。`,
    `5. 风险：${humanStatus(risk?.status)}。${riskText}。`,
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
    `我的判断：${name} 现在不能只看价格，也不能因为缺几项数据就放弃判断。更准确的说法是：商业逻辑先成立一部分，但最终要靠利润质量、自由现金流和股东回报来兑现。关键不是赌一个反弹，而是确认业务增长、利润质量和现金流能不能穿透当前风险。`,
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
  if (!/^北京时间\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) {
    text = `北京时间 ${formatBeijingMinute()}，${panel.companyName || panel.ticker} 最近的状态是：${panel.oneLineView || "需要继续验证"}。\n\n${text}`;
  }
  if (!/来源[:：]/.test(text)) {
    text += `\n\n来源：\n${sourceLines(panel, dataSources).join("\n")}`;
  }
  return text;
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
  const fq = computeFinancialQuality(context.financialsData || null, {
    marketCap: context.marketSnapshot?.marketCap,
    pe: context.marketSnapshot?.pe
  });
  const liveFinancials = Array.isArray(fq.metrics) && fq.metrics.length
    ? fq.metrics.map((m) => `${m.name}=${m.display}`).join("；")
    : "完整三表暂未核到（仅本地档案口径）";
  const competitorCandidates = competitorSetFor(profile || { ticker: panel.ticker })
    .map((item) => `- ${item.name}${item.ticker ? `（${item.ticker}）` : ""}：${item.angle}。${item.note}`)
    .join("\n") || "本地档案暂缺";
  const newsSignals = [...evidenceSignalsFromWeb(context.webEvidence), ...evidenceSignalsFromNews(context.newsSnapshot)].slice(0, 8).join("\n") || "本轮没有抓到可直接使用的竞争/行业外部信号";
  const webEvidencePrompt = webEvidenceToPrompt(context.webEvidence);
  const portraitBlock = context.portraitContext ? `\n${context.portraitContext}\n` : "";
  return `用户问题：${question}
${portraitBlock}
当前研究对象：${panel.companyName}（${panel.ticker}）
研究状态：${RESEARCH_STATUS_LABELS[panel.researchStatus] || panel.researchStatus}
数据完整度：${panel.dataCompleteness}%
一句话判断：${panel.oneLineView}
用户上下文：成本 ${panel.userContext?.cost || "未提供"}，持股 ${panel.userContext?.shares || "未提供"}，周期 ${panel.userContext?.horizon || "未提供"}
北京时间：${formatBeijingMinute()}

关键卡片：
${drivers}

已接入数据：${connected}
缺失数据：${missing}
行情：${dataSources.market?.provider || panel.price?.source || "缺失"}，${panel.price?.value || "缺失"}
来源候选：
${sources}
本地公司档案：
- 护城河：${moat}
- 商业模式：${businessModel}
- 财务观察（本地档案）：${profileMetrics}
- 已核到的实时财务口径：${liveFinancials}
- 估值区间（与前端可视化口径一致，回答涉及估值/赔率时必须对齐，禁止给出与之矛盾的目标价）：${valuationPromptLine(context.valuation)}
- Bull：${bull}
- Bear：${bear}
- 监控项：${monitors}
- 竞品候选：
${competitorCandidates}
- 新闻/网页竞争信号：
${newsSignals}
- 公开网页证据：
${webEvidencePrompt}

回答规则：
- 输出中文纯文本，可以用短标题，但不要 Markdown 表格。
- 第一行必须以“北京时间 ${formatBeijingMinute()}，”开头。若是泛研究问题，用“${panel.companyName} 最近的状态是：……”；若是单点追问，直接回答用户问的那个点。
- 保持像真实投研对话，不要写成产品说明，不要说“我将/我会获取”。
- ${businessMode ? "用户问的是靠什么赚钱/商业模式/收入来源。只回答这个问题，段落用：简单说、拆开看、关键判断、主要风险、来源。不要输出完整研究模板。" : competitorMode ? "用户问的是竞争对手/竞品/竞争格局。只回答竞争格局，段落用：简单结论、主要竞争对手、怎么理解竞争格局、我的判断、接下来重点看、来源。不要输出完整研究模板，不要写估值/动作大模板。" : moatMode ? "用户问的是护城河/竞争优势。只围绕护城河回答，段落用：结论、护城河拆解、商业模式、我的判断、风险 / 证伪、下一步看什么、来源。不要输出完整行情模板。" : financialMode ? "用户问的是赚不赚钱/盈利质量/利润/现金流。只回答财务质量，段落用：我的判断、靠什么赚钱、利润质量、现金流、主要风险、下一步看什么、来源。先给判断再讲依据，优先使用上面‘已核到的实时财务口径’，缺数据只说一句、放到末尾，不要输出完整研究模板。" : falsifyMode ? "用户问的是什么情况会证伪/会推翻逻辑。只回答证伪，段落用：我的判断、会推翻逻辑的关键事实、怎么提前观察、来源。先点明当前多头逻辑成立的前提，再列出哪些事实出现就要重估，使用 Bull/Bear/监控项档案，不要输出完整研究模板。" : "必须包含这些段落，顺序固定：结论、事实、推断、估值 / 风险、动作、证伪条件、我的判断、还缺什么（折叠在末尾、只影响置信度）、来源。"}
- “事实”尽量编号，引用当前可用数据；不能编造具体数值。若某项缺失，写“当前未核到/来源缺失”，但继续给推断。
- 不要使用“暂不评分”“完整度xx%”“需要补充材料”“未接入”这种产品状态词，改成研究语言：当前未核到、置信度下降。
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
  return `方法 ${valuation.method}；看空 ${valuation.bear} / 中性 ${valuation.base} / 看多 ${valuation.bull}，现价 ${valuation.currentPrice}${odds ? `，回报:风险赔率约 ${odds}:1` : ""}。`;
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
  const fq = computeFinancialQuality(context.financialsData || null, {
    marketCap: context.marketSnapshot?.marketCap,
    pe: context.marketSnapshot?.pe
  });
  const liveFinancials = Array.isArray(fq.metrics) && fq.metrics.length
    ? fq.metrics.map((m) => `${m.name}=${m.display}`).join("；")
    : "完整三表暂未核到（以本地档案与商业逻辑为主）";
  const competitorCandidates = competitorSetFor(profile || { ticker: panel.ticker })
    .map((item) => `- ${item.name}${item.ticker ? `（${item.ticker}）` : ""}：${item.angle}`)
    .join("\n") || "本地档案暂缺";
  const webEvidencePrompt = webEvidenceToPrompt(context.webEvidence);
  const price = panel.price?.value && panel.price.value !== "暂不可用" ? panel.price.value : "暂不可用";

  return `请基于以下材料，为 ${name}（${panel.ticker}）写一份资深买方研究员风格的深度研究报告。
用户问题：${question || `${name} 值不值得研究`}
北京时间：${formatBeijingMinute()}
当前价格口径：${price}（来源 ${panel.price?.source || dataSources.market?.provider || "公开行情"}）
一句话判断（参考，可改写）：${panel.oneLineView || ""}

公司档案：
- 护城河：${moat}
- 商业模式：${businessModel}
- 已核到的实时财务口径：${liveFinancials}
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
