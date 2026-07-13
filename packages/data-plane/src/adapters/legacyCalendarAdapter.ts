/**
 * Wraps src/server/services/earningsCalendar.js's getNextEarnings(). HK
 * tickers are routed through market.js's HK_ADR_MAP internally (Finnhub's
 * free tier doesn't cover HK directly) — that mapping stays inside the
 * legacy function, this adapter doesn't need to know about it.
 */
import { getNextEarnings } from "../../../../src/server/services/earningsCalendar.js";
import type { Market } from "../market.js";
import type { CalendarPort, ProviderEnvelope } from "../ports.js";
import type { AdapterAuthorization } from "../authorization.js";

const authorization: AdapterAuthorization = {
  licenseTier: "unlicensed_free_tier",
  commercialUseAllowed: false,
  notes: "Finnhub free tier /stock/earnings + /calendar/earnings, HK routed via HK_ADR_MAP. CN not covered (returns missing)."
};

export const legacyCalendarAdapter: CalendarPort = {
  id: "legacy-finnhub-free",
  authorization,
  qualityRank: 1,
  supports(market: Market): boolean {
    return market === "US" || market === "HK"; // CN has no branch in getNextEarnings today
  },
  async fetchNextEarnings(ticker: string): Promise<ProviderEnvelope> {
    return (await getNextEarnings(ticker)) as ProviderEnvelope;
  }
};
