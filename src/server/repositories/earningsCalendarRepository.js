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

export function upsertEarningsCalendar({ ticker, nextDate, quarter, year, epsEstimate, revenueEstimate, source, providerStatus, detail, lastReported = null }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO earnings_calendar (
      ticker, next_date, quarter, year, eps_estimate, revenue_estimate, source, provider_status, detail, fetched_at,
      last_date, last_quarter, last_year, last_eps_estimate, last_eps_actual, last_revenue_estimate, last_revenue_actual,
      last_eps_surprise_pct, last_revenue_surprise_pct
    )
    VALUES (
      @ticker, @nextDate, @quarter, @year, @epsEstimate, @revenueEstimate, @source, @providerStatus, @detail, datetime('now'),
      @lastDate, @lastQuarter, @lastYear, @lastEpsEstimate, @lastEpsActual, @lastRevenueEstimate, @lastRevenueActual,
      @lastEpsSurprisePct, @lastRevenueSurprisePct
    )
    ON CONFLICT(ticker) DO UPDATE SET
      next_date = excluded.next_date,
      quarter = excluded.quarter,
      year = excluded.year,
      eps_estimate = excluded.eps_estimate,
      revenue_estimate = excluded.revenue_estimate,
      source = excluded.source,
      provider_status = excluded.provider_status,
      detail = excluded.detail,
      fetched_at = datetime('now'),
      last_date = excluded.last_date,
      last_quarter = excluded.last_quarter,
      last_year = excluded.last_year,
      last_eps_estimate = excluded.last_eps_estimate,
      last_eps_actual = excluded.last_eps_actual,
      last_revenue_estimate = excluded.last_revenue_estimate,
      last_revenue_actual = excluded.last_revenue_actual,
      last_eps_surprise_pct = excluded.last_eps_surprise_pct,
      last_revenue_surprise_pct = excluded.last_revenue_surprise_pct
  `).run({
    ticker,
    nextDate: nextDate ?? null,
    quarter: quarter ?? null,
    year: year ?? null,
    epsEstimate: epsEstimate ?? null,
    revenueEstimate: revenueEstimate ?? null,
    source: source ?? null,
    providerStatus,
    detail: detail ?? null,
    lastDate: lastReported?.date ?? null,
    lastQuarter: lastReported?.quarter ?? null,
    lastYear: lastReported?.year ?? null,
    lastEpsEstimate: lastReported?.epsEstimate ?? null,
    lastEpsActual: lastReported?.epsActual ?? null,
    lastRevenueEstimate: lastReported?.revenueEstimate ?? null,
    lastRevenueActual: lastReported?.revenueActual ?? null,
    lastEpsSurprisePct: lastReported?.epsSurprisePct ?? null,
    lastRevenueSurprisePct: lastReported?.revenueSurprisePct ?? null
  });
}

/**
 * F-2：全部"已核到最近一期实际数字"的 ticker。**不按日期窗口筛选**——`last_date` 是
 * Finnhub 免费档给的财季结束日，不是公告发布日（免费档没有后者），拿它做"最近 N 天"
 * 窗口会不准（一个 3/31 结束的季度可能 4 月底才公告，用财季结束日判断"是不是刚发生"
 * 会系统性地偏早）。真正的"是否已经提醒过这一期"交给调用方按 ticker+year+quarter
 * 拼 dedupeKey（notifier 的去重机制），这里只管"有没有数据"，不管"新不新"。
 */
export function listWithLastReported() {
  const db = getDb();
  return db.prepare(`
    SELECT ticker, last_date, last_quarter, last_year,
           last_eps_estimate, last_eps_actual, last_revenue_estimate, last_revenue_actual,
           last_eps_surprise_pct, last_revenue_surprise_pct
    FROM earnings_calendar
    WHERE last_year IS NOT NULL AND last_quarter IS NOT NULL AND last_eps_actual IS NOT NULL
  `).all();
}
