/**
 * Earnings calendar use case: live next-date chain (finnhub / HK-ADR / postgres
 * cache) + last-reported quarter (finnhub /stock/earnings) → cached in
 * earnings_calendar (db).
 *
 * This finally gives that table a writer. `upsertEarningsCalendar` existed since
 * the schema landed but had **no caller anywhere in the repo** — the rows in
 * earnings_calendar were written by a deleted one-off script and frozen ever
 * since (docs/PLAN.md 能力现状 "earnings_calendar 无写入方"; the check:frozen
 * gate's first catch). Downstream it feeds three things that were built but ran
 * on dead data: postgresCalendarAdapter (the chain's cache tier), the worker's
 * earnings-review workflow (listWithLastReported), and F-2's
 * postEarnings/epsBeatRate scorecard columns.
 *
 * Mirrors compPeers.ts: TTL-gated cache, live refresh writes through, a failed
 * refresh never clobbers a good row, and a structural "no source for this
 * market" is answered honestly instead of served from a fossil.
 */
import { getLastReportedEarnings, getNextEarnings } from "@echo/data-plane";
import { getEarningsCalendarRow, upsertEarningsCalendar } from "@echo/db/repositories/earningsCalendarRepository.js";

const TTL_MS = 24 * 60 * 60 * 1000;

/** The next-earnings envelope shape the research panel/composer already consumes. */
function envelopeFromRow(row: any, { stale = false } = {}) {
  return {
    providerStatus: row.next_date ? ("ok" as const) : ("missing" as const),
    source: row.source || "earnings_calendar",
    nextDate: row.next_date ?? null,
    quarter: row.quarter ?? null,
    year: row.year ?? null,
    epsEstimate: row.eps_estimate ?? null,
    revenueEstimate: row.revenue_estimate ?? null,
    detail: stale ? "缓存数据，本轮日历源不可用" : row.detail ?? null
  };
}

/**
 * Next earnings for one subject, with the cache row refreshed as a side effect.
 * Never throws: the calendar is an enrichment — a provider outage degrades to
 * the stale cache row (marked as such), then to an honest "missing".
 */
export async function ensureEarningsCalendar(ticker: string): Promise<any> {
  let cached: any = null;
  try {
    cached = await getEarningsCalendarRow(ticker);
    if (cached?.fetched_at && Date.now() - Date.parse(cached.fetched_at) < TTL_MS) {
      return envelopeFromRow(cached);
    }
  } catch { /* cache unavailable — fall through to the live calls */ }

  const [nextSettled, lastSettled] = await Promise.allSettled([
    getNextEarnings(ticker),
    getLastReportedEarnings(ticker)
  ]);
  const nextResult: any = nextSettled.status === "fulfilled" ? nextSettled.value.result : null;
  const next = nextResult?.providerStatus === "ok" ? nextResult : null;
  const lastResult = lastSettled.status === "fulfilled" ? lastSettled.value : null;
  const last = lastResult?.providerStatus === "ok" ? lastResult.lastReported : null;

  if (!next && !last) {
    // Both live sources failed or came back empty. Do NOT write: overwriting a
    // good row with nulls would erase the last_* facts the review workflow needs.
    if (cached) return envelopeFromRow(cached, { stale: true });
    return {
      providerStatus: "missing" as const, source: null, nextDate: null,
      detail: nextResult?.detail || (nextSettled.status === "rejected"
        ? (nextSettled.reason instanceof Error ? nextSettled.reason.message : "日历源不可用")
        : "未核到下一业绩日")
    };
  }

  // Field-level fallback to the cached row: a refresh where only one live source
  // answered must not blank the other half of the row.
  const cachedLast = cached?.last_date ? {
    date: cached.last_date, quarter: cached.last_quarter, year: cached.last_year,
    epsEstimate: cached.last_eps_estimate, epsActual: cached.last_eps_actual,
    revenueEstimate: cached.last_revenue_estimate, revenueActual: cached.last_revenue_actual,
    epsSurprisePct: cached.last_eps_surprise_pct, revenueSurprisePct: cached.last_revenue_surprise_pct
  } : null;
  await upsertEarningsCalendar({
    ticker,
    nextDate: next?.nextDate ?? cached?.next_date ?? null,
    quarter: next?.quarter ?? cached?.quarter ?? null,
    year: next?.year ?? cached?.year ?? null,
    epsEstimate: next?.epsEstimate ?? cached?.eps_estimate ?? null,
    revenueEstimate: next?.revenueEstimate ?? cached?.revenue_estimate ?? null,
    source: next?.source ?? (last ? "finnhub" : cached?.source ?? null),
    providerStatus: "ok",
    detail: null,
    lastReported: last ?? cachedLast
  }).catch(() => { /* a failed cache write must not fail the research call */ });

  if (next) return next;
  if (cached?.next_date) return envelopeFromRow(cached, { stale: true });
  return { providerStatus: "missing" as const, source: lastResult?.source ?? null, nextDate: null,
    detail: "已报告业绩已刷新，但未核到下一业绩日" };
}
