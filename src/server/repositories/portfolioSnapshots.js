/**
 * portfolioSnapshots repository — 每日组合净值快照（M-1，PLAN v4 E9）。
 *
 * 一天一行，snapshot_date 主键：同一天重复写入是幂等 upsert，不会产生重复行
 * （scheduler misfire 补跑、进程重启都安全）。
 */

import { getDb } from "../../db/index.js";

function hydrate(row) {
  if (!row) return null;
  return {
    date: row.snapshot_date,
    totalValueUsd: row.total_value_usd,
    totalCostUsd: row.total_cost_usd,
    totalPnlUsd: row.total_pnl_usd,
    positionCount: row.position_count,
    totals: row.totals_json ? JSON.parse(row.totals_json) : []
  };
}

/**
 * @param {{date: string, totalValueUsd: number|null, totalCostUsd: number|null,
 *   totalPnlUsd: number|null, positionCount: number, totals: Array<{currency: string, marketValue: number}>}} snapshot
 */
export function upsertSnapshot(snapshot) {
  const db = getDb();
  db.prepare(`
    INSERT INTO portfolio_snapshots (snapshot_date, total_value_usd, total_cost_usd, total_pnl_usd, position_count, totals_json)
    VALUES (@date, @totalValueUsd, @totalCostUsd, @totalPnlUsd, @positionCount, @totalsJson)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      total_value_usd = excluded.total_value_usd,
      total_cost_usd = excluded.total_cost_usd,
      total_pnl_usd = excluded.total_pnl_usd,
      position_count = excluded.position_count,
      totals_json = excluded.totals_json
  `).run({
    date: snapshot.date,
    totalValueUsd: snapshot.totalValueUsd ?? null,
    totalCostUsd: snapshot.totalCostUsd ?? null,
    totalPnlUsd: snapshot.totalPnlUsd ?? null,
    positionCount: snapshot.positionCount,
    totalsJson: JSON.stringify(snapshot.totals || [])
  });
}

/** 最近 N 天快照，按日期升序（图表从旧到新绘制）。 */
export function listSnapshots(limit = 180) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM (SELECT * FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT ?) sub ORDER BY snapshot_date ASC"
  ).all(limit);
  return rows.map(hydrate);
}
