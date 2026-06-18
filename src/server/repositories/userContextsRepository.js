/**
 * userContextsRepository — persists parsed user position/context per ticker.
 */

import { getDb } from "../../db/index.js";
import { randomUUID } from "node:crypto";

let ensured = false;

export function getOrCreateUserContext(ticker) {
  const db = getDb();
  if (!ensured) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_contexts (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      cost_basis REAL,
      shares INTEGER,
      horizon TEXT,
      risk_preference TEXT,
      thesis TEXT,
      constraints_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    // Ensure ticker unique constraint
    const existing = db.prepare("PRAGMA index_list(user_contexts)").all().filter(i => i.unique);
    if (!existing.length) {
      try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_uc_ticker ON user_contexts(ticker)"); } catch {}
    }
    ensured = true;
  }
  // Upsert
  db.prepare(`
    INSERT INTO user_contexts (id, ticker, cost_basis, shares, horizon, risk_preference, thesis, constraints_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      cost_basis = COALESCE(excluded.cost_basis, user_contexts.cost_basis),
      shares = COALESCE(excluded.shares, user_contexts.shares),
      horizon = COALESCE(excluded.horizon, user_contexts.horizon),
      risk_preference = COALESCE(excluded.risk_preference, user_contexts.risk_preference),
      thesis = COALESCE(excluded.thesis, user_contexts.thesis),
      constraints_json = COALESCE(excluded.constraints_json, user_contexts.constraints_json),
      updated_at = datetime('now')
  `).run(
    `uc_${randomUUID()}`,
    ticker,
    null, null, null, null, null, null
  );
  return db.prepare("SELECT * FROM user_contexts WHERE ticker = ?").get(ticker);
}

export function upsertUserContext(ticker, updates) {
  const db = getDb();
  if (!ensured) {
    getOrCreateUserContext(ticker); // ensures table exists
  }
  const existing = db.prepare("SELECT * FROM user_contexts WHERE ticker = ?").get(ticker);
  if (!existing) {
    db.prepare(`
      INSERT INTO user_contexts (id, ticker, cost_basis, shares, horizon, risk_preference, thesis, constraints_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(`uc_${randomUUID()}`, ticker, updates.costBasis??null, updates.shares??null, updates.horizon??null, updates.riskPreference??null, updates.thesis??null, updates.constraintsJson ?? null);
  } else {
    const params = {};
    for (const [key, col] of [["costBasis","cost_basis"],["shares","shares"],["horizon","horizon"],["riskPreference","risk_preference"],["thesis","thesis"],["constraintsJson","constraints_json"]]) {
      if (updates[key] !== undefined) params[col] = updates[key];
    }
    if (Object.keys(params).length) {
      const setClause = Object.keys(params).map(k => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE user_contexts SET ${setClause}, updated_at = datetime('now') WHERE ticker = ?`).run({ ...params, ticker });
    }
  }
  return db.prepare("SELECT * FROM user_contexts WHERE ticker = ?").get(ticker);
}

export function getUserContext(ticker) {
  const db = getDb();
  if (!ensured) return null;
  return db.prepare("SELECT * FROM user_contexts WHERE ticker = ?").get(ticker) || null;
}
