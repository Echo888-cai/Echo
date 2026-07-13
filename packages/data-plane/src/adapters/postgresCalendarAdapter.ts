import { getEarningsCalendarRow } from "@echo/db/repositories/earningsCalendarRepository.js";
import type { Market } from "../market.js";
import type { CalendarPort } from "../ports.js";

export const postgresCalendarAdapter: CalendarPort = {
  id: "postgres-calendar-cache",
  authorization: { licenseTier: "unlicensed_free_tier", commercialUseAllowed: false, notes: "Cached provider calendar; authorization is not elevated by persistence." },
  qualityRank: 1,
  supports(_market: Market) { return true; },
  async fetchNextEarnings(ticker: string) {
    const row = await getEarningsCalendarRow(ticker);
    return row ? { providerStatus: row.provider_status === "ok" ? "ok" as const : "missing" as const, source: row.source, nextDate: row.next_date, row }
      : { providerStatus: "missing" as const, source: null };
  }
};
