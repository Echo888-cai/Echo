/**
 * insiderActivityRepository — `insider_activity` 表读写（F-4a）。
 * 一行 = 一只 ticker 最近一次拉取的 Form 4 净买卖汇总，24h TTL 由 insiderActivity.js 判断，
 * 这里只管存取。
 */
import { getDb } from "../../db/index.js";

export function getInsiderActivityRow(ticker) {
  return getDb().prepare("SELECT * FROM insider_activity WHERE ticker = ?").get(ticker) || null;
}

export function upsertInsiderActivity({
  ticker, providerStatus, netShares = null, netValueUsd = null, buyCount = null, sellCount = null,
  distinctInsiders = null, lastTransactionAt = null, transactions = [], detail = null
}) {
  getDb().prepare(`
    INSERT INTO insider_activity (
      ticker, provider_status, net_shares, net_value_usd, buy_count, sell_count,
      distinct_insiders, last_transaction_at, transactions_json, detail, fetched_at
    )
    VALUES (@ticker, @providerStatus, @netShares, @netValueUsd, @buyCount, @sellCount,
      @distinctInsiders, @lastTransactionAt, @transactionsJson, @detail, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      provider_status = excluded.provider_status,
      net_shares = excluded.net_shares,
      net_value_usd = excluded.net_value_usd,
      buy_count = excluded.buy_count,
      sell_count = excluded.sell_count,
      distinct_insiders = excluded.distinct_insiders,
      last_transaction_at = excluded.last_transaction_at,
      transactions_json = excluded.transactions_json,
      detail = excluded.detail,
      fetched_at = datetime('now')
  `).run({
    ticker, providerStatus,
    netShares, netValueUsd, buyCount, sellCount, distinctInsiders,
    lastTransactionAt,
    transactionsJson: Array.isArray(transactions) && transactions.length ? JSON.stringify(transactions.slice(0, 10)) : null,
    detail
  });
}
