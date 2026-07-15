import { getEarningsCalendarRow } from "@echo/db/repositories/earningsCalendarRepository.js";
import type { Market } from "../market.js";
import type { CalendarPort } from "../ports.js";

// Every row in this table right now is frozen: upsertEarningsCalendar has no
// caller anywhere in tracked code, so nothing ever refreshes fetched_at. A
// row that was true when written can silently drift wrong (earnings dates
// move) with no signal to the caller that it's not being kept current. Cap
// how long a cached "ok" is trusted before this adapter downgrades it to
// "missing" rather than keep serving a stale date with full confidence —
// matches the project rule that missing data must say so, not guess.
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const postgresCalendarAdapter: CalendarPort = {
  id: "postgres-calendar-cache",
  authorization: { licenseTier: "unlicensed_free_tier", commercialUseAllowed: false, notes: "Cached provider calendar; authorization is not elevated by persistence." },
  // Ranked below finnhubCalendarAdapter (rank 1): this is a read-only cache
  // with no current writer (earningsCalendarRepository.upsertEarningsCalendar
  // is defined but nothing calls it yet), so for markets a live adapter
  // covers it should lose the tie; it still wins for HK/CN, where nothing
  // live is registered.
  qualityRank: 2,
  supports(market: Market) { return market !== "unsupported"; },
  async fetchNextEarnings(ticker: string) {
    const row = await getEarningsCalendarRow(ticker);
    if (!row) return { providerStatus: "missing" as const, source: null };
    const ageMs = Date.now() - new Date(row.fetched_at).getTime();
    if (row.provider_status === "ok" && ageMs > MAX_CACHE_AGE_MS) {
      return {
        providerStatus: "missing" as const,
        source: row.source,
        detail: `缓存已 ${Math.round(ageMs / 86_400_000)} 天未刷新（写入方已废弃），未核到最新财报日期`,
        staleRow: row
      };
    }
    return { providerStatus: row.provider_status === "ok" ? "ok" as const : "missing" as const, source: row.source, nextDate: row.next_date, row };
  }
};
