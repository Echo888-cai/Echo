-- 018_multiuser（U-2 / E13，PLAN v5）：私有数据全部落 user 维度（红线 18：全私有）。
--
-- 分层（PLAN v5 §2 E13）：
--   公共层（不动）：companies / company_details / market_snapshots / hk_financials /
--     cn_financials / web_evidence / earnings_* / comp_peers / insider_activity /
--     hk_buybacks / historical_valuation / scheduler_state / llm_audit / fact_guard_audit
--   私有层（本迁移）：
--     加列        research_sessions / research_snapshots / documents
--     主键重建    portfolio_positions (user_id,ticker) / watchlist_prefs (user_id,ticker) /
--                 company_profiles (user_id,ticker) / portfolio_snapshots (user_id,snapshot_date)
--     已有 user_id（001 就留了口子）：profile_events / watch_rules / notifications → 只补索引
--
-- 存量数据全部归 'local'（= owner 的固定 id，见 017），零数据搬家。
-- SQLite 不能改主键 → 建新表-拷贝-改名三步（红线 9 非破坏性）；migrate.js 整个文件跑在
-- 一个事务里，中途失败自动回滚。research_sessions 只 ADD COLUMN，rowid 不变，
-- FTS5 触发器（013）继续有效。

-- ── 加列 ─────────────────────────────────────────────────────

ALTER TABLE research_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_sessions_user ON research_sessions(user_id, updated_at);

ALTER TABLE research_snapshots ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_research_snapshots_user ON research_snapshots(user_id, ticker, snapshot_date);

ALTER TABLE documents ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, created_at);

-- ── 主键重建：portfolio_positions ────────────────────────────

CREATE TABLE portfolio_positions_new (
  user_id      TEXT NOT NULL DEFAULT 'local',
  ticker       TEXT NOT NULL,
  company_name TEXT,
  shares       REAL,
  avg_cost     REAL,
  stop_loss    REAL,
  take_profit  REAL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ticker)
);
INSERT INTO portfolio_positions_new (user_id, ticker, company_name, shares, avg_cost, stop_loss, take_profit, note, created_at, updated_at)
  SELECT 'local', ticker, company_name, shares, avg_cost, stop_loss, take_profit, note, created_at, updated_at FROM portfolio_positions;
DROP TABLE portfolio_positions;
ALTER TABLE portfolio_positions_new RENAME TO portfolio_positions;

-- ── 主键重建：watchlist_prefs ────────────────────────────────

CREATE TABLE watchlist_prefs_new (
  user_id      TEXT NOT NULL DEFAULT 'local',
  ticker       TEXT NOT NULL,
  company_name TEXT,
  mode         TEXT NOT NULL DEFAULT 'add',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ticker)
);
INSERT INTO watchlist_prefs_new (user_id, ticker, company_name, mode, created_at)
  SELECT 'local', ticker, company_name, mode, created_at FROM watchlist_prefs;
DROP TABLE watchlist_prefs;
ALTER TABLE watchlist_prefs_new RENAME TO watchlist_prefs;

-- ── 主键重建：company_profiles（两个用户可以各自给同一家公司建画像） ──

CREATE TABLE company_profiles_new (
  user_id         TEXT NOT NULL DEFAULT 'local',
  ticker          TEXT NOT NULL,
  company_name    TEXT,
  thesis          TEXT,
  research_status TEXT,
  confidence      TEXT,
  bull_json       TEXT,
  bear_json       TEXT,
  monitors_json   TEXT,
  falsifiers_json TEXT,
  valuation_json  TEXT,
  events_json     TEXT,
  profile_md      TEXT,
  turn_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ticker)
);
INSERT INTO company_profiles_new (user_id, ticker, company_name, thesis, research_status, confidence, bull_json, bear_json, monitors_json, falsifiers_json, valuation_json, events_json, profile_md, turn_count, created_at, updated_at)
  SELECT 'local', ticker, company_name, thesis, research_status, confidence, bull_json, bear_json, monitors_json, falsifiers_json, valuation_json, events_json, profile_md, turn_count, created_at, updated_at FROM company_profiles;
DROP TABLE company_profiles;
ALTER TABLE company_profiles_new RENAME TO company_profiles;

-- ── 主键重建：portfolio_snapshots（每人一条净值曲线） ─────────

CREATE TABLE portfolio_snapshots_new (
  user_id         TEXT NOT NULL DEFAULT 'local',
  snapshot_date   TEXT NOT NULL,
  total_value_usd REAL,
  total_cost_usd  REAL,
  total_pnl_usd   REAL,
  position_count  INTEGER NOT NULL,
  totals_json     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, snapshot_date)
);
INSERT INTO portfolio_snapshots_new (user_id, snapshot_date, total_value_usd, total_cost_usd, total_pnl_usd, position_count, totals_json, created_at)
  SELECT 'local', snapshot_date, total_value_usd, total_cost_usd, total_pnl_usd, position_count, totals_json, created_at FROM portfolio_snapshots;
DROP TABLE portfolio_snapshots;
ALTER TABLE portfolio_snapshots_new RENAME TO portfolio_snapshots;

-- ── 已有 user_id 的表：补查询索引 ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profile_events_user ON profile_events(user_id, ticker, id);
CREATE INDEX IF NOT EXISTS idx_watch_rules_user ON watch_rules(user_id, active, ticker);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
