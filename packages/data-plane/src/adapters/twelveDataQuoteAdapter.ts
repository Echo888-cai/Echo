import { detectMarket, type Market } from "../market.js";
import type { QuotePort, QuoteResult } from "../ports.js";

function toFinite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Twelve Data free-tier /quote. Verified live: HK symbols (both bare
 * `0700.HK` and `mic_code`-qualified forms) come back
 * `{"code":404,"message":"...available starting with the Pro or Venture
 * plan..."}` on the free key — only US symbols resolve. `supports()` reflects
 * that instead of registering for markets this key can't serve.
 */
export const twelveDataQuoteAdapter: QuotePort = {
  id: "twelvedata",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 800, // documented free-tier cap: 8 req/min, 800 req/day
    costPerCallUsd: 0,
    notes: "Twelve Data free tier: US-listed symbols only on this key — HK/CN gated behind Pro/Venture plan."
  },
  qualityRank: 2,
  supports(market: Market) { return market === "US"; },
  async fetchQuote(rawTicker: string): Promise<QuoteResult> {
    const ticker = rawTicker.trim().toUpperCase();
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) throw new Error("TWELVEDATA_API_KEY not configured");
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`twelvedata quote ${response.status} for ${ticker}`);
    const body: any = await response.json();
    if (body?.status === "error" || body?.code) throw new Error(`twelvedata quote error for ${ticker}: ${body.message || body.code}`);
    const price = toFinite(body?.close);
    const previousClose = toFinite(body?.previous_close);
    const change = toFinite(body?.change) ?? (price != null && previousClose != null ? price - previousClose : null);
    const changePercent = toFinite(body?.percent_change) ?? (change != null && previousClose ? (change / previousClose) * 100 : null);
    return {
      source: "twelvedata",
      ticker,
      currency: typeof body?.currency === "string" ? body.currency : detectMarket(ticker) === "US" ? "USD" : null,
      price,
      previousClose,
      change,
      changePercent,
      open: toFinite(body?.open),
      high: toFinite(body?.high),
      low: toFinite(body?.low),
      volume: toFinite(body?.volume),
      marketCap: null,
      pe: null,
      dividendYield: null,
      week52High: toFinite(body?.fifty_two_week?.high),
      week52Low: toFinite(body?.fifty_two_week?.low),
      asOf: typeof body?.timestamp === "number" && body.timestamp > 0 ? new Date(body.timestamp * 1000).toISOString() : new Date().toISOString(),
      providerStatus: price == null ? "missing" : "ok"
    };
  }
};
