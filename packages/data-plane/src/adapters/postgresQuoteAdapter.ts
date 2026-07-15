import { getLatestMarketSnapshot } from "@echo/db/repositories/companyRepository.js";
import type { Market } from "../market.js";
import type { QuotePort, QuoteResult } from "../ports.js";

export const postgresQuoteAdapter: QuotePort = {
  id: "postgres-quote-cache",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    notes: "Authorization follows the original quote source; cached research quotes are never promoted to commercial use."
  },
  qualityRank: 1,
  supports(market: Market) { return market !== "unsupported"; },
  async fetchQuote(ticker: string): Promise<QuoteResult> {
    const row = await getLatestMarketSnapshot(ticker);
    if (!row) return { source: "postgres", ticker, currency: null, price: null, previousClose: null, change: null, changePercent: null,
      open: null, high: null, low: null, volume: null, marketCap: null, pe: null, dividendYield: null, week52High: null, week52Low: null,
      asOf: new Date().toISOString(), providerStatus: "missing" };
    const currency = ticker.endsWith(".HK") ? "HKD" : "USD";
    return { source: row.source || "postgres", ticker: row.ticker, currency, price: row.price, previousClose: row.previous_close,
      change: row.change, changePercent: row.change_percent, open: row.open, high: row.high, low: row.low, volume: row.volume,
      marketCap: row.market_cap, pe: row.pe, dividendYield: row.dividend_yield, week52High: row.week_52_high, week52Low: row.week_52_low,
      asOf: row.as_of, providerStatus: row.price == null ? "missing" : "ok" };
  }
};
