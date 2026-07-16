import { randomUUID } from "node:crypto";
import { getCompanyByTickerComplete, searchCompanies } from "@echo/db/repositories/companyRepository.js";
import { ensureFreshMarketSnapshot } from "./marketData.js";
import { getCompanyProfile, upsertCompanyProfile } from "@echo/db/repositories/companyProfilesRepository.js";
import { saveResearchSession } from "@echo/db/repositories/researchSessionsRepository.js";
import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import { listRecentHkBuybacks } from "@echo/db/repositories/hkBuybackRepository.js";
import { detectMarket, getFundamentals, searchWebEvidence } from "@echo/data-plane";
import { saveWebEvidence, listWebEvidence } from "@echo/db/repositories/webEvidenceRepository.js";
import { ensureEarningsCalendar } from "./earningsCalendar.js";
import { composerFor, reportComposerFor } from "./answerComposition.js";
import { getComparablePeers } from "./compPeers.js";
import { insertLlmAudit } from "@echo/db/repositories/llmAuditRepository.js";
import { insertFactGuardAudit } from "@echo/db/repositories/factGuardRepository.js";
import { upsertResearchSnapshot } from "@echo/db/repositories/researchSnapshotsRepository.js";
import { replaceFalsifierRules } from "@echo/db/repositories/watchRulesRepository.js";
import {
  buildFactsRegistry, buildSoftNote, deriveValuationPosition, displayValuation,
  extractFalsifiersFromAnswer, extractStructuredFalsifiers, extractThesisFromAnswer, isDataFragmentThesis,
  parseFalsifierRules, portraitJudgmentChanged, renderHardFailIssues, summarizeVerdict, topPortraitEvidence, verifyAnswerNumbers
} from "@echo/domain";

type ResearchInput = {
  question: string;
  company?: { ticker: string; nameZh?: string };
  kind?: "company" | "screener" | "macro";
  history?: unknown[];
  sessionId?: string;
  conversationId?: string;
  [key: string]: unknown;
};

function providerConfig() {
  if (process.env.DEEPSEEK_API_KEY) return { id: "deepseek", key: process.env.DEEPSEEK_API_KEY, base: "https://api.deepseek.com", model: process.env.DEEPSEEK_MODEL || "deepseek-chat" };
  if (process.env.OPENAI_API_KEY) return { id: "openai", key: process.env.OPENAI_API_KEY, base: "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-5-mini" };
  if (process.env.MODEL_API_KEY && process.env.MODEL_BASE_URL) return { id: "generic", key: process.env.MODEL_API_KEY, base: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME || "default" };
  return null;
}

type TokenCallback = (delta: string) => void | Promise<void>;
// Stage names are a stable contract with the frontend (apps/web/src/lib/researchStore.ts
// maps each to display copy) — renaming one without updating that map silently breaks
// the wait-phase indicator again.
type StageCallback = (stage: string) => void | Promise<void>;

// Provider deltas often arrive sub-word (DeepSeek/OpenAI can emit hundreds of
// tiny deltas for a page of Markdown). Forwarding every single one as its own
// SSE frame/UI state update is what the client re-renders on — at that
// frequency it re-parses the whole accumulated Markdown on every delta and
// can peg the main thread badly enough to make the page briefly unresponsive
// (found via a real E2E regression, not a hunch). Coalescing into ~24-char
// chunks keeps the real first-token-latency win (still flushed as they fill,
// not batched to the end) while keeping event/render frequency in the same
// ballpark as the old fixed-size chunker this replaces.
const STREAM_CHUNK_SIZE = 24;

/**
 * Reads an OpenAI-compatible `stream: true` chat/completions body (SSE frames,
 * `data: {...}\n\n`, terminated by `data: [DONE]`), forwarding coalesced
 * content chunks to `onToken` as they arrive and accumulating the full text —
 * so the caller gets real token-by-token latency instead of waiting for the
 * whole response before the first byte reaches the client.
 */
async function readStreamedCompletion(response: Response, onToken?: TokenCallback) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("model stream has no body");
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let pending = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const flush = async () => {
    if (!pending) return;
    const chunk = pending;
    pending = "";
    await onToken?.(chunk);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: any;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = String(json.choices?.[0]?.delta?.content || "");
      if (delta) {
        content += delta;
        pending += delta;
        if (pending.length >= STREAM_CHUNK_SIZE) await flush();
      }
      if (json.usage) usage = json.usage;
    }
  }
  await flush();
  return { content: content.trim(), usage };
}

