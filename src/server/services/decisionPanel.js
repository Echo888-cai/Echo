/**
 * decisionPanel — the only place that builds the JSON we send to /api/agent.
 *
 * Three things matter here:
 *  1. `userContext` is the canonical place where the cost/shares/horizon the
 *     user typed live. Never re-derive them from raw memory in routes.
 *  2. Every conclusion (keyDrivers / riskTriggers / metrics / price) carries
 *     an `evidence` array with source / asOf / quote-or-status / confidence /
 *     missingReason. If we have no evidence we mark missingReason explicitly.
 *  3. `researchStatus` replaces the old 买入/持有 评级. Enforced by schema.
 */

import { RESEARCH_STATUS_VALUES, KEY_DRIVER_NAMES, RESEARCH_STATUS_LABELS } from "../schemas/agentPanel.js";
import { hasUserContext, missingContextFields } from "./userContext.js";
import { fmtPercent, missing, compactNumberServer, quoteStatusFor } from "../utils/format.js";

const STATUS_PRESENT = "实时/盘中";
const STATUS_DELAYED = "延迟/当日";
const STATUS_HISTORY = "收盘/历史";
const STATUS_MISSING = "缺失";

/** Quick helper to make a single evidence entry. */
function evidence({ source, asOf = null, quote = null, status = null, confidence = "中", missingReason = "无" }) {
  return { source, asOf, quote, status, confidence, missingReason };
}

function normalizeKeyDrivers(inputDrivers, ctx) {
  const fallback = buildKeyDrivers(ctx);
  if (!Array.isArray(inputDrivers) || !inputDrivers.length) return fallback;
  const valid = inputDrivers.filter((d) => d && KEY_DRIVER_NAMES.includes(d.name));
  if (!valid.length) return fallback;
  const byName = new Map(valid.map((d) => [d.name, d]));
  return KEY_DRIVER_NAMES.map((name) => byName.get(name) || fallback.find((d) => d.name === name));
}

function buildKeyDrivers({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, financialsData, marketSnapshot, profile, newsSnapshot, filingsData }) {
  const marketStatus = quoteStatusFor(marketSnapshot);
  const marketAsOf = marketSnapshot?.asOf || null;
  return [
    {
      name: "价格信号",
      status: hasPrice ? "观察" : "暂不评分",
      summary: hasPrice ? "价格已接入，仅作市场状态参考" : "行情源不可用",
      evidence: [
        evidence({
          source: hasPrice ? marketSnapshot.source : "行情源",
          asOf: marketAsOf,
          quote: hasPrice ? `${marketSnapshot.price} ${marketSnapshot.currency || "HKD"}` : null,
          status: marketStatus,
          confidence: hasPrice ? "中" : "低",
          missingReason: hasPrice ? "无" : "未获取实时行情（已 timeout）"
        })
      ]
    },
    {
      name: "基本面",
      status: hasFinancials ? "有数据" : hasFilings ? "待验证" : "暂不评分",
      summary: hasFinancials
        ? `收入增速 ${fmtPercent(financialsData.revenueGrowth)}，毛利率 ${fmtPercent(financialsData.grossMargin)}`
        : hasFilings ? "已导入材料，等待结构化解析" : "财报数据未接入",
      evidence: [
        evidence({
          source: hasFinancials ? financialsData.source : "财务源",
          asOf: hasFinancials ? financialsData.asOf || null : null,
          quote: hasFinancials ? `收入增速 ${fmtPercent(financialsData.revenueGrowth)}` : null,
          status: hasFinancials ? STATUS_DELAYED : STATUS_MISSING,
          confidence: hasFinancials ? "中" : "低",
          missingReason: hasFinancials ? "无" : "未获取财务数据（已 timeout）"
        })
      ]
    },
    {
      name: "估值",
      status: hasEstimates ? "有数据" : "暂不评分",
      summary: hasEstimates
        ? `一致目标价 ${profile?.consensusTargetPrice || "有"}`
        : "缺 Forward PE 与目标价",
      evidence: [
        evidence({
          source: hasEstimates ? (filingsData?.source || "估值源") : "估值源",
          asOf: hasEstimates ? (filingsData?.asOf || null) : null,
          quote: null,
          status: hasEstimates ? STATUS_DELAYED : STATUS_MISSING,
          confidence: hasEstimates ? "中" : "低",
          missingReason: hasEstimates ? "无" : "未获取一致预期数据"
        })
      ]
    },
    {
      name: "股东回报",
      status: hasFinancials ? "有数据" : hasFilings ? "待验证" : "暂不评分",
      summary: hasFinancials
        ? `回购 ${financialsData.repurchaseOfStock ? compactNumberServer(financialsData.repurchaseOfStock) : "缺失"}，分红 ${financialsData.dividendPaid ? compactNumberServer(financialsData.dividendPaid) : "缺失"}`
        : hasFilings ? "已导入公告，等待结构化" : "回购公告未接入",
      evidence: [
        evidence({
          source: hasFilings ? "HKEX 公告" : "财务源",
          asOf: hasFilings ? (filingsData?.asOf || null) : null,
          quote: hasFilings ? "已导入公告" : null,
          status: hasFilings ? STATUS_DELAYED : STATUS_MISSING,
          confidence: hasFilings ? "中" : "低",
          missingReason: hasFilings ? "无" : "未获取 HKEX 公告"
        })
      ]
    },
    {
      name: "风险信号",
      status: newsAvailable ? "观察" : "暂不评分",
      summary: newsAvailable ? `新闻源返回 ${(newsSnapshot.articles || []).length} 条，需交叉验证` : "新闻源不可用",
      evidence: [
        evidence({
          source: newsAvailable ? (newsSnapshot.source || "新闻源") : "新闻源",
          asOf: newsAvailable ? (newsSnapshot.asOf || null) : null,
          quote: null,
          status: newsAvailable ? STATUS_DELAYED : "新闻源不可用",
          confidence: newsAvailable ? "中" : "低",
          missingReason: newsAvailable ? "无" : "新闻接口 timeout 或无返回"
        })
      ]
    }
  ];
}

