/**
 * earningsCalendarRepository — `earnings_calendar` 表的读写（G-2）。
 * 一行 = 一只 ticker 当前已知的"下一业绩日"，24h TTL 由 earningsCalendar.js 判断，
 * 这里只管存取。
 */
import { getDb } from "../../db/index.js";

export function getEarningsCalendarRow(ticker) {
  const db = getDb();
  return db.prepare(`SELECT * FROM earnings_calendar WHERE ticker = ?`).get(ticker) || null;
}

export function upsertEarningsCalendar({ ticker, nextDate, quarter, year, epsEstimate, revenueEstimate, source, providerStatus, detail }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO earnings_calendar (ticker, next_date, quarter, year, eps_estimate, revenue_estimate, source, provider_status, detail, fetched_at)
    VALUES (@ticker, @nextDate, @quarter, @year, @epsEstimate, @revenueEstimate, @source, @providerStatus, @detail, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      next_date = excluded.next_date,
      quarter = excluded.quarter,
      year = excluded.year,
      eps_estimate = excluded.eps_estimate,
      revenue_estimate = excluded.revenue_estimate,
      source = excluded.source,
      provider_status = excluded.provider_status,
      detail = excluded.detail,
      fetched_at = datetime('now')
  `).run({
    ticker,
    nextDate: nextDate ?? null,
    quarter: quarter ?? null,
    year: year ?? null,
    epsEstimate: epsEstimate ?? null,
    revenueEstimate: revenueEstimate ?? null,
    source: source ?? null,
    providerStatus,
    detail: detail ?? null
  });
}
