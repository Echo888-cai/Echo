import type { Market } from "../market.js";
import type { CalendarPort } from "../ports.js";
import { adrForHk } from "../hkAdr.js";
import { fetchFinnhubCalendar } from "./finnhubCalendarAdapter.js";

export const hkAdrCalendarAdapter: CalendarPort = {
  id: "hk-adr-finnhub",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 86_400,
    costPerCallUsd: 0,
    notes: "Finnhub free tier via mapped US ADR ticker; only covers the hand-curated table in hkAdr.ts."
  },
  qualityRank: 1,
  // Declares market-level coverage only (the shared Adapter interface takes
  // no ticker); tickers outside the ADR table correctly resolve to "missing" in
  // fetchNextEarnings below, and getNextEarnings' chain fallback moves on to
  // postgresCalendarAdapter for those.
  supports(market: Market) { return market === "HK"; },
  async fetchNextEarnings(rawTicker: string) {
    const adr = adrForHk(rawTicker);
    if (!adr) return { providerStatus: "missing" as const, source: null };
    const result = await fetchFinnhubCalendar(adr);
    return { ...result, source: result.providerStatus === "ok" ? `finnhub-via-adr:${adr}` : result.source };
  }
};
