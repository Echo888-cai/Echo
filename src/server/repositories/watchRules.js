/**
 * watchRules repository — 证伪监控规则（UX-7 研究→监控闭环的持久层）。
 *
 * 规则从哪来：每轮研究后，画像里的证伪条件文本（falsifiers）经
 * services/falsifyRules.js 保守解析，凡是"明确的价格条件"（跌破 90 美元 /
 * 股价低于 300）就落成一条可自动核对的规则；叙述性条件（"云增速连续两季<20%"）
 * 不解析，仍以文本形式留在画像里。
 *
 * F-3：基本面条件（kind=fundamental_below/above）不再靠事后文本解析——模型研究时
 * 直接结构化输出（见 chatOrchestrator.js 的 extractStructuredFalsifiers），这里
 * 跟价格规则存进同一张表，多一个 metric 列标注对应哪个财务指标（价格规则该列为 null）。
 *
 * source='falsifier' 的规则每轮研究后整组重建（幂等）；未来手动规则用别的 source。
 */

import { getDb } from "../../db/index.js";

/** 某 ticker 的活跃规则。 */
export function listRules(ticker) {
  return getDb()
    .prepare("SELECT * FROM watch_rules WHERE ticker = ? AND active = 1 ORDER BY id")
    .all(String(ticker || "").toUpperCase())
    .map(hydrate);
}

/** 全部活跃规则（巡检任务用）。 */
export function listAllActiveRules() {
  return getDb().prepare("SELECT * FROM watch_rules WHERE active = 1 ORDER BY ticker, id").all().map(hydrate);
}

/**
 * 用最新一轮解析结果整组重建该 ticker 的 falsifier 规则（幂等：先删后插）。
 * 只动 source='falsifier'，不碰未来的手动规则。
 */
export function replaceFalsifierRules(ticker, rules = [], { sessionId = null } = {}) {
  const t = String(ticker || "").toUpperCase();
  if (!t) return 0;
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM watch_rules WHERE ticker = ? AND source = 'falsifier'").run(t);
    const ins = db.prepare(`
      INSERT INTO watch_rules (ticker, kind, threshold, label, metric, source, session_id)
      VALUES (?, ?, ?, ?, ?, 'falsifier', ?)
    `);
    for (const r of rules) ins.run(t, r.kind, r.threshold, String(r.label || "").slice(0, 300), r.metric || null, sessionId);
    return rules.length;
  });
  return run();
}

export function markTriggered(id) {
  getDb().prepare("UPDATE watch_rules SET last_triggered_at = datetime('now') WHERE id = ?").run(Number(id));
}

function hydrate(row) {
  return {
    id: row.id,
    ticker: row.ticker,
    kind: row.kind,
    threshold: row.threshold,
    label: row.label || "",
    metric: row.metric || null,
    source: row.source,
    sessionId: row.session_id || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at || null
  };
}
