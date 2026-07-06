/**
 * historicalValuationRepository — `historical_valuation` 表读写（F-5）。
 * 一行 = 一只 ticker 最近一次拉取的 Finnhub 年度 PE 序列，24h TTL 由 historicalValuation.js
 * 判断，这里只管存取。
 */
import { getDb } from "../../db/index.js";

export function getHistoricalValuationRow(ticker) {
  return getDb().prepare("SELECT * FROM historical_valuation WHERE ticker = ?").get(ticker) || null;
}

export function upsertHistoricalValuationSeries({ ticker, series = [], providerStatus, detail = null }) {
  getDb().prepare(`
    INSERT INTO historical_valuation (ticker, provider_status, series_json, detail, fetched_at)
    VALUES (@ticker, @providerStatus, @seriesJson, @detail, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      provider_status = excluded.provider_status,
      series_json = excluded.series_json,
      detail = excluded.detail,
      fetched_at = datetime('now')
  `).run({
    ticker,
    providerStatus,
    seriesJson: Array.isArray(series) && series.length ? JSON.stringify(series) : null,
    detail
  });
}
