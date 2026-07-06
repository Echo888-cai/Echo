-- 007_fact_guard_audit: F-1 factGuard 升档路径——取代此前 factGuard 命中只打 console.log
-- 的观测盲区（`chatOrchestrator.js` 的 `applyFactGuard`）。一行 = 一次校验（一次模型回答的
-- 一轮 verifyAnswerNumbers），落库后才能统计真实误报率，为 shadow→soft→full 的升档提供依据
-- （PLAN v3 红线 10：升档必须以落库的真实误报率为依据，不许拍脑袋直接开 full）。

CREATE TABLE IF NOT EXISTS fact_guard_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker        TEXT,
  mode          TEXT NOT NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  pass_count    INTEGER NOT NULL DEFAULT 0,
  soft_count    INTEGER NOT NULL DEFAULT 0,
  hard_count    INTEGER NOT NULL DEFAULT 0,
  hard_details  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fact_guard_audit_created ON fact_guard_audit(created_at);
