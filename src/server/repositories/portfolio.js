/**
 * portfolio repository — 持仓账本（对标 HoneClaw 的 portfolio）。
 *
 * 每个 ticker 一条持仓：股数、成本、止损线、止盈线、备注。
 * 自然语言记账时 upsert；事件引擎读它来产出"触线提醒"。
 */

import { getDb } from "../../db/index.js";
import { normalizeTicker } from "../../data.js";
import { detectMarket } from "../../market.js";

function ensureCompanyRow(db, ticker, name) {
  if (!ticker) return;
  try {
    const us = detectMarket(ticker) === "US";
    db.prepare(
      `INSERT OR IGNORE INTO companies (ticker, name_zh, name_en, exchange, currency, listing_status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    ).run(ticker, name || ticker, us ? name || ticker : null, us ? "US" : "HKEX", us ? "USD" : "HKD");
  } catch {
    // best effort
  }
}

/** @returns {import("../types.js").PortfolioPosition|null} */
function hydrate(row) {
  if (!row) return null;
  return {
    ticker: row.ticker,
    companyName: row.company_name || row.ticker,
    shares: row.shares,
    avgCost: row.avg_cost,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    note: row.note || "",
    updatedAt: row.updated_at
  };
}

/** @returns {import("../types.js").PortfolioPosition|null} */
export function getPosition(ticker) {
  const db = getDb();
  return hydrate(db.prepare("SELECT * FROM portfolio_positions WHERE ticker = ?").get(normalizeTicker(ticker)));
}

/** @returns {import("../types.js").PortfolioPosition[]} */
export function listPositions() {
  const db = getDb();
  return db.prepare("SELECT * FROM portfolio_positions ORDER BY updated_at DESC").all().map(hydrate);
}

/**
 * Upsert a position. Only provided (non-null) fields overwrite existing ones.
 * @param {string} ticker
 * @param {{companyName?: string, shares?: number, avgCost?: number, stopLoss?: number, takeProfit?: number, note?: string}} [patch]
 * @returns {import("../types.js").PortfolioPosition|null}
 */
export function upsertPosition(ticker, patch = {}) {
  const db = getDb();
  const normalized = normalizeTicker(ticker);
  ensureCompanyRow(db, normalized, patch.companyName);
  const existing = getPosition(normalized);
  const merged = {
    companyName: patch.companyName ?? existing?.companyName ?? normalized,
    shares: patch.shares ?? existing?.shares ?? null,
    avgCost: patch.avgCost ?? existing?.avgCost ?? null,
    stopLoss: patch.stopLoss ?? existing?.stopLoss ?? null,
    takeProfit: patch.takeProfit ?? existing?.takeProfit ?? null,
    note: patch.note ?? existing?.note ?? ""
  };
  db.prepare(`
    INSERT INTO portfolio_positions (ticker, company_name, shares, avg_cost, stop_loss, take_profit, note, updated_at)
    VALUES (@ticker, @companyName, @shares, @avgCost, @stopLoss, @takeProfit, @note, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      company_name = excluded.company_name,
      shares = excluded.shares,
      avg_cost = excluded.avg_cost,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      note = excluded.note,
      updated_at = datetime('now')
  `).run({ ticker: normalized, ...merged });
  return getPosition(normalized);
}

export function deletePosition(ticker) {
  const db = getDb();
  return db.prepare("DELETE FROM portfolio_positions WHERE ticker = ?").run(normalizeTicker(ticker)).changes > 0;
}
