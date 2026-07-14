import type { Market } from "../market.js";
import type { CalendarPort, ProviderEnvelope } from "../ports.js";

/**
 * Finnhub free-tier /calendar/earnings. Verified live: the endpoint needs an
 * explicit `from`/`to` range — calling it without one returns an always-empty
 * `{"earningsCalendar":[]}`, not an error, so a naive port would silently look
 * like "no upcoming earnings" for every ticker. HK symbols return the same
 * "no access" error as the quote endpoint (free tier is US-only), matching
 * `finnhubQuoteAdapter`'s coverage.
 */
/**
 * Calls Finnhub's calendar endpoint for `symbol` and returns the nearest
 * upcoming earnings entry as a ProviderEnvelope. Shared by finnhubCalendarAdapter
 * (queries the ticker directly, US-only) and hkAdrCalendarAdapter (queries a
 * mapped US ADR ticker on behalf of an HK-listed company — Finnhub's calendar
 * keys off the ADR symbol but the entries it returns describe the underlying
 * company's single earnings date, e.g. querying "TCEHY" returns entries tagged
 * `symbol: "700.HK"`).
 */
export async function fetchFinnhubCalendar(symbol: string): Promise<ProviderEnvelope & { nextDate: string | null }> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY not configured");
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error(`finnhub calendar ${response.status} for ${symbol}`);
  const body: any = await response.json();
  if (body?.error) throw new Error(`finnhub calendar error for ${symbol}: ${body.error}`);
  const entries = Array.isArray(body?.earningsCalendar) ? body.earningsCalendar : [];
  // Multiple entries can come back for tickers with both estimate revisions
  // and confirmed dates in range; the nearest upcoming date is "next earnings".
  const next = entries
    .filter((e: any) => typeof e?.date === "string")
    .sort((a: any, b: any) => a.date.localeCompare(b.date))[0];
  if (!next) return { providerStatus: "missing" as const, source: "finnhub", nextDate: null };
  return {
    providerStatus: "ok" as const,
    source: "finnhub",
    nextDate: next.date,
    quarter: next.quarter ?? null,
    year: next.year ?? null,
    epsEstimate: typeof next.epsEstimate === "number" ? next.epsEstimate : null,
    revenueEstimate: typeof next.revenueEstimate === "number" ? next.revenueEstimate : null
  };
}

export const finnhubCalendarAdapter: CalendarPort = {
  id: "finnhub",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 86_400,
    costPerCallUsd: 0,
    notes: "Finnhub free tier: US-listed symbols only, 60 req/min."
  },
  qualityRank: 1,
  supports(market: Market) { return market === "US"; },
  async fetchNextEarnings(rawTicker: string) {
    return fetchFinnhubCalendar(rawTicker.trim().toUpperCase());
  }
};