/**
 * Build a clean decision panel from any data the request can carry.
 *
 * @param {object} input
 * @param {string} input.question
 * @param {object} input.company
 * @param {object} input.userContext - canonical cost/shares/horizon
 * @param {object} input.marketSnapshot
 * @param {object} input.newsSnapshot
 * @param {object} input.financialsData
 * @param {object} input.filingsData
 * @param {object} input.estimatesData
 * @param {object} [input.modelPanel] - raw model output, if any
 * @param {string} [input.fullResearch] - long-form markdown
 * @param {string[]} [input.filings] - imported filings
 */
export function buildDecisionPanel(input) {
  const { question = "", company, userContext = null, marketSnapshot = null, newsSnapshot = null, financialsData = null, filingsData = null, estimatesData = null, modelPanel = null, fullResearch = "", filings = [] } = input || {};
  const profile = company || { ticker: "unknown.HK", nameZh: "研究对象" };
  const hasPrice = marketSnapshot?.providerStatus === "ok" && marketSnapshot.price;
  const newsAvailable = newsSnapshot?.providerStatus === "ok" && (newsSnapshot.articles || []).length > 0;
  const hasFilings = (filingsData?.providerStatus === "ok" && (filingsData.filings || []).length > 0) || filings.length > 0;
  const hasFinancials = financialsData?.providerStatus === "ok";
  const hasEstimates = estimatesData?.providerStatus === "ok";

  const connected = [
    hasPrice ? "行情" : "",
    "公司档案",
    "本地档案",
    hasFinancials ? "财报数据" : "",
    hasFilings ? "HKEX 公告" : "",
    hasEstimates ? "分析师评级" : ""
  ].filter(Boolean);

  const missingData = [
    !hasFilings && !hasFinancials ? "财报解析" : "",
    !hasFilings ? "回购公告" : "",
    !newsAvailable ? "新闻源" : "",
    !hasEstimates ? "一致预期" : "",
    ...missingContextFields(userContext).map((f) => `用户${f}`)
  ].filter(Boolean);

  const dataCompleteness = Math.round((connected.length / (connected.length + missingData.length)) * 100);
  const priceValue = hasPrice ? `${marketSnapshot.price} ${marketSnapshot.currency || profile.currency || "HKD"}` : "暂不可用";
  const changeValue = hasPrice && marketSnapshot.changePercent !== null && marketSnapshot.changePercent !== undefined
    ? `${Number(marketSnapshot.changePercent).toFixed(2)}%` : "暂不可用";

  // Pick researchStatus: prefer model output if it matches the enum; else derive
  const modelStatus = modelPanel?.researchStatus;
  const researchStatus = RESEARCH_STATUS_VALUES.includes(modelStatus) ? modelStatus : deriveResearchStatus({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, userContext });

  const oneLineView = (typeof modelPanel?.oneLineView === "string" && modelPanel.oneLineView.length && modelPanel.oneLineView.length <= 120)
    ? modelPanel.oneLineView
    : composeOneLineView({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, profile, userContext });

  const action = (typeof modelPanel?.action === "string" && modelPanel.action.length && modelPanel.action.length <= 60)
    ? modelPanel.action
    : composeAction({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, userContext });

  const confidence = modelPanel?.confidence || (hasPrice && hasFilings && hasFinancials ? "中" : "低");

  const basePanel = {
    ticker: profile.ticker,
    companyName: profile.nameZh || profile.nameEn || profile.ticker,
    researchStatus,
    confidence,
    dataCompleteness,
    oneLineView,
    action,
    userContext: userContext || { cost: null, shares: null, horizon: null, note: "" },
    price: {
      value: priceValue,
      change: changeValue,
      source: hasPrice ? marketSnapshot.source : "行情源不可用",
      timestamp: hasPrice ? marketSnapshot.asOf || "" : "",
      evidence: [
        evidence({
          source: hasPrice ? marketSnapshot.source : "行情源",
          asOf: hasPrice ? marketSnapshot.asOf : null,
          quote: hasPrice ? `${marketSnapshot.price} ${marketSnapshot.currency || "HKD"}` : null,
          status: quoteStatusFor(marketSnapshot),
          confidence: hasPrice ? "中" : "低",
          missingReason: hasPrice ? "无" : "未获取实时行情"
        })
      ]
    },
    metrics: [
      { name: "价格", value: priceValue, note: hasPrice ? "已接入" : "暂不可用", evidence: [evidence({ source: hasPrice ? marketSnapshot.source : "行情源", confidence: hasPrice ? "中" : "低", missingReason: hasPrice ? "无" : "未获取实时行情" })] },
      { name: "PE", value: hasPrice ? String(marketSnapshot.pe || profile.pe || "暂不可用") : "暂不可用", note: hasPrice ? "待核验" : "缺行情", evidence: [evidence({ source: hasPrice ? marketSnapshot.source : "估值源", confidence: hasPrice ? "中" : "低", missingReason: hasPrice ? "无" : "未获取 PE" })] },
      { name: "市值", value: hasPrice ? String(marketSnapshot.marketCap || "暂不可用") : "暂不可用", note: hasPrice ? marketSnapshot.source : "缺行情", evidence: [evidence({ source: hasPrice ? marketSnapshot.source : "行情源", confidence: hasPrice ? "中" : "低", missingReason: hasPrice ? "无" : "未获取市值" })] }
    ],
    keyDrivers: buildKeyDrivers({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, financialsData, marketSnapshot, profile, newsSnapshot, filingsData }),
    connectedData: connected,
    missingData,
    riskTriggers: (profile.risks || []).slice(0, 3).map((label) => ({
      label,
      evidence: [evidence({ source: "公司档案", confidence: "中", missingReason: "来自 seed profile，待公告核验" })]
    })),
    sources: [
      ...(profile.officialSources || []).slice(0, 4).map((source) => ({ label: source.label, url: source.url, type: "official", timestamp: null })),
      hasPrice ? { label: marketSnapshot.source, url: "", type: "market", timestamp: marketSnapshot.asOf || null } : null,
      ...(newsAvailable
        ? (newsSnapshot.articles || []).filter((a) => a.url).slice(0, 4).map((a) => ({ label: a.title, url: a.url, type: a.source || "news", timestamp: a.publishedAt || null }))
        : [])
    ].filter(Boolean),
    evidence: [evidence({ source: profile.officialSources?.[0]?.label || "公司档案", confidence: "中", missingReason: "公司基础档案；具体指标缺失已在 keyDrivers 中标注" })],
    details: {
      overview: [
        oneLineView,
        hasFilings ? `已导入 ${filings.length || (filingsData?.filings || []).length} 份材料，下一步看财务质量。` : "缺少财报解析，不能判断利润质量和现金流。",
        newsAvailable ? `新闻源返回 ${(newsSnapshot.articles || []).length} 条，需交叉验证。` : "新闻源不可用，本次判断不使用新闻信号。"
      ],
      financials: hasFilings ? [`已导入 ${filings.length || (filingsData?.filings || []).length} 份材料，等待结构化解析。`] : ["财报解析未接入，收入、利润率、FCF 暂不评分。"],
      valuation: [hasPrice ? `当前价格 ${priceValue}，PE ${marketSnapshot.pe || profile.pe || "暂不可用"}。` : "行情源不可用。", "缺 Forward PE、FCF 收益率和可比公司区间，暂不给目标价。"],
      risks: (profile.risks || []).slice(0, 3),
      sources: []
    },
    fullResearch: fullResearch || ""
  };

  // Merge: only allow well-typed model outputs to override strict fields.
  if (!modelPanel || typeof modelPanel !== "object") return basePanel;
  return {
    ...basePanel,
    ...pickModelOverrides(modelPanel, basePanel),
    price: { ...basePanel.price, ...(modelPanel.price || {}) },
    metrics: Array.isArray(modelPanel.metrics) ? modelPanel.metrics.slice(0, 3) : basePanel.metrics,
    keyDrivers: normalizeKeyDrivers(modelPanel.keyDrivers, { hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, financialsData, marketSnapshot, profile, newsSnapshot, filingsData }),
    missingData: Array.isArray(modelPanel.missingData) ? modelPanel.missingData : basePanel.missingData,
    connectedData: Array.isArray(modelPanel.connectedData) ? modelPanel.connectedData : basePanel.connectedData,
    riskTriggers: Array.isArray(modelPanel.riskTriggers) ? modelPanel.riskTriggers.slice(0, 3) : basePanel.riskTriggers,
    sources: Array.isArray(modelPanel.sources) && modelPanel.sources.length ? modelPanel.sources : basePanel.sources,
    userContext: basePanel.userContext, // never let model override
    details: { ...basePanel.details, ...(modelPanel.details || {}) }
  };
}

