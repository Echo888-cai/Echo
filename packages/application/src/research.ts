import { randomUUID } from "node:crypto";
import { getCompanyByTickerComplete, searchCompanies } from "@echo/db/repositories/companyRepository.js";
import { ensureFreshMarketSnapshot } from "./marketData.js";
import { getCompanyProfile, upsertCompanyProfile } from "@echo/db/repositories/companyProfilesRepository.js";
import { saveResearchSession } from "@echo/db/repositories/researchSessionsRepository.js";
import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import { getCnFinancials } from "@echo/db/repositories/cnFinancialsRepository.js";
import { getFundamentals, getNextEarnings } from "@echo/data-plane";
import { composerFor } from "./answerComposition.js";
import { insertLlmAudit } from "@echo/db/repositories/llmAuditRepository.js";
import { insertFactGuardAudit } from "@echo/db/repositories/factGuardRepository.js";
import { buildFactsRegistry, buildSoftNote, displayValuation, summarizeVerdict, verifyAnswerNumbers } from "@echo/domain";

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
 * 美股财务三表此前恒为空数组（docs/PLAN.md P1 诊断#6）——港/A 有 filing 管道，
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
    const { result } = await getNextEarnings(ticker);
    return result;
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

function decisionPanel(company: any, profile: any, market: any, financialsData?: any, valuation?: any, earnings?: any) {
  const connectedData = [
    market ? "实时行情" : null,
    financialsData?.providerStatus === "ok" ? "财报口径" : null,
    valuation && !valuation.cannotValueReason ? "估值区间" : null,
    earnings?.providerStatus === "ok" ? "财报日历" : null
  ].filter(Boolean) as string[];
  const missingData = [
    market ? null : "实时行情",
    financialsData?.providerStatus === "ok" ? null : "标准化财报",
    valuation && !valuation.cannotValueReason ? null : "自洽估值区间",
    earnings?.providerStatus === "ok" ? null : "下一业绩日",
    // Honest, and load-bearing: the composer's rules tell the model to write
    // 未核到 for anything outside the given blocks. Naming these two keeps it
    // from quietly filling them from memory (docs/PLAN.md P1 — neither source
    // has a working adapter).
    "网页证据",
    "同业可比倍数"
  ].filter(Boolean) as string[];
  // Share of the four sources we can actually resolve today — not a product
  // score, just "how much of this answer is standing on checked numbers".
  const dataCompleteness = Math.round((connectedData.length / 4) * 100);
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
  const financialsData = row ? {
    providerStatus: "ok" as const, currency: row.currency || company.currency,
    // The composer's prompt cites this block as "唯一财务事实源（来源 X）" — without a
    // source it rendered "来源 undefined", which reads like a bug to the model and
    // undermines the very line telling it these numbers are authoritative.
    source: row.source || (row.pe_ttm != null ? "FMP" : "一手 filing"),
    revenue: row.revenue, grossProfit: row.gross_profit, operatingIncome: row.operating_income,
    netIncome: row.net_income, operatingCashFlow: row.operating_cash_flow, cashAndEquivalents: row.cash_and_equivalents,
    netCash: row.net_cash, eps: annualEps, epsAnnualized, revenueGrowth: pctChange(row.revenue, row.revenue_prior),
    grossMargin: pctOf(row.gross_profit, row.revenue), operatingMargin: pctOf(row.operating_income, row.revenue),
    netMargin: pctOf(row.net_income, row.revenue), profitGrowth: pctChange(row.net_income, row.net_income_prior),
    sharesOutstanding: market?.market_cap && market?.price ? market.market_cap / market.price : null,
    period: isoDate(row.period_end) || isoDate(row.published_at)
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
function computeResearchValuation(company: any, marketSnapshot: any, financialsData: any): any {
  try {
    const safeCompany = { ticker: company.ticker, currency: company.currency, sector: company.sector };
    return displayValuation(safeCompany, marketSnapshot, financialsData);
  } catch {
    return null;
  }
}

/**
 * R3 数字护栏 — checks the model's free-form answer against the same structured
 * facts it was fed (market snapshot + latest filing row + our own valuation
 * band), so a fabricated or mis-transcribed number is caught rather than
 * shipped silently. Modes: off (skip entirely), shadow (audit only, never
 * shown), soft/full (audit + a low-key note appended to the answer). `full`'s
 * "拦截+定向重答" path isn't built yet — until it is, full behaves like soft
 * rather than silently no-op'ing.
 */
async function applyFactGuard(content: string, company: any, marketSnapshot: any, financialsData: any, valuation: any) {
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
  await insertFactGuardAudit({ ticker: company.ticker, mode, summary }).catch(() => {});
  const withNote = mode === "shadow" ? content : content + buildSoftNote(verdict);
  return { content: withNote, factGuard: { mode, ...summary } };
}

export async function runResearch(input: ResearchInput, userId: string, onToken?: TokenCallback, onStage?: StageCallback) {
  await onStage?.("resolving");
  const company = await resolveInputCompany(input);
  if (!company) return {
    mode: "chat_local", provider: null, model: null, sessionId: null, content: "我还没识别出要研究的公司。请补充股票代码或完整公司名称。",
    decisionPanel: null, dataSources: {}, marketSnapshot: null, newsSnapshot: null, valuation: null, portrait: null
  };
  await onStage?.("market_financials");
  const [profile, market, financials, earnings] = await Promise.all([
    getCompanyProfile(company.ticker, userId),
    ensureFreshMarketSnapshot(company.ticker),
    company.ticker.endsWith(".HK") ? getHkFinancials(company.ticker) : /\.(SS|SZ)$/.test(company.ticker) ? getCnFinancials(company.ticker) : getUsFinancials(company.ticker),
    getEarnings(company.ticker)
  ]);
  const { marketSnapshot, financialsData } = toDomainSources(company, market, financials);
  await onStage?.("valuation");
  const valuation = computeResearchValuation(company, marketSnapshot, financialsData);
  const panel = decisionPanel(company, profile, market, financialsData, valuation, earnings);
  // The prompt now comes from the domain composer instead of a hand-rolled
  // 4-line facts string: it renders the company archive (护城河/商业模式/多空/
  // 监控项), the real filing block, our own valuation band, the next earnings
  // date, and — the point of docs/PLAN.md P2 — routes on classifyResearchIntent
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
  // adapter exists (docs/PLAN.md P1).
  const isFirstPartyFiling = /\.(HK|SS|SZ)$/.test(company.ticker);
  const composerSources = {
    market: { provider: market?.source, asOf: market?.as_of, status: market ? "ok" : "missing" },
    financials: { status: financialsData.providerStatus === "ok" ? "ok" : "missing" },
    // Only HK/CN financials come from our own filing pipeline; US rows are FMP's
    // standardized statements, which are not a filing feed.
    filings: { status: financialsData.providerStatus === "ok" && isFirstPartyFiling ? "ok" : "missing" },
    news: { status: "missing" },
    estimates: { status: "missing" }
  };
  const composerContext = {
    marketSnapshot, financialsData, valuation, earnings,
    portraitContext: profile?.thesis ? `既有研究主线：${profile.thesis}` : "",
    history: input.history,
    // Not wired to any source yet (docs/PLAN.md P1) — passing null makes the
    // composer print an explicit 未接通 block, which is what stops the model
    // from filling the gap from memory.
    webEvidence: null, newsSnapshot: null, compare: null, dualListing: null, dualQuote: null, otherHoldings: null
  };
  const prompt = composer.buildChatPrompt(input.question, panel, composerSources, composerContext);
  // The no-model path composes from the same panel and the same intent router, so
  // both answers share one section structure. It replaces a local
  // `deterministicAnswer` template that emitted a completely different shape
  // (## 核心判断 …) — meaning the answer silently changed layout depending on
  // whether the model call succeeded, and the E2E only ever asserted the
  // fallback's headings because CI has no model key.
  const fallback = composer.researchReplyFromPanel(panel, input.question, composerSources, composerContext);
  await onStage?.("generating");
  const generated = await modelAnswer(
    "你是审慎的买方研究员。只使用给出的事实，不编数字；取不到就写未核到。估值区间必须使用给定的估值数据，不得自行编造倍数或目标价。" +
      "红线：只给判断，不给指令——禁止任何形式的买入/卖出/持有/加仓/减仓/追高/抄底建议，包括正向表述（“建议买入”）和反向劝阻（“不建议追高”“不建议此时买入”），这类劝阻性措辞本质上仍是买卖指令，同样禁止。" +
      "改用研究语言描述赔率与状态，例如“当前价位对应的赔率偏低/偏高”“性价比一般，等待更好的验证点或更低的安全边际”“逻辑需要重估”，只呈现判断依据，买卖时机与仓位决策留给用户自己判断。" +
      "严格遵守用户消息里给出的段落结构与作答规则。",
    prompt,
    userId,
    onToken
  );
  const id = input.sessionId || `s_${randomUUID()}`;
  await onStage?.("fact_check");
  // normalizeResearchAnswer backfills the two things the model drops most often:
  // the 北京时间 prefix and a 来源 section (a real 靠什么赚钱 回测 ended with no
  // 来源 at all despite the rules asking for one). Run it before the guard so
  // factGuard verifies the exact text the user ends up reading.
  const guarded = generated
    ? await applyFactGuard(composer.normalizeResearchAnswer(generated.content, panel, composerSources), company, marketSnapshot, financialsData, valuation)
    : { content: fallback, factGuard: null };
  const content = guarded.content;
  await saveResearchSession({ id, ticker: company.ticker, companyName: company.nameZh, title: input.question, question: input.question,
    conversationId: input.conversationId || id, status: "completed", decisionPanel: panel, fullResearch: content,
    reportMarkdown: content, dataSources: { market: market ? { status: "ok", source: market.source, asOf: market.as_of } : { status: "missing" }, financials: financials.length ? { status: "ok" } : { status: "missing" } },
    thread: input.history }, userId);
  const savedProfile = await upsertCompanyProfile(company.ticker, {
    companyName: company.nameZh, thesis: panel.oneLineView, researchStatus: panel.researchStatus, confidence: panel.confidence,
    bull: panel.bullCase, bear: panel.bearCase, monitors: panel.monitors, bumpTurn: true
  }, userId);
  return {
    mode: generated ? "chat_model" : "chat_local",
    provider: generated?.provider || null,
    model: generated?.model || null,
    sessionId: id,
    content,
    decisionPanel: panel,
    dataSources: { market: market ? { status: "ok", source: market.source, asOf: market.as_of } : { status: "missing" }, financials: financials.length ? { status: "ok" } : { status: "missing" } },
    marketSnapshot: market,
    newsSnapshot: null,
    factGuard: guarded.factGuard,
    valuation,
    portrait: { ticker: company.ticker, created: !profile, changed: !profile || profile.thesis !== panel.oneLineView, turnCount: savedProfile?.turnCount || 0 }
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

export async function runReport(input: ResearchInput, userId: string) {
  const result: any = await runResearch(input, userId);
  return {
    mode: result.mode === "chat_model" ? "report_model" : "report_local",
    provider: result.provider,
    model: result.model,
    sessionId: result.sessionId,
    decisionPanel: result.decisionPanel,
    markdown: result.content,
    dataSources: result.dataSources,
    marketSnapshot: result.marketSnapshot,
    newsSnapshot: result.newsSnapshot,
    factGuard: result.factGuard,
    portrait: result.portrait
  };
}
