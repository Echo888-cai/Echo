import { randomUUID } from "node:crypto";
import { getCompanyByTickerComplete, searchCompanies } from "@echo/db/repositories/companyRepository.js";
import { ensureFreshMarketSnapshot } from "./marketData.js";
import { getCompanyProfile, upsertCompanyProfile } from "@echo/db/repositories/companyProfilesRepository.js";
import { saveResearchSession } from "@echo/db/repositories/researchSessionsRepository.js";
import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import { getCnFinancials } from "@echo/db/repositories/cnFinancialsRepository.js";
import { getFundamentals } from "@echo/data-plane";
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

function financialSummary(rows: any[]) {
  const row = rows[0];
  if (!row) return "最新完整三表当前未核到，以下判断降低置信度。";
  const values = [
    row.period_label || row.periodEnd,
    row.revenue != null ? `收入 ${row.revenue} ${row.currency || ""}` : null,
    row.net_income != null ? `净利润 ${row.net_income} ${row.currency || ""}` : null,
    row.operating_cash_flow != null ? `经营现金流 ${row.operating_cash_flow} ${row.currency || ""}` : null
  ].filter(Boolean);
  return values.join("；");
}

function deterministicAnswer(company: any, profile: any, market: any, financials: any[], question: string) {
  const name = company?.nameZh || company?.nameEn || company?.ticker || "该公司";
  const price = market?.price != null ? `${market.price} ${company?.currency || ""}` : "当前未核到";
  const thesis = profile?.thesis || company?.summary?.[0] || "需要继续从赚钱机制、竞争壁垒和现金流兑现三条线验证";
  const bull = profile?.bull?.length ? profile.bull : company?.bull || [];
  const bear = profile?.bear?.length ? profile.bear : company?.bear || company?.risks || [];
  const monitors = profile?.monitors?.length ? profile.monitors : company?.monitors || [];
  return [
    `## 核心判断`,
    `${name} 当前更适合按“持续验证”处理：${thesis}。本轮问题是“${question}”；现价口径为 ${price}，价格只表示市场状态，不等于内在价值。`,
    `## 财务质量`,
    financialSummary(financials),
    `## Bull case`,
    ...(bull.length ? bull.slice(0, 5).map((item: string) => `- ${item}`) : ["- 主业增长、利润率与经营现金流若能同步改善，判断才会增强。"]),
    `## 风险与证伪条件`,
    ...(bear.length ? bear.slice(0, 5).map((item: string) => `- ${item}`) : ["- 若增长只靠投入、现金流不兑现或竞争压低利润率，当前逻辑会被削弱。"]),
    `## 关键监控`,
    ...(monitors.length ? monitors.slice(0, 6).map((item: string) => `- ${item}`) : ["- 收入质量、利润率、经营现金流、资本开支与股东回报"]),
    `## 来源`,
    `- PostgreSQL 研究档案与已摄取的一手公告`,
    market?.source ? `- 行情来源：${market.source}（${market.as_of || "时间未标注"}）` : "- 行情：本轮未核到可用快照",
    "",
    "> 仅供研究学习，不构成投资建议。"
  ].join("\n\n");
}

function decisionPanel(company: any, profile: any, market: any) {
  return {
    ticker: company.ticker,
    companyName: company.nameZh || company.nameEn || company.ticker,
    researchStatus: profile?.researchStatus || "watch",
    confidence: profile?.confidence || "中",
    oneLineView: profile?.thesis || company.summary?.[0] || "当前判断需要财务与现金流继续验证",
    price: { value: market?.price ?? "暂不可用", source: market?.source || "未核到", asOf: market?.as_of || null },
    bullCase: profile?.bull || company.bull || [],
    bearCase: profile?.bear || company.bear || company.risks || [],
    monitors: profile?.monitors || company.monitors || [],
    sources: market?.source ? [{ label: market.source, timestamp: market.as_of }] : [],
    missingData: market ? [] : ["实时行情"]
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

/**
 * Adapts our DB shapes (snake_case market snapshot, raw filing row) into the
 * camelCase `marketSnapshot`/`financialsData` shape both `valuation.js` and
 * `factGuard.js` expect, so the two modules see exactly the same numbers the
 * model was fed — one source of truth, not two adapters that can drift apart.
 * `sharesOutstanding` is derived (marketCap / price) since no filing field
 * carries it; genuinely missing fields (bookValue, totalDebt) stay undefined
 * rather than guessed, so downstream methods that need them honestly skip.
 */
function toDomainSources(company: any, market: any, row: any) {
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
  const financialsData = row ? {
    providerStatus: "ok" as const, currency: row.currency || company.currency,
    revenue: row.revenue, grossProfit: row.gross_profit, operatingIncome: row.operating_income,
    netIncome: row.net_income, operatingCashFlow: row.operating_cash_flow, cashAndEquivalents: row.cash_and_equivalents,
    netCash: row.net_cash, eps: row.eps, revenueGrowth: pctChange(row.revenue, row.revenue_prior),
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
  const [profile, market, financials] = await Promise.all([
    getCompanyProfile(company.ticker, userId),
    ensureFreshMarketSnapshot(company.ticker),
    company.ticker.endsWith(".HK") ? getHkFinancials(company.ticker) : /\.(SS|SZ)$/.test(company.ticker) ? getCnFinancials(company.ticker) : getUsFinancials(company.ticker)
  ]);
  const fallback = deterministicAnswer(company, profile, market, financials, input.question);
  const { marketSnapshot, financialsData } = toDomainSources(company, market, financials[0]);
  await onStage?.("valuation");
  const valuation = computeResearchValuation(company, marketSnapshot, financialsData);
  const valuationFacts = valuation && !valuation.cannotValueReason
    ? `\n估值（${valuation.method}）：看空 ${valuation.bear} / 中性 ${valuation.base} / 看多 ${valuation.bull} ${company.currency}（依据：${(valuation.keyAssumptions || []).join("；")}）`
    : `\n估值：本轮数据不足以给出自洽估值区间（${valuation?.cannotValueReason || "缺少定价所需的关键字段"}）`;
  const facts = `公司：${company.nameZh}（${company.ticker}）\n现价：${market?.price ?? "未核到"}\n财务：${financialSummary(financials)}${valuationFacts}\n既有主线：${profile?.thesis || company.summary?.join("；") || "未沉淀"}`;
  await onStage?.("generating");
  const generated = await modelAnswer(
    "你是审慎的买方研究员。只使用给出的事实，不编数字；取不到就写未核到。估值区间必须使用给定的估值数据，不得自行编造倍数或目标价。" +
      "红线：只给判断，不给指令——禁止任何形式的买入/卖出/持有/加仓/减仓/追高/抄底建议，包括正向表述（“建议买入”）和反向劝阻（“不建议追高”“不建议此时买入”），这类劝阻性措辞本质上仍是买卖指令，同样禁止。" +
      "改用研究语言描述赔率与状态，例如“当前价位对应的赔率偏低/偏高”“性价比一般，等待更好的验证点或更低的安全边际”“逻辑需要重估”，只呈现判断依据，买卖时机与仓位决策留给用户自己判断。" +
      "输出中文 Markdown，包含核心判断、赚钱机制、财务质量、估值与赔率、风险证伪、下一步、来源。",
    `${facts}\n\n用户问题：${input.question}`,
    userId,
    onToken
  );
  const panel = decisionPanel(company, profile, market);
  const id = input.sessionId || `s_${randomUUID()}`;
  await onStage?.("fact_check");
  const guarded = generated
    ? await applyFactGuard(generated.content, company, marketSnapshot, financialsData, valuation)
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
