/**
 * hkBuybackRepository — `hk_buybacks` 表读写（F-4b）。
 * 一行 = 一份 HKEX 翌日披露报表（FF305）里核到的真实购回：交易日/购回股数/价格区间/
 * 总代价 + 同一份公告里的已发行股份期末结存（股本趋势的粗线数据）。
 */
import { getDb } from "../../db/index.js";

export function hasHkBuybackForUrl(sourceUrl) {
  return !!getDb().prepare("SELECT 1 FROM hk_buybacks WHERE source_url = ?").get(sourceUrl);
}

export function upsertHkBuyback({
  ticker, tradeDate, sharesRepurchased, priceHigh, priceLow, totalConsideration, currency,
  sharesIssuedTotal = null, periodEndDate = null, sourceTitle, sourceUrl, publishedAt
}) {
  getDb().prepare(`
    INSERT INTO hk_buybacks (
      ticker, trade_date, shares_repurchased, price_high, price_low, total_consideration, currency,
      shares_issued_total, period_end_date, source_title, source_url, published_at
    )
    VALUES (@ticker, @tradeDate, @sharesRepurchased, @priceHigh, @priceLow, @totalConsideration, @currency,
      @sharesIssuedTotal, @periodEndDate, @sourceTitle, @sourceUrl, @publishedAt)
    ON CONFLICT(source_url) DO NOTHING
  `).run({
    ticker, tradeDate, sharesRepurchased, priceHigh, priceLow, totalConsideration, currency,
    sharesIssuedTotal, periodEndDate, sourceTitle, sourceUrl, publishedAt
  });
}

/** 近 N 天的购回记录（新→旧），供 dataSources.js 聚合成事实块。 */
export function listRecentHkBuybacks(ticker, days = 180) {
  return getDb().prepare(`
    SELECT * FROM hk_buybacks
    WHERE ticker = ? AND trade_date >= date('now', ?)
    ORDER BY trade_date DESC
  `).all(ticker, `-${days} days`);
}

/** 最近一次摄取时间（判断是否需要后台刷新）。 */
export function getLatestHkBuybackFetchedAt(ticker) {
  const row = getDb().prepare("SELECT fetched_at FROM hk_buybacks WHERE ticker = ? ORDER BY fetched_at DESC LIMIT 1").get(ticker);
  return row?.fetched_at || null;
}
