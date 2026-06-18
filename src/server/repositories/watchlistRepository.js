/**
 * watchlistRepository — persists research watchlist items to SQLite.
 */

import { getDb } from "../../db/index.js";
import { randomUUID } from "node:crypto";

const SCHEMA = {
  id: "TEXT PRIMARY KEY",
  ticker: "TEXT NOT NULL",
  reason: "TEXT",
  cost_basis: "REAL",
  shares: "INTEGER",
  status: "TEXT NOT NULL DEFAULT 'watch'",
  notes: "TEXT",
  review_date: "TEXT",
  created_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
  updated_at: "TEXT NOT NULL DEFAULT (datetime('now'))"
};

let ensured = false;

function ensureTable() {
  if (ensured) return;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS watchlist (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    reason TEXT,
    cost_basis REAL,
    shares INTEGER,
    status TEXT NOT NULL DEFAULT 'watch',
    notes TEXT,
    review_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Ensure all columns exist (migration)
  const cols = new Set(db.prepare("PRAGMA table_info(watchlist)").all().map(c => c.name));
  for (const [name, def] of Object.entries(SCHEMA)) {
    if (!cols.has(name) && name !== "id") {
      try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${name} ${def.replace("NOT NULL", "").replace("PRIMARY KEY", "").trim()}`); } catch {}
    }
  }
  ensured = true;
}

export function listWatchlist() {
  ensureTable();
  const db = getDb();
  return db.prepare("SELECT w.*, c.name_zh as company_name FROM watchlist w LEFT JOIN companies c ON w.ticker = c.ticker ORDER BY w.updated_at DESC").all();
}

export function getWatchlistItem(id) {
  ensureTable();
  const db = getDb();
  return db.prepare("SELECT w.*, c.name_zh as company_name FROM watchlist w LEFT JOIN companies c ON w.ticker = c.ticker WHERE w.id = ?").get(id) || null;
}

export function getWatchlistItemByTicker(ticker) {
  ensureTable();
  const db = getDb();
  return db.prepare("SELECT * FROM watchlist WHERE ticker = ?").get(ticker) || null;
}

export function addWatchlistItem({ ticker, reason = "", costBasis = null, shares = null, status = "watch", notes = "", reviewDate = null }) {
  ensureTable();
  const db = getDb();
  const id = `wl_${randomUUID()}`;
  db.prepare(`
    INSERT INTO watchlist (id, ticker, reason, cost_basis, shares, status, notes, review_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ticker, reason, costBasis, shares, status, notes, reviewDate);
  return getWatchlistItem(id);
}

export function updateWatchlistItem(id, updates) {
  ensureTable();
  const db = getDb();
  const item = getWatchlistItem(id);
  if (!item) return null;
  const fields = [];
  const params = [];
  for (const [key, col] of [["reason", "reason"], ["costBasis", "cost_basis"], ["shares", "shares"], ["status", "status"], ["notes", "notes"], ["reviewDate", "review_date"]]) {
    if (updates[key] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(updates[key]);
    }
  }
  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    db.prepare(`UPDATE watchlist SET ${fields.join(", ")} WHERE id = ?`).run(...params, id);
  }
  return getWatchlistItem(id);
}

export function deleteWatchlistItem(id) {
  ensureTable();
  const db = getDb();
  db.prepare("DELETE FROM watchlist WHERE id = ?").run(id);
}

export function getWatchlistSummary() {
  ensureTable();
  const db = getDb();
  const items = listWatchlist();
  const hasCost = items.filter(i => i.cost_basis);
  const hasShares = items.filter(i => i.shares);
  const hasReason = items.filter(i => i.reason && i.reason.length > 0);
  const sectorExposure = {};
  for (const item of items) {
    const company = db.prepare("SELECT sector FROM companies WHERE ticker = ?").get(item.ticker);
    const sector = company?.sector || "其他";
    sectorExposure[sector] = (sectorExposure[sector] || 0) + 1;
  }
  return {
    total: items.length,
    withCost: hasCost.length,
    withShares: hasShares.length,
    withReason: hasReason.length,
    missingCost: items.length - hasCost.length,
    missingShares: items.length - hasShares.length,
    missingReason: items.length - hasReason.length,
    sectorExposure
  };
}