async function modelAnswer(system: string, user: string, userId: string, onToken?: TokenCallback) {
  const provider = providerConfig();
  if (!provider) return null;
  const started = Date.now();
  const streaming = Boolean(onToken);
  try {
    const response = await fetch(`${provider.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${provider.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: provider.model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }],
        ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {})
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new Error(`model ${response.status}`);
    let content: string;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (streaming) {
      ({ content, usage } = await readStreamedCompletion(response, onToken));
    } else {
      const body: any = await response.json();
      content = String(body.choices?.[0]?.message?.content || "").trim();
      usage = body.usage;
    }
    await insertLlmAudit({ provider: provider.id, model: provider.model, kind: "chat", status: "ok", latencyMs: Date.now() - started,
      inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens, userId });
    return content ? { content, provider: provider.id, model: provider.model } : null;
  } catch (error) {
    await insertLlmAudit({ provider: provider.id, model: provider.model, kind: "chat", status: "error", latencyMs: Date.now() - started,
      errorDetail: error instanceof Error ? error.message : String(error), userId });
    return null;
  }
}

/**
 * 美股财务三表此前恒为空数组——港/A 有 filing 管道，
 * 美股完全没有对应来源。`getFundamentals` 接的是 FMP（US-only，见
 * fmpFundamentalsAdapter 里对免费档 HK/CN 覆盖边界的真实探测），未配置
 * FMP_API_KEY 或调用失败都返回 []，而不是让 runResearch 因单个数据源故障整体失败。
 */
async function getUsFinancials(ticker: string): Promise<any[]> {
  try {
    const { result } = await getFundamentals(ticker);
    return Array.isArray((result as any).rows) ? (result as any).rows : [];
  } catch {
    return [];
  }
}

/**
 * Next earnings date — real, freshly-probed source (Finnhub for US, the curated
 * HK→ADR map for HK; A-shares honestly resolve to missing). The composer renders
 * it into the prompt and forbids inventing a date when it's absent, which is the
 * whole reason to pass the envelope through rather than only the date string.
 * A calendar outage must not fail the research call, so errors degrade to the
 * same "未核到" shape a missing entry produces.
 */
async function getEarnings(ticker: string): Promise<any> {
  try {
    // 经 ensureEarningsCalendar 走：同一次取数顺带刷新 earnings_calendar 缓存行
    // （含 last_* 已报告字段）——这张表此前没有任何写入方，业绩复盘 workflow 和
    // F-2 记分卡都跑在冻结脏数据上（check:frozen 首抓的真缺陷）。
    return await ensureEarningsCalendar(ticker);
  } catch (error) {
    return { providerStatus: "missing", detail: error instanceof Error ? error.message : "日历源不可用" };
  }
}

/**
 * `keyDrivers` are rendered into the prompt as 关键卡片 — the model's at-a-glance
 * read of where this company actually stands. Every card is derived from a number
 * we really hold (quote / filing / our own valuation band); a source we didn't
 * resolve produces a 未核到 card rather than a confident-sounding empty one.
 * The retired stack built these with a whole LLM agent-panel schema
 * (ce58d27:src/server/schemas/agentPanel.js) — deriving them from the data we
 * already fetched costs nothing and can't hallucinate.
 *
 * Summaries carry no trailing punctuation: the composer's templates append their
 * own ("核心矛盾是：{summary}；同时…", "2. 基本面：{status}。{summary}。"), so a
 * summary ending in 。 renders as "净利率 30.4%。。" — which is why the module
 * keeps a cleanSentence() helper for exactly this shape of input.
 */
function keyDriversFrom(market: any, financialsData: any, valuation: any) {
  const drivers = [];
  drivers.push(market?.price != null
    ? { name: "价格信号", status: market.change_percent != null ? `${Number(market.change_percent) >= 0 ? "+" : ""}${Number(market.change_percent).toFixed(2)}%` : "已核到",
        summary: `现价 ${market.price}${market.source ? `，来源 ${market.source}` : ""}${market.as_of ? `，截至 ${market.as_of}` : ""}` }
    : { name: "价格信号", status: "未核到", summary: "本轮没有取到可用行情快照，价格相关判断置信度下降" });
  drivers.push(financialsData?.providerStatus === "ok"
    ? { name: "基本面", status: financialsData.revenueGrowth != null ? `收入同比 ${Number(financialsData.revenueGrowth).toFixed(1)}%` : "已核到",
        summary: `${financialsData.period ? `${financialsData.period} 期` : "最新期"}财报已核到（来源 ${financialsData.source}）${financialsData.netMargin != null ? `，净利率 ${Number(financialsData.netMargin).toFixed(1)}%` : ""}` }
    : { name: "基本面", status: "未核到", summary: "本轮没有可用的标准化财报口径，财务数字一律不得估算" });
  drivers.push(valuation && !valuation.cannotValueReason
    ? { name: "估值", status: valuation.method, summary: `看空 ${valuation.bear} / 中性 ${valuation.base} / 看多 ${valuation.bull}，现价 ${valuation.currentPrice}` }
    : { name: "估值", status: "未核到", summary: String(valuation?.cannotValueReason || "缺少定价所需的关键字段，本轮不给估值区间").replace(/[。；]+$/, "") });
  return drivers;
}

function decisionPanel(company: any, profile: any, market: any, financialsData?: any, valuation?: any, earnings?: any, webEvidence?: any) {
  const connectedData = [
    market ? "实时行情" : null,
    financialsData?.providerStatus === "ok" ? "财报口径" : null,
    valuation && !valuation.cannotValueReason ? "估值区间" : null,
    earnings?.providerStatus === "ok" ? "财报日历" : null,
    webEvidence ? "网页证据" : null
  ].filter(Boolean) as string[];
  const missingData = [
    market ? null : "实时行情",
    financialsData?.providerStatus === "ok" ? null : "标准化财报",
    valuation && !valuation.cannotValueReason ? null : "自洽估值区间",
    earnings?.providerStatus === "ok" ? null : "下一业绩日",
    webEvidence ? null : "网页证据",
    "同业可比倍数"
  ].filter(Boolean) as string[];
  // Share of the five sources we can actually resolve today — not a product
  // score, just "how much of this answer is standing on checked numbers".
  const dataCompleteness = Math.round((connectedData.length / 5) * 100);
  return {
    ticker: company.ticker,
    companyName: company.nameZh || company.nameEn || company.ticker,
    researchStatus: profile?.researchStatus || "watch",
    confidence: profile?.confidence || "中",
    oneLineView: profile?.thesis || company.summary?.[0] || "当前判断需要财务与现金流继续验证",
    price: {
      value: market?.price ?? "暂不可用",
      source: market?.source || "未核到",
      asOf: market?.as_of || null,
      // The composer reads price.change/timestamp (asOf is our own field name);
      // without these the prompt's 行情 line silently dropped the move and the
      // as-of date the model is supposed to cite.
      change: market?.change_percent != null ? `${Number(market.change_percent) >= 0 ? "+" : ""}${Number(market.change_percent).toFixed(2)}%` : "暂不可用",
      timestamp: market?.as_of || null
    },
    bullCase: profile?.bull || company.bull || [],
    bearCase: profile?.bear || company.bear || company.risks || [],
    monitors: profile?.monitors || company.monitors || [],
    sources: market?.source ? [{ label: market.source, timestamp: market.as_of }] : [],
    keyDrivers: keyDriversFrom(market, financialsData, valuation),
    connectedData,
    missingData,
    dataCompleteness
  };
}

async function resolveInputCompany(input: ResearchInput) {
  if (input.company?.ticker) return getCompanyByTickerComplete(input.company.ticker);
  const match = (await searchCompanies(input.question, { limit: 1 }))[0];
  return match ? getCompanyByTickerComplete(match.ticker) : null;
}

function pctOf(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || !denominator) return null;
  return (numerator / denominator) * 100;
}

function pctChange(current: number | null | undefined, prior: number | null | undefined) {
  if (current == null || !prior) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function freshnessLabel(isoTimestamp: string | null | undefined): string | null {
  if (!isoTimestamp) return null;
  const ms = Date.now() - Date.parse(isoTimestamp);
  if (ms < 0 || Number.isNaN(ms)) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟内`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * HK/CN filings report EPS as period-cumulative (YTD), not TTM: an H1 filing's eps
 * covers Jan-Jun, not the trailing 12 months. Using that raw number to derive a PE
 * (price / eps) inflates PE by roughly (12 / months-covered) — the same class of
 * bug already fixed for US via FMP's real ratios-ttm (see toDomainSources below).
 * There's no HK/CN TTM-PE data source, so instead we bridge to a true TTM net
 * income from the filing history already fetched (up to 4 rows): TTM net income =
 * current cumulative + prior full fiscal year - prior-year same-period cumulative
 * (the last term is `net_income_prior`, which filings already report as a
 * comparative). EPS is then scaled by the same ratio, avoiding a fabricated
 * share count. When the prior FY row isn't in the fetched window, we honestly
 * report `epsAnnualized: false` rather than guess.
 */
function deriveAnnualEps(rows: any[]): { eps: number | null; epsAnnualized: boolean } {
  const latest = rows?.[0];
  const eps = latest ? numOrNull(latest.eps) : null;
  if (!latest || eps === null) return { eps: null, epsAnnualized: true };
  if (latest.period_type === "FY") return { eps, epsAnnualized: true };
  const priorFY = rows.slice(1).find((r) => r?.period_type === "FY");
  const netIncome = numOrNull(latest.net_income);
  const netIncomePrior = numOrNull(latest.net_income_prior);
  const priorFYNetIncome = priorFY ? numOrNull(priorFY.net_income) : null;
  if (netIncome !== null && netIncome > 0 && netIncomePrior !== null && priorFYNetIncome !== null) {
    const netIncomeTtm = netIncome + priorFYNetIncome - netIncomePrior;
    if (netIncomeTtm > 0) return { eps: eps * (netIncomeTtm / netIncome), epsAnnualized: true };
  }
  return { eps, epsAnnualized: false };
}

/**
 * Adapts our DB shapes (snake_case market snapshot, raw filing row) into the
 * camelCase `marketSnapshot`/`financialsData` shape both `valuation.js` and
 * `factGuard.js` expect, so the two modules see exactly the same numbers the
 * model was fed — one source of truth, not two adapters that can drift apart.
 * `sharesOutstanding` is derived (marketCap / price) since no filing field
 * carries it; genuinely missing fields (bookValue, totalDebt) stay undefined
 * rather than guessed, so downstream methods that need them honestly skip.
 * `rows` is the fetched filing history (newest first, up to 4) — only
 * `rows[0]` is used for most fields, but the fuller history is needed to
 * annualize eps (see `deriveAnnualEps`).
 */
function toDomainSources(company: any, market: any, rows: any[]) {
  const row = rows?.[0];
  const marketSnapshot = market ? {
    providerStatus: "ok" as const, price: market.price, currency: company.currency, changePercent: market.change_percent,
    // row?.pe_ttm (FMP, US-only — see fmpFundamentalsAdapter.ts) takes priority
    // over market.pe: quote adapters never populate a trailing PE themselves,
    // and without one here valuation.js falls back to price/quarterlyEps,
    // which is wrong for any company with seasonal earnings.
    pe: row?.pe_ttm ?? market.pe, dividendYield: market.dividend_yield, marketCap: market.market_cap,
    sharesOutstanding: market.market_cap && market.price ? market.market_cap / market.price : null,
    rawAsOf: market.as_of
  } : { providerStatus: "missing" as const };
  // row.eps is raw filing EPS — for HK/CN interim filings (Q1/H1/9M) that's a
  // period-cumulative figure, not TTM. Annualize it (or flag it unusable for PE
  // derivation) before handing it to valuation.js; see deriveAnnualEps above.
  const { eps: annualEps, epsAnnualized } = deriveAnnualEps(rows);
  const filingSource = row?.source || (row?.pe_ttm != null ? "FMP" : "一手 filing");
  const filingPeriod = row?.period_label || isoDate(row?.period_end) || isoDate(row?.published_at) || null;
  const filingPublishedAt = isoDate(row?.published_at) || null;
  const filingExtractedAt = row?.extracted_at || null;
  const financialsData = row ? {
    providerStatus: "ok" as const, currency: row.currency || company.currency,
    source: filingSource,
    revenue: row.revenue, grossProfit: row.gross_profit, operatingIncome: row.operating_income,
    netIncome: row.net_income, operatingCashFlow: row.operating_cash_flow, cashAndEquivalents: row.cash_and_equivalents,
    netCash: row.net_cash, eps: annualEps, epsAnnualized, revenueGrowth: pctChange(row.revenue, row.revenue_prior),
    grossMargin: pctOf(row.gross_profit, row.revenue), operatingMargin: pctOf(row.operating_income, row.revenue),
    netMargin: pctOf(row.net_income, row.revenue), profitGrowth: pctChange(row.net_income, row.net_income_prior),
    sharesOutstanding: market?.market_cap && market?.price ? market.market_cap / market.price : null,
    period: isoDate(row.period_end) || isoDate(row.published_at),
    periodLabel: filingPeriod,
    publishedAt: filingPublishedAt,
    extractedAt: filingExtractedAt,
    sourceUrl: row.source_url || null
  } : { providerStatus: "missing" as const };
  return { marketSnapshot, financialsData };
}

/**
 * displayValuation degrades gracefully with partial data: no shares/bookValue/FCF
 * on file means DCF/PB/FCF-yield methods are skipped, but PE-band (or, for
 * loss-making stages, EV/Sales) still produces a real, self-consistent bear/
 * base/bull — far better than letting the model invent its own multiple from
 * nothing, which is what it did before this was wired in.
 *
 * `computeValuation` falls back to `company.price`/`company.pe`/`company.pb` when
 * marketSnapshot lacks them — but `getCompanyByTickerComplete()`'s `company` is a
 * display card with pre-formatted strings ("约 18x", "约 3.6 万亿 HKD"), not raw
 * numbers. Passing it straight through made `pe` a truthy non-numeric string
 * whenever Yahoo's feed had no trailing PE (it usually doesn't), which the
 * fallback-PE branch then divided into, producing NaN bear/base/bull instead of
 * an honest cannotValueReason. Only pass the identity fields valuation.js
 * actually needs (ticker/currency/sector) — no numeric fallbacks it can't trust.
 */
function computeResearchValuation(company: any, marketSnapshot: any, financialsData: any, compPeers: any = null): any {
  try {
    const safeCompany = { ticker: company.ticker, currency: company.currency, sector: company.sector };
    // 5th arg is the comparable set: valuation.js uses its anchor for the PE band
    // (profitable) or the EV/Sales scenario (loss-making) and attaches the raw
    // list to the result as `.compPeers`, which is exactly where answerComposer's
    // 同业对照 block and factGuard's multiple registry both read it from. Passing
    // `estimates` as null — analyst consensus has no connected source.
    return displayValuation(safeCompany, marketSnapshot, financialsData, null, compPeers);
  } catch {
    return null;
  }
}

/**
 * R3 数字护栏 — checks the model's free-form answer against the same structured
 * facts it was fed (market snapshot + latest filing row + our own valuation
 * band), so a fabricated or mis-transcribed number is caught rather than
 * shipped silently. Modes: off (skip entirely), shadow (audit only, never
 * shown), soft (audit + a low-key note appended to the answer), full (intercept
 * hard-fail answers and re-call the LLM with a targeted correction prompt; falls
 * back to soft behavior if the retry still fails or the LLM call errors).
 */
async function applyFactGuard(content: string, company: any, marketSnapshot: any, financialsData: any, valuation: any, userId: string) {
  const mode = (process.env.FACT_GUARD_MODE || "shadow").toLowerCase();
  if (mode === "off") return { content, factGuard: null };
  // "Native currency" for amount-matching purposes is the filing's reporting currency
  // (most amount facts come from financials), not the trading/quote currency — for a
  // company like Tencent (HKD-quoted, RMB-reporting) those differ. Forcing the quote
  // currency here made every financial-statement figure take the cross-currency
  // conversion path and get compared only against the price fact, producing false
  // "数量级相差 xxx 倍" hard-fails on real, correctly-cited revenue/profit numbers.
  const registry: any = buildFactsRegistry({
    ticker: company.ticker,
    nativeCurrency: financialsData?.currency || company.currency,
    marketSnapshot, financialsData, valuation
  });
  // buildFactsRegistry only registers the filing period as a date fact — the quote's
  // as-of date is a separate, equally citable fact (models often restate "现价日期"),
  // so append it directly rather than mislabeling it as a filing period.
  const asOf = isoDate(marketSnapshot?.rawAsOf);
  if (asOf) {
    const [y, m, d] = asOf.split("-").map(Number);
    registry.dates.push({ iso: asOf, year: y, month: m, day: d, quarter: Math.ceil(m / 3), label: "行情快照时间", source: "marketSnapshot" });
  }
  const verdict = verifyAnswerNumbers(content, registry);
  const summary = summarizeVerdict(verdict);
  if (!summary) {
    return { content, factGuard: null };
  }

  if (mode === "full" && summary.hard > 0) {
    await insertFactGuardAudit({ ticker: company.ticker, mode: "full_original", summary }).catch(() => {});

    const issues = renderHardFailIssues(verdict);
    const correctionPrompt = [
      "以下研究回答中存在与已核实数据不一致的数字，请只修正标出的问题，其余内容（判断、结构、措辞）保持不变。",
      "",
      "【原始回答】",
      content,
      "",
      `【需要修正的数字问题（共 ${summary.hard} 处）】`,
      issues,
      "",
      "请输出修正后的完整回答。只修改上述标出的数字错误，不要改动其他内容。"
    ].join("\n");

    const retry = await modelAnswer(RESEARCH_SYSTEM_PROMPT, correctionPrompt, userId);
    if (retry) {
      const retryVerdict = verifyAnswerNumbers(retry.content, registry);
      const retrySummary = summarizeVerdict(retryVerdict) ?? summary;
      await insertFactGuardAudit({ ticker: company.ticker, mode: "full_retry", summary: retrySummary }).catch(() => {});

      if (retrySummary.hard > 0) {
        const withNote = retry.content + buildSoftNote(retryVerdict);
        return { content: withNote, factGuard: { mode, ...retrySummary, retried: true, retryFixed: false } };
      }
      const withNote = retry.content + buildSoftNote(retryVerdict);
      return { content: withNote, factGuard: { mode, ...retrySummary, retried: true, retryFixed: true } };
    }
    // LLM retry call failed — fall back to soft behavior on the original content
    const withNote = content + buildSoftNote(verdict);
    return { content: withNote, factGuard: { mode, ...summary, retried: false } };
  }

  await insertFactGuardAudit({ ticker: company.ticker, mode, summary }).catch(() => {});
  const withNote = mode === "shadow" ? content : content + buildSoftNote(verdict);
  return { content: withNote, factGuard: { mode, ...summary } };
}

/** The system message is shared by the chat and report calls: red line 1 is a
 *  product invariant, not a per-artifact style choice. The paragraph structure
 *  itself comes from the composer's own prompt (the user message). */
const RESEARCH_SYSTEM_PROMPT =
  "你是审慎的买方研究员。只使用给出的事实，不编数字；取不到就写未核到。估值区间必须使用给定的估值数据，不得自行编造倍数或目标价。" +
  "红线：只给判断，不给指令——禁止任何形式的买入/卖出/持有/加仓/减仓/追高/抄底建议，包括正向表述（“建议买入”）和反向劝阻（“不建议追高”“不建议此时买入”），这类劝阻性措辞本质上仍是买卖指令，同样禁止。" +
  "改用研究语言描述赔率与状态，例如“当前价位对应的赔率偏低/偏高”“性价比一般，等待更好的验证点或更低的安全边际”“逻辑需要重估”，只呈现判断依据，买卖时机与仓位决策留给用户自己判断。" +
  "严格遵守用户消息里给出的段落结构与作答规则。";

/**
 * Resolves the company and every source the composer needs, and builds the
 * panel/ports shared by both artifacts. Chat and deep report run the exact same
 * data gathering and must see the exact same numbers — they differ only in which
 * composer prompt renders them, so this is deliberately the one place that
 * fetches (previously `runReport` just re-entered `runResearch` and relabelled
 * the conversational answer as "报告").
 */
/** 按市场分发到对应的财报源。抽出来是因为 worker 的基本面证伪巡检也要走同一条口径——
 *  两处各写一份 dispatch，迟早会在"某个市场该用哪个源"上漂移。 */
function fetchFinancialsRows(ticker: string): Promise<any[]> {
  if (ticker.endsWith(".HK")) return getHkFinancials(ticker);
  if (/\.(SS|SZ)$/.test(ticker)) return Promise.resolve([]); // A 股已停止覆盖（PLAN v3 市场聚焦）
  return getUsFinancials(ticker);
}

/**
 * F-3：worker 的基本面证伪巡检需要跟研究链路完全同一份 `financialsData`
 * （evaluateFundamentalRule 直接读它的 grossMargin/netMargin 等字段）。导出这个入口
 * 而不是让 worker 自己拼，是为了让"规则登记时看到的口径"和"巡检时核对的口径"永远是
 * 同一套——两边各算一次，阈值就会在不同的年化/币种口径上打架。
 */
export async function financialsDataFor(ticker: string) {
  const company = await getCompanyByTickerComplete(ticker);
  if (!company) return null;
  const [market, rows] = await Promise.all([
    ensureFreshMarketSnapshot(ticker).catch(() => null),
    fetchFinancialsRows(ticker).catch(() => [])
  ]);
  return toDomainSources(company, market, rows).financialsData;
}

async function gatherResearchContext(input: ResearchInput, userId: string, onStage?: StageCallback) {
  const company = await resolveInputCompany(input);
  if (!company) return null;
  // A 股退场（PLAN v3 市场聚焦）：companies 表里的存量 A 股仍能被搜索命中，
  // 但研究链路对它诚实拒答，而不是跑出一篇行情/财务/估值全部"未核到"的空壳报告。
  if (detectMarket(company.ticker) === "unsupported") return { delisted: company.ticker as string };
  await onStage?.("market_financials");
  const [profile, market, financials, earnings, buybacks] = await Promise.all([
    getCompanyProfile(company.ticker, userId),
    ensureFreshMarketSnapshot(company.ticker),
    fetchFinancialsRows(company.ticker),
    getEarnings(company.ticker),
    // hk_buybacks 只有港股有（HKEX 翌日披露报表），hkFilingsPipeline 一直在采集但此前
    // 没有任何读取方——数据白采了，composer 还在同时对模型说"回购口径还没核到"。
    company.ticker.endsWith(".HK") ? listRecentHkBuybacks(company.ticker, 180).catch(() => []) : Promise.resolve([])
  ]);
  const { marketSnapshot, financialsData } = toDomainSources(company, market, financials);

  // Web evidence: check DB cache first (same ticker + intent within 48h),
  // only hit the search API when no fresh results exist.
  const webEvidenceQuery = `${company.nameZh || company.nameEn || ""} ${company.ticker} ${input.question}`.trim();
  const webEvidencePromise = (async () => {
    const cached = await listWebEvidence({ ticker: company.ticker, intent: input.question.slice(0, 200), maxAgeHours: 48 }).catch(() => []);
    if (cached.length) {
      return {
        evidence: cached.map((row: any) => ({ title: row.title, url: row.url, snippet: row.snippet, source: row.source, date: row.publishedAt || null, relevanceScore: row.relevanceScore })),
        query: webEvidenceQuery, provider: "tavily-cache", searchedAt: cached[0]?.fetchedAt || new Date().toISOString()
      };
    }
    return searchWebEvidence(webEvidenceQuery);
  })().catch(() => ({ evidence: [] as any[], query: webEvidenceQuery, provider: "tavily", searchedAt: new Date().toISOString() }));

  await onStage?.("valuation");
  // Peers need the subject's own financials to classify its stage, so this can't
  // join the Promise.all above — it runs before valuation because the anchor is
  // an input to the band, not a decoration on it.
  const compPeers = await getComparablePeers(company.ticker, financialsData);
  const valuation = computeResearchValuation(company, marketSnapshot, financialsData, compPeers);

  // Await web evidence (was kicked off in parallel before valuation).
  const webEvidenceResult = await webEvidencePromise;
  const webEvidence = webEvidenceResult.evidence.length ? webEvidenceResult : null;

  // Persist evidence items to DB for future retrieval/auditing.
  if (webEvidence?.evidence.length) {
    const intent = input.question.slice(0, 200);
    const dbItems = webEvidence.evidence.map((item: any) => ({
      id: `${company.ticker}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      ticker: company.ticker, intent, query: webEvidence.query,
      title: item.title, url: item.url, snippet: item.snippet,
      source: item.source, sourceType: "web_search",
      relevanceScore: item.relevanceScore, credibilityScore: item.relevanceScore,
      fetchedAt: webEvidence.searchedAt
    }));
    await saveWebEvidence(dbItems).catch(() => {});
  }

  const panel = decisionPanel(company, profile, market, financialsData, valuation, earnings, webEvidence);
  // The prompt now comes from the domain composer instead of a hand-rolled
  // 4-line facts string: it renders the company archive (护城河/商业模式/多空/
  // 监控项), the real filing block, our own valuation band, the next earnings
  // date, and routes on classifyResearchIntent
  // so a "靠什么赚钱" question gets business-model sections instead of the same
  // full research template every time. Its anti-fabrication rules (no peer
  // multiples outside the given list, no invented earnings dates, no "行业常识"
  // escape hatch) are the reason to use it verbatim rather than paraphrase.
  const composer = composerFor(company);
  // Must carry every capability the composer keys off, not just market: it reads
  // dataSources.financials/filings/news/estimates to decide which "还缺什么" gap
  // lines to print and whether the 推断 section may draw firm conclusions. Passing
  // market alone made every answer claim 财报三表还没补齐 while quoting the filing
  // numbers three paragraphs above it. news/estimates are honestly missing — no
  // adapter exists (docs/PLAN.md 第 3 节能力底账).
  const isFirstPartyFiling = company.ticker.endsWith(".HK");
  const composerSources = {
    market: { provider: market?.source, asOf: market?.as_of, status: market ? "ok" : "missing" },
    financials: { status: financialsData.providerStatus === "ok" ? "ok" : "missing" },
    // Only HK financials come from our own filing pipeline; US rows are FMP's
    // standardized statements, which are not a filing feed.
    filings: { status: financialsData.providerStatus === "ok" && isFirstPartyFiling ? "ok" : "missing" },
    // 港股回购是我们唯一真正接通的"公告级"一手事实，独立于 filings 报表本身。
    buybacks: { status: buybacks.length ? "ok" : "missing" },
    news: { status: "missing" },
    estimates: { status: "missing" }
  };
  const composerContext = {
    marketSnapshot, financialsData, valuation, earnings, buybacks,
    portraitContext: profile?.thesis ? `既有研究主线：${profile.thesis}` : "",
    history: input.history,
    webEvidence, newsSnapshot: null, compare: null, dualListing: null, dualQuote: null, otherHoldings: null
  };
  const dataSources = {
    market: market ? {
      status: "ok", source: market.source, asOf: market.as_of,
      freshness: freshnessLabel(market.created_at)
    } : { status: "missing" },
    financials: financialsData.providerStatus === "ok" ? {
      status: "ok", source: financialsData.source,
      period: financialsData.periodLabel || financialsData.period || null,
      asOf: financialsData.publishedAt || null,
      extractedAt: financialsData.extractedAt || null
    } : { status: "missing" },
    valuation: valuation && !valuation.cannotValueReason ? {
      status: "ok", method: valuation.method
    } : { status: "missing" },
    buybacks: buybacks.length ? { status: "ok", source: "HKEX 翌日披露报表", rows: buybacks.length } : { status: "missing" }
  };
  return { company, profile, market, financials, earnings, marketSnapshot, financialsData, valuation, panel, composer, composerSources, composerContext, dataSources };
}

type ResearchContext = Exclude<NonNullable<Awaited<ReturnType<typeof gatherResearchContext>>>, { delisted: string }>;

/** Persists the session + company profile and returns the fields both artifacts
 *  report back. Shared so a report and a chat answer can never drift on what
 *  they claim was saved or which sources they stood on. */
async function persistResearch(ctx: ResearchContext, input: ResearchInput, userId: string, content: string, structuredRules: any[] = []) {
  const { company, profile, panel, valuation, marketSnapshot, dataSources } = ctx;
  const id = input.sessionId || `s_${randomUUID()}`;
  await saveResearchSession({ id, ticker: company.ticker, companyName: company.nameZh, title: input.question, question: input.question,
    conversationId: input.conversationId || id, status: "completed", decisionPanel: panel, fullResearch: content,
    reportMarkdown: content, dataSources, thread: input.history }, userId);

  // 主线取自这次回答的「核心判断」段落，而不是 panel.oneLineView——后者本身就是
  // `profile?.thesis || 兜底句`（见 decisionPanel），把它写回画像等于让主线自我复制：
  // 一旦建档就再也不会被新研究改动。提取不到（本地兜底文案/纯数据碎片）时才退回旧行为。
  const extractedThesis = extractThesisFromAnswer(content);
  const thesis = extractedThesis && !isDataFragmentThesis(extractedThesis) ? extractedThesis : panel.oneLineView;
  // 证伪条件同样来自回答正文的「风险与证伪条件」段落，这是唯一真实来源；
  // 取不到就留空，不拿 bearCase（风险叙述，不是可核对的证伪线）冒充。
  const falsifiers = extractFalsifiersFromAnswer(content);
  // cannotValueReason 时 valuation 的 bear/base/bull 是 null——存 null 而不是存一条假带子。
  const valuationBand = valuation && !valuation.cannotValueReason
    ? { method: valuation.method, bear: valuation.bear, base: valuation.base, bull: valuation.bull, currentPrice: valuation.currentPrice }
    : null;

  const isNew = !profile;
  const changed = portraitJudgmentChanged(profile, { thesis });
  const date = new Date().toISOString().slice(0, 10);
  const evidence = topPortraitEvidence(panel);

  // 时间线只记"建档"和"判断变化"两类沉淀事件——财报事件由 worker 另行追加。
  const events = isNew
    ? [{ date, kind: "created", summary: `建档：${thesis}`.slice(0, 300), evidence, sessionId: id }]
    : changed
      ? [{ date, kind: "thesis_change", summary: `判断更新：${thesis}`.slice(0, 300),
          rationale: `触发问题：「${input.question}」`.slice(0, 600), evidence, sessionId: id }]
      : [];

  const savedProfile = await upsertCompanyProfile(company.ticker, {
    companyName: company.nameZh, thesis, researchStatus: panel.researchStatus, confidence: panel.confidence,
    bull: panel.bullCase, bear: panel.bearCase, monitors: panel.monitors, events,
    // falsifiers/valuation 一直是 upsertCompanyProfile 支持但没人传的字段，于是画像
    // markdown 的「估值带」和「证伪条件」两节从来渲染不出来。
    ...(falsifiers.length ? { falsifiers } : {}),
    ...(valuationBand ? { valuation: valuationBand } : {}),
    bumpTurn: true
  }, userId);

  // R7 记分卡的唯一数据来源。没有这一步，research_snapshots 永远是空表，
  // research.scorecard 端点只能对着零条快照算命中率。
  // 只在建档/判断变化时落一行，跟上面 profile_events 的沉淀节奏一致：每轮都落会让
  // 同一个judgement被复制成几十条，全部一起成熟并挤进命中率的分母（等于让聊得最多
  // 的那只票说了算）。
  if (isNew || changed) {
    await upsertResearchSnapshot({
      userId, ticker: company.ticker, snapshotDate: date,
      thesis, falsifiers, sessionId: id,
      valuationPosition: deriveValuationPosition(valuationBand),
      valuationBear: valuationBand?.bear, valuationBase: valuationBand?.base, valuationBull: valuationBand?.bull,
      // 估值带和现价同为报价币种（marketSnapshot.currency），不是财报的记账币种。
      valuationCurrency: marketSnapshot?.currency ?? null,
      priceAtSnapshot: marketSnapshot?.price ?? null
    });
  }

  // UX-7 研究→监控闭环：证伪条件里"明确的价格条件"落成 watch_rules，worker 的
  // checkFalsifiers 巡检据此推送触线通知。这个写入方同样在 #27 迁移中丢失，于是
  // 巡检一直在对着零条规则空跑、盘前速报永远播报"当前有 0 条有效监控条件"。
  //
  // 只在真的解析出价格规则时才同步。parseFalsifierRules 遵循"宁可漏，不可错"，
  // 基本面口径的证伪条件（"毛利率跌破 55%"，实测占绝大多数）会被它正确地拒掉并返回
  // 空数组——而 replaceFalsifierRules 是先删后插，拿空数组去调等于把已有盯盘规则清空。
  // 解析不出规则只说明这轮没给出可执行的价格线，不等于用户撤掉了监控。
  // 价格线与基本面线是两条互不相干的产出路径（前者文本解析、后者 F-3 模型结构化输出），
  // 各自只替换自己 kind 范围内的规则——否则只掌握一条路径的调用方会连带清掉另一条。
  const ruleSets: Array<[string, any[], string[]]> = [
    ["价格线", parseFalsifierRules(falsifiers), ["price_below", "price_above"]],
    ["基本面线", structuredRules, ["fundamental_below", "fundamental_above"]]
  ];
  for (const [label, rules, kinds] of ruleSets) {
    if (!rules.length) continue;
    try {
      await replaceFalsifierRules(company.ticker, rules, { sessionId: id, userId, kinds });
    } catch (error) {
      console.error(`[research] 证伪规则同步失败（${label}）：`, error instanceof Error ? error.message : error);
    }
  }

  return {
    sessionId: id,
    portrait: { ticker: company.ticker, created: isNew, changed: isNew || changed, turnCount: savedProfile?.turnCount || 0 }
  };
}

export async function runResearch(input: ResearchInput, userId: string, onToken?: TokenCallback, onStage?: StageCallback) {
  await onStage?.("resolving");
  const ctx = await gatherResearchContext(input, userId, onStage);
  if (!ctx) return {
    mode: "chat_local", provider: null, model: null, sessionId: null, content: "我还没识别出要研究的公司。请补充股票代码或完整公司名称。",
    decisionPanel: null, dataSources: {}, marketSnapshot: null, newsSnapshot: null, valuation: null, portrait: null
  };
  if ("delisted" in ctx) return {
    mode: "chat_local", provider: null, model: null, sessionId: null,
    content: `${ctx.delisted} 属于 A 股。Echo 已停止覆盖 A 股市场，现只覆盖美股与港股，不再提供该市场的行情与研究。`,
    decisionPanel: null, dataSources: {}, marketSnapshot: null, newsSnapshot: null, valuation: null, portrait: null
  };
  const { company, market, marketSnapshot, financialsData, valuation, panel, composer, composerSources, composerContext } = ctx;
  const prompt = composer.buildChatPrompt(input.question, panel, composerSources, composerContext);
  // The no-model path composes from the same panel and the same intent router, so
  // both answers share one section structure. It replaces a local
  // `deterministicAnswer` template that emitted a completely different shape
  // (## 核心判断 …) — meaning the answer silently changed layout depending on
  // whether the model call succeeded, and the E2E only ever asserted the
  // fallback's headings because CI has no model key.
  const fallback = composer.researchReplyFromPanel(panel, input.question, composerSources, composerContext);
  await onStage?.("generating");
  const generated = await modelAnswer(RESEARCH_SYSTEM_PROMPT, prompt, userId, onToken);
  await onStage?.("fact_check");
  // F-3：先把机器可读的 FALSIFIERS_JSON 行从正文里剥掉，再做其它一切。
  // 顺序是硬要求，不是风格问题：那行是给系统看的（不剥就漏进聊天气泡），而且它带着
  // 阈值数字（29 / 40），留到 applyFactGuard 会被 verifyAnswerNumbers 当成一堆"未能与
  // 已核实数据对上"的可疑数字，凭空拉低数字护栏的准信。剥离失败时 rules 诚实为空，
  // cleanContent 原样返回，不阻断主流程。
  const structured = generated
    ? extractStructuredFalsifiers(generated.content)
    : { rules: [], cleanContent: "" };
  // normalizeResearchAnswer backfills the two things the model drops most often:
  // the 北京时间 prefix and a 来源 section (a real 靠什么赚钱 回测 ended with no
  // 来源 at all despite the rules asking for one). Run it before the guard so
  // factGuard verifies the exact text the user ends up reading.
  const guarded = generated
    ? await applyFactGuard(composer.normalizeResearchAnswer(structured.cleanContent, panel, composerSources), company, marketSnapshot, financialsData, valuation, userId)
    : { content: fallback, factGuard: null };
  const content = guarded.content;
  const saved = await persistResearch(ctx, input, userId, content, structured.rules);
  return {
    mode: generated ? "chat_model" : "chat_local",
    provider: generated?.provider || null,
    model: generated?.model || null,
    sessionId: saved.sessionId,
    content,
    decisionPanel: panel,
    dataSources: ctx.dataSources,
    marketSnapshot: market,
    newsSnapshot: null,
    factGuard: guarded.factGuard,
    valuation,
    portrait: saved.portrait
  };
}

export async function runAsk(input: ResearchInput, userId: string, onToken?: TokenCallback, onStage?: StageCallback) {
  if (!input.company?.ticker && (input.kind === "macro" || input.kind === "screener")) {
    if (input.kind === "screener") {
      const rows = await searchCompanies(input.question, { limit: 30 });
      return { kind: "screener", filters: { query: input.question }, rows, notes: rows.length ? [] : ["当前筛选条件未匹配到公司。"] };
    }
    return { kind: "macro", content: "宏观研究需要可核验的当期数据。本轮没有绑定授权宏观数据源，因此不编造指数和结论。", mode: "local_fallback", indices: [], evidence: [], gaps: ["当期宏观数据"] };
  }
  return runResearch(input, userId, onToken, onStage);
}

/**
 * Deep report — a different artifact from the chat answer, not a relabelled one.
 * It previously called `runResearch` and renamed `content` to `markdown`, so
 * "深度研究" returned the exact conversational reply the user had already read
 * (`reportComposer` 承接深度报告).
 *
 * Same gathered facts and same panel as chat — only the rendering differs:
 * `buildReportPrompt` asks for long-form judgment-first Markdown (## 核心判断 /
 * 赚钱机制与护城河 / 财务质量 / 估值与赔率 / 风险与证伪条件 / 关键监控与下一步 /
 * 来源), and `reportComposer.composeReport` produces the same shape locally when
 * no model is configured or the call fails.
 */
export async function runReport(input: ResearchInput, userId: string) {
  const ctx = await gatherResearchContext(input, userId);
  if (!ctx) return {
    mode: "report_local", provider: null, model: null, sessionId: null, decisionPanel: null,
    markdown: "我还没识别出要研究的公司。请补充股票代码或完整公司名称。",
    dataSources: {}, marketSnapshot: null, newsSnapshot: null, factGuard: null, portrait: null
  };
  if ("delisted" in ctx) return {
    mode: "report_local", provider: null, model: null, sessionId: null, decisionPanel: null,
    markdown: `${ctx.delisted} 属于 A 股。Echo 已停止覆盖 A 股市场，现只覆盖美股与港股，不再提供该市场的行情与研究。`,
    dataSources: {}, marketSnapshot: null, newsSnapshot: null, factGuard: null, portrait: null
  };
  const { company, market, marketSnapshot, financialsData, valuation, panel, composer, composerSources, composerContext } = ctx;
  const prompt = composer.buildReportPrompt(input.question, panel, composerSources, composerContext);
  const generated = await modelAnswer(RESEARCH_SYSTEM_PROMPT, prompt, userId);
  // composeReport reads panel.keyDrivers/sources/oneLineView — the same panel the
  // model was given — so the fallback stands on identical numbers.
  const fallback: string = reportComposerFor(company).composeReport(panel).markdown;
  // No normalizeResearchAnswer here: it prepends a "北京时间 …，X 最近的状态是："
  // conversational lead-in, which belongs above a chat reply, not above a report's
  // "# 深度研究" title. buildReportPrompt already mandates its own header and 来源.
  const guarded = generated
    ? await applyFactGuard(generated.content, company, marketSnapshot, financialsData, valuation, userId)
    : { content: fallback, factGuard: null };
  const markdown = guarded.content;
  const saved = await persistResearch(ctx, input, userId, markdown);
  return {
    mode: generated ? "report_model" : "report_local",
    provider: generated?.provider || null,
    model: generated?.model || null,
    sessionId: saved.sessionId,
    decisionPanel: panel,
    markdown,
    dataSources: ctx.dataSources,
    marketSnapshot: market,
    newsSnapshot: null,
    factGuard: guarded.factGuard,
    portrait: saved.portrait
  };
}
