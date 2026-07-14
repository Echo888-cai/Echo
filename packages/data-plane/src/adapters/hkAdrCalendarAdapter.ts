import type { Market } from "../market.js";
import type { CalendarPort } from "../ports.js";
import { hkCode } from "../market.js";
import { fetchFinnhubCalendar } from "./finnhubCalendarAdapter.js";

/**
 * HK ticker -> US ADR/ADS ticker Finnhub can actually serve earnings dates
 * for. There is no free API that returns this mapping directly: FMP's
 * `profile` endpoint has no adr/underlying field (checked live — HK and ADR
 * profiles for the same company share nothing but the company name), and
 * `search-name` returns every exchange listing under a fuzzy name match with
 * no way to tell which OTC hit is the "real" ADR (e.g. Tencent search-name
 * returns both TCEHY and TCTZF). So this is a small hand-curated table, kept
 * short on purpose — every entry below was verified with a live Finnhub call
 * on 2026-07-14 (`GET /calendar/earnings?symbol=<adr>`) confirming the
 * response's `earningsCalendar[].symbol` matches the mapped HK ticker (e.g.
 * querying "TCEHY" returns entries tagged "700.HK"). Do not add an entry
 * without that same live verification — a wrong mapping here means a
 * confidently-labeled wrong earnings date, which is worse than reporting
 * "未核到".
 */
const HK_TO_ADR: Record<string, string> = {
  "0700": "TCEHY", // Tencent Holdings
  "9988": "BABA",  // Alibaba Group
  "3690": "MPNGY", // Meituan
  "1810": "XIACY", // Xiaomi
  "9618": "JD",    // JD.com
  "2318": "PNGAY", // Ping An Insurance
  "1211": "BYDDY", // BYD
  "0005": "HSBC",  // HSBC Holdings
  "0941": "CHL"    // China Mobile
};

export const hkAdrCalendarAdapter: CalendarPort = {
  id: "hk-adr-finnhub",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 86_400,
    costPerCallUsd: 0,
    notes: "Finnhub free tier via mapped US ADR ticker; only covers the hand-curated HK_TO_ADR table."
  },
  qualityRank: 1,
  // Declares market-level coverage only (the shared Adapter interface takes
  // no ticker); tickers outside HK_TO_ADR correctly resolve to "missing" in
  // fetchNextEarnings below, and getNextEarnings' chain fallback moves on to
  // postgresCalendarAdapter for those.
  supports(market: Market) { return market === "HK"; },
  async fetchNextEarnings(rawTicker: string) {
    const adr = HK_TO_ADR[hkCode(rawTicker)];
    if (!adr) return { providerStatus: "missing" as const, source: null };
    const result = await fetchFinnhubCalendar(adr);
    return { ...result, source: result.providerStatus === "ok" ? `finnhub-via-adr:${adr}` : result.source };
  }
};
