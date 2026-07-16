/**
 * Wires the pure domain `answerComposer` (956 lines, dead code since the
 * architecture migration — docs/PLAN.md 诊断#7) to real ports, so `runResearch`
 * can stop hand-rolling a 4-line facts string and use the real multi-source
 * prompt builder.
 *
 * The composer is a factory precisely so the domain package touches no clock,
 * database, network or env — every impure thing it needs is injected here.
 * Ports that have no real backing source yet (web evidence, peer archive) are
 * wired to honest "未接通" values rather than plausible-looking filler: a
 * fabricated peer multiple in the prompt is exactly what 红线 2 forbids, and the
 * composer's own rules tell the model to say 未核到 when a block is empty.
 */
import { compactNumberServer, createAnswerComposer, createReportComposer, classifyResearchIntent, hkBuybackToPrompt, RESEARCH_INTENTS } from "@echo/domain";

/** Panel research-status → display label, recovered from the retired stack
 *  (ce58d27:src/server/schemas/agentPanel.js). The composer renders this into
 *  the prompt's 研究状态 line. */
const RESEARCH_STATUS_LABELS: Record<string, string> = {
  watch: "持续观察",
  research_more: "需要补充材料",
  data_missing: "数据缺失暂不评分",
  risk_alert: "风险提示",
  out_of_scope: "不在研究范围"
};

/** The composer stamps 北京时间 into the prompt and the answer's first line, so
 *  it needs a real clock — injected rather than read inside the domain package. */
function beijingMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "未核到";
}

function amount(value: unknown, currency = "") {
  const n = Number(value);
  return Number.isFinite(n) ? `${compactNumberServer(n)} ${currency}`.trim() : "未核到";
}

/**
 * Renders the same `financialsData` object that valuation.js and factGuard.js
 * consume (built by research.ts's toDomainSources) into the prompt's "唯一财务
 * 事实源" block. Keeping it on that one shape is deliberate: the model, the
 * valuation band and the number guard must all see identical figures, or
 * factGuard starts flagging the model for faithfully quoting a number the
 * prompt gave it.
 *
 * Only fields our pipeline actually populates are rendered. The retired stack's
 * version (ce58d27:src/financialData.js) also printed 自由现金流/净债务/分部收入,
 * which no current source fills — printing them as 缺失 on every single company
 * would just train the model to ignore the block.
 */
function financialsToMarkdown(financials: any) {
  if (!financials || financials.providerStatus !== "ok") {
    return "本轮未核到可用财报口径——任何财务数字都必须写“未核到”，不得估算。";
  }
  const cur = financials.currency || "";
  const lines = [
    `收入：${amount(financials.revenue, cur)}${financials.revenueGrowth != null ? ` | 同比 ${pct(financials.revenueGrowth)}` : ""}`,
    `毛利：${amount(financials.grossProfit, cur)} | 毛利率：${pct(financials.grossMargin)}`,
    `经营利润：${amount(financials.operatingIncome, cur)} | 经营利润率：${pct(financials.operatingMargin)}`,
    `净利润：${amount(financials.netIncome, cur)} | 净利率：${pct(financials.netMargin)}${financials.profitGrowth != null ? ` | 同比 ${pct(financials.profitGrowth)}` : ""}`,
    `经营现金流：${amount(financials.operatingCashFlow, cur)}`,
    financials.netCash != null ? `净现金：${amount(financials.netCash, cur)}` : "",
    // epsAnnualized === false means this is a period-cumulative filing EPS that
    // must not be turned into a PE (see research.ts deriveAnnualEps) — say so in
    // the prompt too, or the model will happily do the division itself.
    financials.eps != null
      ? `EPS：${financials.eps}${financials.epsAnnualized === false ? "（口径为报告期累计值，非年化——不得用它反推 PE/估值倍数）" : ""}`
      : ""
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * 港股回购事实块。hk_buybacks 由 hkFilingsPipeline 一直在采集，但在此之前没有任何
 * 读取方——数据采了没人用，而 composer 同时还在对模型说"回购分红口径还没核到"。
 * 只有港股有这个源，其余市场诚实说"未核到"——不能让模型把"我们没接这个源"读成
 * "这家公司没回购"。
 */
function buybacksToPrompt(buybacks: any) {
  const block = hkBuybackToPrompt(buybacks);
  return block || "港股回购：本轮未核到 HKEX 翌日披露的场内购回记录（非港股或该期间无披露）——不得凭印象描述回购规模、节奏或金额。";
}

/**
 * When web evidence is empty (key unset, quota exhausted, or zero hits), tell
 * the model plainly instead of leaving the block blank, which reads as
 * "nothing newsworthy happened".
 */
function webEvidenceToPrompt(webEvidence: any) {
  const items = Array.isArray(webEvidence?.evidence) ? webEvidence.evidence : [];
  if (!items.length) return "本轮未接入网页证据源——不得凭印象补充新闻、公告或第三方报道，涉及外部事件一律写“未核到”。";
  return items
    .map((item: any) => `- ${item.title || "未命名"}（${item.source || "来源未标注"}${item.date ? ` · ${item.date}` : ""}）：${item.snippet || ""}${item.url ? `\n  ${item.url}` : ""}`)
    .join("\n");
}

/**
 * `companyByTicker` is a synchronous port, so the caller passes the company
 * archive row it already fetched (hydrateCompany's shape happens to be exactly
 * what the composer reads: moat/businessModel/metrics/bull/bear/monitors).
 *
 * `companies` backs the composer's same-sector peer suggestions. It's empty:
 * comp_peers uses Finnhub live peers (not sector-based guessing), and loading all ~650
 * companies on every question to guess peers by sector string would be both
 * wasteful and misleading — same-sector is not same-comparable. With an empty
 * pool the composer falls back to its hand-curated COMPETITOR_MAP and otherwise
 * honestly says 本地档案暂缺.
 */
export function composerFor(company: any) {
  return createAnswerComposer({
    researchStatusLabels: RESEARCH_STATUS_LABELS,
    companies: [],
    companyByTicker: (ticker: string) => (ticker === company?.ticker ? company : null),
    classifyResearchIntent,
    researchIntents: RESEARCH_INTENTS,
    webEvidenceToPrompt,
    financialsToMarkdown,
    buybacksToPrompt,
    beijingMinute
  });
}

/**
 * Deep-report composer — the no-model fallback for `runReport`. Takes the same
 * decisionPanel and company archive, and emits judgment-first Markdown
 * (# 标题 / ## 核心判断 / ## 赚钱机制与护城河 / …), which is a genuinely different
 * artifact from the conversational answer rather than a copy of it.
 */
export function reportComposerFor(company: any) {
  return createReportComposer({
    researchStatusLabels: RESEARCH_STATUS_LABELS,
    companyByTicker: (ticker: string) => (ticker === company?.ticker ? company : null),
    beijingMinute
  });
}
