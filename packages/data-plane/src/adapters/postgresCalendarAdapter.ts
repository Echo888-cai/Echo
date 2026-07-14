import { getEarningsCalendarRow } from "@echo/db/repositories/earningsCalendarRepository.js";
import type { Market } from "../market.js";
import type { CalendarPort } from "../ports.js";

export const postgresCalendarAdapter: CalendarPort = {
  id: "postgres-calendar-cache",
  authorization: { licenseTier: "unlicensed_free_tier", commercialUseAllowed: false, notes: "Cached provider calendar; authorization is not elevated by persistence." },
  // Ranked below finnhubCalendarAdapter (rank 1): this is a read-only cache
  // with no current writer (earningsCalendarRepository.upsertEarningsCalendar
  // is defined but nothing calls it yet), so for markets a live adapter
  // covers it should lose the tie; it still wins for HK/CN, where nothing
  // live is registered.
  qualityRank: 2,
  supports(_market: Market) { return true; },
  async fetchNextEarnings(ticker: string) {
    const row = await getEarningsCalendarRow(ticker);
    return row ? { providerStatus: row.provider_status === "ok" ? "ok" as const : "missing" as const, source: row.source, nextDate: row.next_date, row }
      : { providerStatus: "missing" as const, source: null };
  }
};
