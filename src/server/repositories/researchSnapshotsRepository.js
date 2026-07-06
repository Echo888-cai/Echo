/**
 * researchSnapshotsRepository — R7 研究记分卡/自动复盘的持久层（Phase A）。
 *
 * 一行 = 一次"判断快照"，落在 `companyPortrait.updatePortraitFromPanel` 判定
 * 建档/判断变化的同一批触发点（跟 profile_events 同源，不单独产生流水账）。
 */

import { getDb } from "../../db/index.js";

/** 落一行研究快照。永远不抛错——快照写入失败不该影响画像回写主流程。 */
export function insertResearchSnapshot({
  ticker, snapshotDate, thesis = null, valuationPosition = null,
  valuationBear = null, valuationBase = null, valuationBull = null, valuationCurrency = null,
  priceAtSnapshot = null, falsifiers = [], sessionId = null
}) {
  try {
    getDb().prepare(`
      INSERT INTO research_snapshots
        (ticker, snapshot_date, thesis, valuation_position, valuation_bear, valuation_base, valuation_bull,
         valuation_currency, price_at_snapshot, falsifiers_json, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(ticker || "").toUpperCase(), snapshotDate, thesis, valuationPosition,
      valuationBear, valuationBase, valuationBull, valuationCurrency,
      priceAtSnapshot, JSON.stringify(Array.isArray(falsifiers) ? falsifiers.slice(0, 6) : []),
      sessionId
    );
  } catch (err) {
    console.error("[researchSnapshots] 写入失败：", err?.message || err);
  }
}

function hydrate(row) {
  let falsifiers;
  try { falsifiers = JSON.parse(row.falsifiers_json || "[]"); } catch { falsifiers = []; }
  return {
    id: row.id,
    ticker: row.ticker,
    snapshotDate: row.snapshot_date,
    thesis: row.thesis || "",
    valuationPosition: row.valuation_position || null,
    valuationBear: row.valuation_bear,
    valuationBase: row.valuation_base,
    valuationBull: row.valuation_bull,
    valuationCurrency: row.valuation_currency || null,
    priceAtSnapshot: row.price_at_snapshot,
    falsifiers,
    sessionId: row.session_id || null,
    createdAt: row.created_at
  };
}

/** 某 ticker 的全部快照，按时间正序（最早在前，复盘时间线用）。 */
export function listSnapshots(ticker) {
  return getDb()
    .prepare("SELECT * FROM research_snapshots WHERE ticker = ? ORDER BY id ASC")
    .all(String(ticker || "").toUpperCase())
    .map(hydrate);
}

/** 有快照的全部 ticker + 最早/最新快照时间（供全局记分卡与 Phase C 复盘提醒用）。 */
export function listSnapshotTickers() {
  return getDb()
    .prepare(`
      SELECT ticker, MIN(created_at) AS first_snapshot_at, MAX(created_at) AS last_snapshot_at, COUNT(*) AS snapshot_count
      FROM research_snapshots
      GROUP BY ticker
      ORDER BY ticker
    `)
    .all()
    .map((r) => ({
      ticker: r.ticker,
      firstSnapshotAt: r.first_snapshot_at,
      lastSnapshotAt: r.last_snapshot_at,
      snapshotCount: r.snapshot_count
    }));
}
