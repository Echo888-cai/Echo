-- 001_init: 全部 14 张表的当前形态一次性建库（D2：ensureTable 散装迁移收敛进版本化迁移器）。
-- 无历史数据需要兼容，直接落"当前最终形态"（含此前靠运行时 ALTER TABLE 补的列），
-- 不再需要分步 ALTER。今后新迁移从 002 开始，只增不改这个文件。

CREATE TABLE IF NOT EXISTS companies (
  ticker              TEXT PRIMARY KEY,
  name_zh             TEXT NOT NULL,
  name_en             TEXT,
  sector              TEXT,
  industry            TEXT,
  listing_status      TEXT NOT NULL DEFAULT 'active',
  exchange            TEXT NOT NULL DEFAULT 'HKEX',
  currency            TEXT NOT NULL DEFAULT 'HKD',
  market_cap_category TEXT,
  is_hsi              INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_details (
  ticker            TEXT PRIMARY KEY,
  aliases           TEXT,
  price             REAL,
  market_cap        TEXT,
  week_52_range     TEXT,
  dividend_yield    TEXT,
  pe                TEXT,
  pb                TEXT,
  ps                TEXT,
  latest_report     TEXT,
  status            TEXT,
  status_tone       TEXT,
  summary           TEXT,
  business_model    TEXT,
  metrics           TEXT,
  moat              TEXT,
  management        TEXT,
  risks             TEXT,
  bull_case         TEXT,
  bear_case         TEXT,
  monitors          TEXT,
  official_sources  TEXT,
  FOREIGN KEY (ticker) REFERENCES companies(ticker)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT NOT NULL,
  price           REAL,
  previous_close  REAL,
  change          REAL,
  change_percent  REAL,
  open            REAL,
  high            REAL,
  low             REAL,
  volume          INTEGER,
  market_cap      REAL,
  pe              REAL,
  dividend_yield  REAL,
  week_52_high    REAL,
  week_52_low     REAL,
  source          TEXT,
  as_of           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticker) REFERENCES companies(ticker)
);
CREATE INDEX IF NOT EXISTS idx_market_ticker ON market_snapshots(ticker);
CREATE INDEX IF NOT EXISTS idx_market_as_of ON market_snapshots(as_of);

CREATE TABLE IF NOT EXISTS research_sessions (
  id              TEXT PRIMARY KEY,
  ticker          TEXT,
  title           TEXT,
  question        TEXT,
  conversation_id TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  report_markdown TEXT,
  rating          TEXT,
  confidence      TEXT,
  decision_panel  TEXT,
  full_research   TEXT,
  data_sources    TEXT,
  thread_json     TEXT,
  turn_count      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticker) REFERENCES companies(ticker)
);
CREATE INDEX IF NOT EXISTS idx_sessions_ticker ON research_sessions(ticker);

CREATE TABLE IF NOT EXISTS company_profiles (
  ticker          TEXT PRIMARY KEY,
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
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profile_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker        TEXT NOT NULL,
  date          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  summary       TEXT NOT NULL,
  rationale     TEXT,
  evidence_json TEXT,
  session_id    TEXT,
  user_id       TEXT NOT NULL DEFAULT 'local',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profile_events_ticker ON profile_events(ticker, id);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  ticker       TEXT PRIMARY KEY,
  company_name TEXT,
  shares       REAL,
  avg_cost     REAL,
  stop_loss    REAL,
  take_profit  REAL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL DEFAULT 'local',
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  ticker      TEXT,
  payload     TEXT,
  dedupe_key  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(dedupe_key, created_at);

CREATE TABLE IF NOT EXISTS hk_financials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  period_label TEXT,
  period_end TEXT,
  period_type TEXT,
  currency TEXT,
  unit_label TEXT,
  revenue REAL,
  revenue_prior REAL,
  gross_profit REAL,
  gross_profit_prior REAL,
  operating_income REAL,
  operating_income_prior REAL,
  net_income REAL,
  net_income_prior REAL,
  net_income_attributable REAL,
  eps REAL,
  operating_cash_flow REAL,
  cash_and_equivalents REAL,
  net_cash REAL,
  source_title TEXT,
  source_url TEXT UNIQUE,
  published_at TEXT,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_financials_ticker ON hk_financials(ticker, period_end);

CREATE TABLE IF NOT EXISTS scheduler_state (
  job_id       TEXT PRIMARY KEY,
  last_run_at  TEXT,
  last_status  TEXT,
  last_detail  TEXT
);

CREATE TABLE IF NOT EXISTS web_evidence (
  id                TEXT PRIMARY KEY,
  ticker            TEXT NOT NULL,
  intent            TEXT NOT NULL,
  query             TEXT,
  title             TEXT,
  url               TEXT NOT NULL,
  source            TEXT,
  source_type       TEXT,
  snippet           TEXT,
  published_at      TEXT,
  fetched_at        TEXT NOT NULL,
  relevance_score   REAL,
  credibility_score REAL,
  content_hash      TEXT,
  raw_json          TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_web_evidence_ticker_intent ON web_evidence(ticker, intent);
CREATE INDEX IF NOT EXISTS idx_web_evidence_url ON web_evidence(url);
CREATE INDEX IF NOT EXISTS idx_web_evidence_fetched_at ON web_evidence(fetched_at);

CREATE TABLE IF NOT EXISTS watchlist_prefs (
  ticker       TEXT PRIMARY KEY,
  company_name TEXT,
  mode         TEXT NOT NULL DEFAULT 'add',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL DEFAULT 'local',
  ticker            TEXT NOT NULL,
  kind              TEXT NOT NULL,
  threshold         REAL NOT NULL,
  label             TEXT,
  source            TEXT NOT NULL DEFAULT 'falsifier',
  session_id        TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_triggered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_watch_rules_ticker ON watch_rules(ticker, active);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  ticker TEXT,
  name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  parser TEXT,
  text TEXT,
  summary TEXT,
  source_type TEXT NOT NULL DEFAULT 'upload',
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
