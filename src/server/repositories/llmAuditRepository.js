/**
 * llmAuditRepository — 模型网关调用留痕（E4）。
 *
 * 一行 = 一次 provider 尝试（含 failover 链路里被跳过前失败的那几跳），供设置页
 * "模型调用"面板查询：谁在接、各自延迟/失败率、最近一次失败原因是什么。
 */

import { getDb } from "../../db/index.js";

/** 落一行调用留痕。永远不抛错——审计失败不该影响研究主流程。 */
export function insertLlmAudit({ provider, model = null, kind = "chat", status, latencyMs = null, errorDetail = null, promptTokens = null, completionTokens = null }) {
  try {
    getDb().prepare(`
      INSERT INTO llm_audit (provider, model, kind, status, latency_ms, error_detail, prompt_tokens, completion_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(provider || "unknown"), model, kind, String(status || "error"), latencyMs, errorDetail ? String(errorDetail).slice(0, 500) : null, promptTokens, completionTokens);
  } catch {
    // 表未迁移到或写入失败：不阻断模型调用主路径。
  }
}

/**
 * E10：按配置的价格环境变量估算成本，未配置就诚实返回 null（不猜一个可能过期/错误的价格）。
 * 环境变量命名：LLM_PRICE_<PROVIDER>_INPUT / _OUTPUT，单位 USD / 1M tokens——
 * provider 各家账单粒度都是按百万 token 报价，用同一单位方便用户直接抄账单上的数字。
 */
function estimateCostUsd(provider, promptTokens, completionTokens) {
  const key = String(provider || "").toUpperCase();
  const inputPrice = Number(process.env[`LLM_PRICE_${key}_INPUT`]);
  const outputPrice = Number(process.env[`LLM_PRICE_${key}_OUTPUT`]);
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
  return (promptTokens / 1e6) * inputPrice + (completionTokens / 1e6) * outputPrice;
}

/**
 * 按 provider 聚合的健康汇总（面板主视图）：近 N 天调用量/成功率/平均延迟/最近失败 +
 * token 用量与估算成本（E10；价格未配置时 estimatedCostUsd 为 null，前端诚实显示"未配置计价"）。
 */
export function getProviderCallStats({ days = 7 } = {}) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      provider,
      COUNT(*) AS attempts,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS failures,
      ROUND(AVG(CASE WHEN status = 'ok' THEN latency_ms END)) AS avgLatencyMs,
      MAX(CASE WHEN status = 'ok' THEN created_at END) AS lastSuccessAt,
      SUM(prompt_tokens) AS promptTokens,
      SUM(completion_tokens) AS completionTokens,
      (SELECT error_detail FROM llm_audit r2 WHERE r2.provider = r1.provider AND r2.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS lastFailureDetail,
      (SELECT created_at FROM llm_audit r2 WHERE r2.provider = r1.provider AND r2.status != 'ok' ORDER BY created_at DESC LIMIT 1) AS lastFailureAt
    FROM llm_audit r1
    WHERE created_at >= datetime('now', ?)
    GROUP BY provider
    ORDER BY attempts DESC
  `).all(`-${Math.max(1, Math.round(days))} days`);
  return rows.map((r) => ({
    ...r,
    promptTokens: r.promptTokens || 0,
    completionTokens: r.completionTokens || 0,
    estimatedCostUsd: estimateCostUsd(r.provider, r.promptTokens || 0, r.completionTokens || 0)
  }));
}

/** 最近调用留痕（原始 feed，最多 limit 条），供"详情"展开用。 */
export function getRecentLlmAudits(limit = 20) {
  return getDb()
    .prepare("SELECT * FROM llm_audit ORDER BY id DESC LIMIT ?")
    .all(Math.min(200, Math.max(1, limit)));
}
