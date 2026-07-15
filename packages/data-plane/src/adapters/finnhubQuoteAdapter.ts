import { detectMarket, type Market } from "../market.js";
import type { QuotePort, QuoteResult } from "../ports.js";

/**
 * Finnhub free-tier /quote. Verified live: no HK coverage (returns
 * `{"error":"You don't have access to this resource."}` for 0700.HK)
 * — only US-listed symbols resolve. `supports()` reflects that honestly
 * rather than registering for markets it can't actually serve.
 */
export const finnhubQuoteAdapter: QuotePort = {
  id: "finnhub",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 86_400, // documented free-tier cap is 60 req/min, not a daily one
    costPerCallUsd: 0,
    notes: "Finnhub free tier: US-listed symbols only, 60 req/min. No HK/CN coverage on this plan."
  },
  qualityRank: 1,
  supports(market: Market) { return market === "US"; },
  async fetchQuote(rawTicker: string): Promise<QuoteResult> {
    const ticker = rawTicker.trim().toUpperCase();
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) throw new Error("FINNHUB_API_KEY not configured");
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`finnhub quote ${response.status} for ${ticker}`);
    const body: any = await response.json();
    if (body?.error) throw new Error(`finnhub quote error for ${ticker}: ${body.error}`);
    const price = typeof body?.c === "number" && body.c > 0 ? body.c : null;
    const previousClose = typeof body?.pc === "number" && body.pc > 0 ? body.pc : null;
    const change = typeof body?.d === "number" ? body.d : price != null && previousClose != null ? price - previousClose : null;
    const changePercent = typeof body?.dp === "number" ? body.dp : change != null && previousClose ? (change / previousClose) * 100 : null;
    return {
      source: "finnhub",
      ticker,
      currency: detectMarket(ticker) === "US" ? "USD" : null,
      price,
      previousClose,
      change,
      changePercent,
      open: typeof body?.o === "number" ? body.o : null,
      high: typeof body?.h === "number" ? body.h : null,
      low: typeof body?.l === "number" ? body.l : null,
      volume: null,
      marketCap: null,
      pe: null,
      dividendYield: null,
      week52High: null,
      week52Low: null,
      asOf: typeof body?.t === "number" && body.t > 0 ? new Date(body.t * 1000).toISOString() : new Date().toISOString(),
      providerStatus: price == null ? "missing" : "ok"
    };
  }
};
