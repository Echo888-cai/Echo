/**
 * llmAuditRepository — 模型网关调用留痕（E4）。
 *
 * 一行 = 一次 provider 尝试（含 failover 链路里被跳过前失败的那几跳），供设置页
 * "模型调用"面板查询：谁在接、各自延迟/失败率、最近一次失败原因是什么。
 */

import { getDb } from "../../db/index.js";

/** 落一行调用留痕。永远不抛错——审计失败不该影响研究主流程。 */
export function insertLlmAudit({ provider, model = null, kind = "chat", status, latencyMs = null, errorDetail = null, userId = "local", inputTokens = null, outputTokens = null, estimatedCostUsd = null }) {
  try {
    getDb().prepare(`
      INSERT INTO llm_audit (provider, model, kind, status, latency_ms, error_detail, user_id, input_tokens, output_tokens, estimated_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(provider || "unknown"), model, kind, String(status || "error"), latencyMs, errorDetail ? String(errorDetail).slice(0, 500) : null, userId, inputTokens, outputTokens, estimatedCostUsd);
  } catch {
    // 表未迁移到或写入失败：不阻断模型调用主路径。
  }
}

/** 按 provider 聚合的健康汇总（面板主视图）：近 N 天调用量/成功率/平均延迟/最近失败。 */
export function getProviderCallStats({ days = 7, userId = "local" } = {}) {
  const db = getDb();
  return db.prepare(`
    SELECT
      provider,
      COUNT(*) AS attempts,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS failures,
      ROUND(AVG(CASE WHEN status = 'ok' THEN latency_ms END)) AS avgLatencyMs,
      MAX(CASE WHEN status = 'ok' THEN created_at END) AS lastSuccessAt,
      SUM(COALESCE(input_tokens, 0)) AS inputTokens,
      SUM(COALESCE(output_tokens, 0)) AS outputTokens,
      ROUND(SUM(COALESCE(estimated_cost_usd, 0)), 6) AS estimatedCostUsd,
      (SELECT error_detail FROM llm_audit r2 WHERE r2.user_id = @userId AND r2.provider = r1.provider AND r2.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS lastFailureDetail,
      (SELECT created_at FROM llm_audit r2 WHERE r2.user_id = @userId AND r2.provider = r1.provider AND r2.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS lastFailureAt
    FROM llm_audit r1
    WHERE user_id = @userId AND created_at >= datetime('now', @window)
    GROUP BY provider
    ORDER BY attempts DESC
  `).all({ userId, window: `-${Math.max(1, Math.round(days))} days` });
}

/** 当前北京时间自然日的用户用量。 */
export function getUserDailyUsage(userId = "local") {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS attempts,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS successfulCalls,
      SUM(COALESCE(input_tokens, 0)) AS inputTokens,
      SUM(COALESCE(output_tokens, 0)) AS outputTokens,
      ROUND(SUM(COALESCE(estimated_cost_usd, 0)), 6) AS estimatedCostUsd
    FROM llm_audit
    WHERE user_id = ?
      AND created_at >= datetime('now', '+8 hours', 'start of day', '-8 hours')
  `).get(userId);
  return {
    attempts: Number(row?.attempts || 0),
    successfulCalls: Number(row?.successfulCalls || 0),
    inputTokens: Number(row?.inputTokens || 0),
    outputTokens: Number(row?.outputTokens || 0),
    estimatedCostUsd: Number(row?.estimatedCostUsd || 0)
  };
}

/** 最近调用留痕（原始 feed，最多 limit 条），供"详情"展开用。 */
export function getRecentLlmAudits(limit = 20, userId = "local") {
  return getDb()
    .prepare("SELECT * FROM llm_audit WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, Math.min(200, Math.max(1, limit)));
}
