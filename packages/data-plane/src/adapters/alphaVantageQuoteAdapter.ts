import { detectMarket, type Market } from "../market.js";
import type { QuotePort, QuoteResult } from "../ports.js";

function toFinite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace("%", "")) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Alpha Vantage free-tier GLOBAL_QUOTE. Verified live: `0700.HK` returns an
 * empty `{"Global Quote":{}}` (no HK primary-listing coverage — Alpha
 * Vantage's HK-related SYMBOL_SEARCH hits are Frankfurt/London/US ADR
 * listings, not the HKEX ticker our product uses), so `supports()` is US
 * only. The free key is also capped at 25 req/day and ~1 req/sec — the
 * lowest quality/availability of the four live sources, so it's ranked last
 * and should only be reached as a final fallback, never a primary source.
 */
export const alphaVantageQuoteAdapter: QuotePort = {
  id: "alphavantage",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 25,
    costPerCallUsd: 0,
    notes: "Alpha Vantage free tier: 25 req/day, ~1 req/sec, US-listed symbols only. Last-resort fallback, not a primary source."
  },
  qualityRank: 4,
  supports(market: Market) { return market === "US"; },
  async fetchQuote(rawTicker: string): Promise<QuoteResult> {
    const ticker = rawTicker.trim().toUpperCase();
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) throw new Error("ALPHAVANTAGE_API_KEY not configured");
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`alphavantage quote ${response.status} for ${ticker}`);
    const body: any = await response.json();
    // Alpha Vantage returns HTTP 200 for both rate-limit notices and quota
    // exhaustion — "Information"/"Note" keys, not an error status — so those
    // have to be checked explicitly rather than relying on response.ok.
    if (body?.Information || body?.Note) throw new Error(`alphavantage quote throttled for ${ticker}: ${body.Information || body.Note}`);
    const quote = body?.["Global Quote"];
    if (!quote || !Object.keys(quote).length) {
      return { source: "alphavantage", ticker, currency: null, price: null, previousClose: null, change: null, changePercent: null,
        open: null, high: null, low: null, volume: null, marketCap: null, pe: null, dividendYield: null, week52High: null, week52Low: null,
        asOf: new Date().toISOString(), providerStatus: "missing" };
    }
    const price = toFinite(quote["05. price"]);
    const previousClose = toFinite(quote["08. previous close"]);
    const change = toFinite(quote["09. change"]) ?? (price != null && previousClose != null ? price - previousClose : null);
    const changePercent = toFinite(quote["10. change percent"]) ?? (change != null && previousClose ? (change / previousClose) * 100 : null);
    const tradingDay = quote["07. latest trading day"];
    return {
      source: "alphavantage",
      ticker,
      currency: detectMarket(ticker) === "US" ? "USD" : null,
      price,
      previousClose,
      change,
      changePercent,
      open: toFinite(quote["02. open"]),
      high: toFinite(quote["03. high"]),
      low: toFinite(quote["04. low"]),
      volume: toFinite(quote["06. volume"]),
      marketCap: null,
      pe: null,
      dividendYield: null,
      week52High: null,
      week52Low: null,
      asOf: typeof tradingDay === "string" && tradingDay ? new Date(`${tradingDay}T00:00:00Z`).toISOString() : new Date().toISOString(),
      providerStatus: price == null ? "missing" : "ok"
    };
  }
};
