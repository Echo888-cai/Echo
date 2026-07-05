/**
 * llmAuditRepository — 模型网关调用留痕（E4）。
 *
 * 一行 = 一次 provider 尝试（含 failover 链路里被跳过前失败的那几跳），供设置页
 * "模型调用"面板查询：谁在接、各自延迟/失败率、最近一次失败原因是什么。
 */

import { getDb } from "../../db/index.js";

/** 落一行调用留痕。永远不抛错——审计失败不该影响研究主流程。 */
export function insertLlmAudit({ provider, model = null, kind = "chat", status, latencyMs = null, errorDetail = null }) {
  try {
    getDb().prepare(`
      INSERT INTO llm_audit (provider, model, kind, status, latency_ms, error_detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(provider || "unknown"), model, kind, String(status || "error"), latencyMs, errorDetail ? String(errorDetail).slice(0, 500) : null);
  } catch {
    // 表未迁移到或写入失败：不阻断模型调用主路径。
  }
}

/** 按 provider 聚合的健康汇总（面板主视图）：近 N 天调用量/成功率/平均延迟/最近失败。 */
export function getProviderCallStats({ days = 7 } = {}) {
  const db = getDb();
  return db.prepare(`
    SELECT
      provider,
      COUNT(*) AS attempts,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS failures,
      ROUND(AVG(CASE WHEN status = 'ok' THEN latency_ms END)) AS avgLatencyMs,
      MAX(CASE WHEN status = 'ok' THEN created_at END) AS lastSuccessAt,
      (SELECT error_detail FROM llm_audit r2 WHERE r2.provider = r1.provider AND r2.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS lastFailureDetail,
      (SELECT created_at FROM llm_audit r2 WHERE r2.provider = r1.provider AND r2.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS lastFailureAt
    FROM llm_audit r1
    WHERE created_at >= datetime('now', ?)
    GROUP BY provider
    ORDER BY attempts DESC
  `).all(`-${Math.max(1, Math.round(days))} days`);
}

/** 最近调用留痕（原始 feed，最多 limit 条），供"详情"展开用。 */
export function getRecentLlmAudits(limit = 20) {
  return getDb()
    .prepare("SELECT * FROM llm_audit ORDER BY id DESC LIMIT ?")
    .all(Math.min(200, Math.max(1, limit)));
}
