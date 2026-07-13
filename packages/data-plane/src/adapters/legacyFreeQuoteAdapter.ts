/**
 * Wraps src/marketData.js's getMarketSnapshot() as a QuotePort adapter.
 * Deliberately a thin pass-through, not a reimplementation: that function
 * already races Finnhub/TwelveData/Tencent/Sina and falls back through
 * EODHD/AlphaVantage/Yahoo per market (see its own comments) — logic that's
 * been tuned against real rate limits and is exercised by scripts/canary.js.
 * Duplicating it here would just create a second, untested copy of
 * quote-fetching logic for the sake of an architecture diagram.
 */
import { getMarketSnapshot } from "../../../../src/marketData.js";
import type { Market } from "../market.js";
import type { QuotePort, QuoteResult } from "../ports.js";
import type { AdapterAuthorization } from "../authorization.js";

// Every source getMarketSnapshot() can reach today is a free/public API
// (Tencent, Sina, Finnhub free tier, TwelveData free tier, EODHD, Alpha
// Vantage free tier, Yahoo's unofficial chart endpoint) — none are under a
// commercial-use agreement, so this whole composite is unlicensed_free_tier
// regardless of which individual source ends up answering a given call.
const authorization: AdapterAuthorization = {
  licenseTier: "unlicensed_free_tier",
  commercialUseAllowed: false,
  notes:
    "Composite of Tencent/Sina/Finnhub-free/TwelveData-free/EODHD/AlphaVantage-free/Yahoo-unofficial " +
    "(src/marketData.js). No individual source has a commercial-use agreement; do not select in commercial mode."
};

export const legacyFreeQuoteAdapter: QuotePort = {
  id: "legacy-free-tier",
  authorization,
  qualityRank: 1, // sole adapter today — rank is a placeholder until a second one exists to rank against
  supports(_market: Market): boolean {
    return true; // getMarketSnapshot() covers US/HK/CN, each with its own fallback chain
  },
  async fetchQuote(ticker: string): Promise<QuoteResult> {
    return (await getMarketSnapshot(ticker)) as QuoteResult;
  }
};
