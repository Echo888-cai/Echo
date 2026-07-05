/**
 * canaryRepository — 真实数据 canary（`npm run canary`）结果落库与汇总查询（G-1/E1）。
 *
 * 一行 = 一次 (source, ticker) 探测结果，一批 = 一次 `npm run canary` 运行（batch_id）。
 * 汇总查询按 source 聚合"最近一次状态 / 最近成功时间 / 最近失败原因"——健康面板要看的是
 * 趋势（这个源最近是不是老挂），不是某一批的瞬时快照。
 */

import { getDb } from "../../db/index.js";

export function insertCanaryResult({ batchId, source, ticker, status, detail, latencyMs }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO canary_runs (batch_id, source, ticker, status, detail, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(batchId, source, ticker, status, detail ?? null, latencyMs ?? null);
}

export function getLatestBatchId() {
  const db = getDb();
  const row = db.prepare(`SELECT batch_id FROM canary_runs ORDER BY created_at DESC LIMIT 1`).get();
  return row?.batch_id || null;
}

/** 最近一批的全部原始结果（供"详情"展开用）。 */
export function getLatestBatchResults() {
  const batchId = getLatestBatchId();
  if (!batchId) return { batchId: null, ranAt: null, results: [] };
  const db = getDb();
  const results = db.prepare(`SELECT * FROM canary_runs WHERE batch_id = ? ORDER BY source, ticker`).all(batchId);
  return { batchId, ranAt: results[0]?.created_at || null, results };
}

/** 按 source 聚合的健康汇总：面板主视图（每源一行）。 */
export function getSourceHealthSummary() {
  const db = getDb();
  return db.prepare(`
    SELECT
      source,
      (SELECT status FROM canary_runs r2 WHERE r2.source = r1.source ORDER BY created_at DESC LIMIT 1) AS latest_status,
      (SELECT detail FROM canary_runs r2 WHERE r2.source = r1.source ORDER BY created_at DESC LIMIT 1) AS latest_detail,
      (SELECT created_at FROM canary_runs r2 WHERE r2.source = r1.source ORDER BY created_at DESC LIMIT 1) AS latest_checked_at,
      MAX(CASE WHEN status = 'ok' THEN created_at END) AS last_success_at,
      (SELECT detail FROM canary_runs r3 WHERE r3.source = r1.source AND r3.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS last_failure_detail,
      (SELECT created_at FROM canary_runs r3 WHERE r3.source = r1.source AND r3.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS last_failure_at
    FROM canary_runs r1
    GROUP BY source
    ORDER BY source
  `).all();
}
