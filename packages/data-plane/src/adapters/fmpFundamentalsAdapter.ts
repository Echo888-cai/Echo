import type { Market } from "../market.js";
import type { FundamentalsPort } from "../ports.js";

const BASE = "https://financialmodelingprep.com/stable";

async function fetchJson(path: string, apiKey: string): Promise<any> {
  const url = `${BASE}/${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`fmp ${path.split("?")[0]} ${response.status}`);
  const body: any = await response.json();
  // FMP returns HTTP 200 with an error object for both legacy-endpoint and
  // premium-gated queries — verified live: HK/CN symbols on income-statement
  // return `{"Error Message":"Premium Query Parameter..."}` with a 200 status,
  // so this has to be checked explicitly rather than trusting response.ok.
  if (body && !Array.isArray(body) && (body["Error Message"] || body.error)) {
    throw new Error(`fmp ${path.split("?")[0]} error: ${body["Error Message"] || body.error}`);
  }
  return body;
}

/**
 * FMP `stable` fundamentals — verified live against real tickers before
 * wiring in: the legacy v3 endpoints this free key used to work with are
 * retired ("Legacy Endpoint" 200-status error body), the `stable` API is the
 * replacement. `profile`/quote-level data resolves for HK/CN tickers too, but
 * the actual three-statement endpoints (income-statement, cash-flow-statement,
 * balance-sheet-statement) are premium-gated for any non-US symbol on this
 * key ("Premium Query Parameter..."), so `supports()` stays US-only — HK/CN
 * fundamentals continue to come from the first-party filing pipeline
 * (postgresFundamentalsAdapter), with FMP only ever a same-market alternative,
 * never a silent HK/CN stand-in it can't actually back with real statements.
 */
export const fmpFundamentalsAdapter: FundamentalsPort = {
  id: "fmp",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 250,
    costPerCallUsd: 0,
    notes: "FMP free tier: ~250 req/day, three-statement endpoints are US-listed symbols only on this key."
  },
  qualityRank: 1,
  supports(market: Market) { return market === "US"; },
  async fetchFundamentals(rawTicker: string) {
    const ticker = rawTicker.trim().toUpperCase();
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error("FMP_API_KEY not configured");
    const [income, cashFlow, balanceSheet, ratiosTtm] = await Promise.all([
      fetchJson(`income-statement?symbol=${encodeURIComponent(ticker)}&period=quarter&limit=2`, apiKey),
      fetchJson(`cash-flow-statement?symbol=${encodeURIComponent(ticker)}&period=quarter&limit=1`, apiKey),
      fetchJson(`balance-sheet-statement?symbol=${encodeURIComponent(ticker)}&period=quarter&limit=1`, apiKey),
      // TTM ratios, not derived here from a single quarter's EPS: verified live
      // that price / current-quarter-EPS produces a wildly wrong multiple for
      // any company with seasonal earnings (AAPL: 317.31 / Q2's 2.01 EPS ≈
      // 158x, when the real trailing PE is ~38x) — a single quarter is not
      // one-quarter of a flat annual run rate. FMP computes this correctly
      // from real trailing data, so it's used directly rather than
      // reimplementing TTM aggregation here.
      fetchJson(`ratios-ttm?symbol=${encodeURIComponent(ticker)}`, apiKey).catch(() => null)
    ]);
    const current = Array.isArray(income) ? income[0] : null;
    const prior = Array.isArray(income) ? income[1] : null;
    const cash = Array.isArray(cashFlow) ? cashFlow[0] : null;
    const balance = Array.isArray(balanceSheet) ? balanceSheet[0] : null;
    const ratios = Array.isArray(ratiosTtm) ? ratiosTtm[0] : null;
    if (!current) return { providerStatus: "missing" as const, source: "FMP", rows: [] };
    const peTtm = typeof ratios?.priceToEarningsRatioTTM === "number" && ratios.priceToEarningsRatioTTM > 0 ? ratios.priceToEarningsRatioTTM : null;
    const row = {
      currency: current.reportedCurrency || null,
      revenue: current.revenue ?? null,
      gross_profit: current.grossProfit ?? null,
      operating_income: current.operatingIncome ?? null,
      net_income: current.netIncome ?? null,
      operating_cash_flow: cash?.netCashProvidedByOperatingActivities ?? null,
      cash_and_equivalents: balance?.cashAndCashEquivalents ?? null,
      net_cash: typeof balance?.netDebt === "number" ? -balance.netDebt : null,
      // Single-quarter EPS — kept for display ("2026 Q2 每股收益 2.01"), never
      // fed into a PE derivation (see pe_ttm below).
      eps: current.epsDiluted ?? current.eps ?? null,
      // Real trailing-twelve-month PE, for valuation code to use directly
      // instead of re-deriving one from the quarterly eps above.
      pe_ttm: peTtm,
      revenue_prior: prior?.revenue ?? null,
      net_income_prior: prior?.netIncome ?? null,
      period_end: current.date || null,
      published_at: current.filingDate || null,
      period_label: current.fiscalYear && current.period ? `${current.fiscalYear} ${current.period}` : null
    };
    return { providerStatus: "ok" as const, source: "FMP", rows: [row] };
  }
};