function pickModelOverrides(model, base) {
  const allow = ["ticker", "companyName", "researchStatus", "confidence", "dataCompleteness", "oneLineView", "action", "fullResearch"];
  const out = {};
  for (const key of allow) {
    if (model[key] !== undefined && model[key] !== null && model[key] !== "") out[key] = model[key];
  }
  if (out.researchStatus && !RESEARCH_STATUS_VALUES.includes(out.researchStatus)) {
    delete out.researchStatus; // invalid enum → keep base
  }
  if (typeof out.oneLineView === "string" && out.oneLineView.length > 120) out.oneLineView = out.oneLineView.slice(0, 120);
  if (typeof out.action === "string" && out.action.length > 60) out.action = out.action.slice(0, 60);
  return out;
}

function deriveResearchStatus({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, userContext }) {
  if (!hasPrice && !hasFilings && !hasFinancials) return "data_missing";
  if (!hasFinancials && !hasFilings) return "research_more";
  if (userContext && hasUserContext(userContext) && (!hasFinancials || !hasEstimates)) return "research_more";
  return "watch";
}

function composeOneLineView({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, profile, userContext }) {
  const name = profile.nameZh || profile.ticker;
  if (hasFinancials) {
    return `${name} 已有财务数据，${hasEstimates ? "有一致预期" : "缺一致预期"}；${userContext && hasUserContext(userContext) ? "已记录用户持仓" : "缺用户持仓上下文"}。`;
  }
  if (hasPrice) {
    return `${name} 行情已接入，但缺财务解析；本次以观察为主，不硬给买卖结论。`;
  }
  return `${name} 行情和财务数据均不可用，无法形成投资结论。`;
}

function composeAction({ hasPrice, hasFinancials, hasFilings, hasEstimates, newsAvailable, userContext }) {
  if (hasFinancials && hasEstimates) return "等财报/公告验证，等待分批信号";
  if (hasFilings) return "等待财务质量与回购数据验证";
  if (hasPrice) return "补齐财报解析与一致预期后再判断";
  return "先补齐行情/财报/新闻等关键证据";
}

export function researchStatusLabel(status) {
  return RESEARCH_STATUS_LABELS[status] || status;
}

export { hasUserContext, missingContextFields };
