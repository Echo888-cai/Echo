import { detectMarket, hkCode } from "./market.js";

/**
 * HK ticker -> US ADR/ADS ticker that Finnhub can actually serve data for.
 *
 * There is no free API that returns this mapping directly: FMP's `profile`
 * endpoint has no adr/underlying field (checked live — HK and ADR profiles for
 * the same company share nothing but the company name), and `search-name`
 * returns every exchange listing under a fuzzy name match with no way to tell
 * which OTC hit is the "real" ADR (e.g. Tencent search-name returns both TCEHY
 * and TCTZF). So this is a small hand-curated table, kept short on purpose —
 * every entry below was verified with a live Finnhub call on 2026-07-14
 * (`GET /calendar/earnings?symbol=<adr>`) confirming the response's
 * `earningsCalendar[].symbol` matches the mapped HK ticker (e.g. querying
 * "TCEHY" returns entries tagged "700.HK"). Do not add an entry without that
 * same live verification — a wrong mapping here means a confidently-labeled
 * wrong earnings date or a wrong peer set, which is worse than "未核到".
 *
 * Shared by hkAdrCalendarAdapter and finnhubPeersAdapter: both need "which US
 * symbol stands in for this HK company on Finnhub's free tier", and two copies
 * of a hand-verified table would inevitably drift.
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

/** The mapped US ADR for an HK ticker, or null when we have no verified entry. */
export function adrForHk(ticker: string): string | null {
  return HK_TO_ADR[hkCode(ticker)] || null;
}

/**
 * The symbol to ask Finnhub about: US tickers as-is, HK via its verified ADR,
 * A-shares never (no ADR pipeline, and Finnhub's free tier has no CN coverage
 * at all — proven repeatedly across quotes/financials/calendar).
 */
export function adrOrBareSymbol(ticker: string): string | null {
  const market = detectMarket(ticker);
  if (market === "US") return String(ticker || "").trim().toUpperCase();
  if (market === "HK") return adrForHk(ticker);
  return null;
}
