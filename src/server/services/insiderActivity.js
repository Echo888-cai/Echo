/**
 * insiderActivity — F-4a 股东回报供数（美股先行）：SEC Form 4 内部人交易净买卖，
 * 24h TTL 读穿透缓存 + stale-if-error 兜底，与 earningsCalendar.js / compPeers.js 同款节奏。
 *
 * 只对美股生效——港股没有对应的 SEC 备案，诚实返回 missing，不猜（HK 一侧的股东回报
 * 供数是 HKEX 每日回购报告，另立 F-4b，见 PLAN.md）。
 */
import { isUS } from "../../market.js";
import { fetchInsiderActivity } from "../../secFilings.js";
import { getInsiderActivityRow, upsertInsiderActivity } from "../repositories/insiderActivityRepository.js";

const TTL_MS = 24 * 60 * 60 * 1000;

function rowAgeMs(row) {
  const fetchedAt = Date.parse(`${row.fetched_at}Z`);
  return Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Infinity;
}

function rowToResult(row, { stale = false } = {}) {
  let transactions;
  try { transactions = row.transactions_json ? JSON.parse(row.transactions_json) : []; } catch { transactions = []; }
  return {
    ticker: row.ticker,
    providerStatus: row.provider_status,
    netShares: row.net_shares,
    netValueUsd: row.net_value_usd,
    buyCount: row.buy_count,
    sellCount: row.sell_count,
    distinctInsiders: row.distinct_insiders,
    lastTransactionAt: row.last_transaction_at,
    transactions,
    detail: row.detail,
    stale
  };
}

/**
 * 该 ticker 近 180 天的内部人净买卖，24h TTL 读穿透缓存，stale-if-error 兜底。
 * @returns {Promise<{ticker, providerStatus: "ok"|"missing"|"error", netShares, netValueUsd, buyCount, sellCount, distinctInsiders, lastTransactionAt, transactions, detail, stale}>}
 */
export async function getInsiderActivity(ticker) {
  const t = String(ticker || "").toUpperCase();
  if (!isUS(t)) {
    return { ticker: t, providerStatus: "missing", netShares: null, netValueUsd: null, buyCount: null, sellCount: null, distinctInsiders: null, lastTransactionAt: null, transactions: [], detail: "港股无 SEC 备案，供数见 HKEX 回购报告（F-4b，未开工）", stale: false };
  }

  const row = getInsiderActivityRow(t);
  if (row && rowAgeMs(row) < TTL_MS) return rowToResult(row);

  try {
    const fresh = await fetchInsiderActivity(t);
    upsertInsiderActivity({ ticker: t, ...fresh });
    return { ticker: t, stale: false, ...fresh };
  } catch (error) {
    if (row) return rowToResult(row, { stale: true }); // 兜底：旧数据总比什么都没有强
    const detail = error?.message || "内部人交易请求失败";
    upsertInsiderActivity({ ticker: t, providerStatus: "error", detail });
    return { ticker: t, providerStatus: "error", netShares: null, netValueUsd: null, buyCount: null, sellCount: null, distinctInsiders: null, lastTransactionAt: null, transactions: [], detail, stale: false };
  }
}
