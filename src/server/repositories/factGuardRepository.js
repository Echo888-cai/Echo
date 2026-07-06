/**
 * factGuardRepository — F-1 factGuard 命中留痕（PLAN v3）。
 *
 * 一行 = 一次 verifyAnswerNumbers 校验结果，供设置页"防幻觉护栏"面板查询真实误报率。
 * shadow 模式下用户看不到任何变化，但这张表让"观察期"第一次有数据可看——升档到 soft/full
 * 必须以这里的真实命中率为依据（红线 10），不再靠人工翻 console 历史。
 */

import { getDb } from "../../db/index.js";

/** 落一行校验留痕。永远不抛错——审计失败不该影响研究主流程。 */
export function insertFactGuardAudit({ ticker, mode, summary }) {
  try {
    getDb().prepare(`
      INSERT INTO fact_guard_audit (ticker, mode, total, pass_count, soft_count, hard_count, hard_details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticker ? String(ticker) : null,
      String(mode || "shadow"),
      Number(summary?.total) || 0,
      Number(summary?.pass) || 0,
      Number(summary?.soft) || 0,
      Number(summary?.hard) || 0,
      summary?.hardDetails?.length ? JSON.stringify(summary.hardDetails).slice(0, 2000) : null
    );
  } catch {
    // 表未迁移到或写入失败：不阻断研究主路径。
  }
}

/**
 * 近 N 天的整体命中率汇总——升档决策的主视图。
 * hardRate/softRate 按"校验总数"而不是"回答数"算，跟 factGuard 本身的判定粒度一致。
 */
export function getFactGuardStats({ days = 14 } = {}) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS runs,
      COALESCE(SUM(total), 0) AS totalChecks,
      COALESCE(SUM(pass_count), 0) AS totalPass,
      COALESCE(SUM(soft_count), 0) AS totalSoft,
      COALESCE(SUM(hard_count), 0) AS totalHard,
      SUM(CASE WHEN hard_count > 0 THEN 1 ELSE 0 END) AS runsWithHard,
      MIN(created_at) AS firstAt,
      MAX(created_at) AS lastAt
    FROM fact_guard_audit
    WHERE created_at >= datetime('now', ?)
  `).get(`-${Math.max(1, Math.round(days))} days`);
  const totalChecks = row?.totalChecks || 0;
  return {
    runs: row?.runs || 0,
    totalChecks,
    hardRate: totalChecks ? Math.round(((row.totalHard || 0) / totalChecks) * 1000) / 10 : null,
    softRate: totalChecks ? Math.round(((row.totalSoft || 0) / totalChecks) * 1000) / 10 : null,
    runsWithHard: row?.runsWithHard || 0,
    firstAt: row?.firstAt || null,
    lastAt: row?.lastAt || null
  };
}

/** 最近命中过 hard 的原始记录（最多 limit 条），供人工复盘误报类别用。 */
export function getRecentHardFails(limit = 20) {
  return getDb()
    .prepare("SELECT * FROM fact_guard_audit WHERE hard_count > 0 ORDER BY id DESC LIMIT ?")
    .all(Math.min(200, Math.max(1, limit)));
}
