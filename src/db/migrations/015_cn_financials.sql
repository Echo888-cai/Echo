-- 015_cn_financials: A股一手财报底座——巨潮资讯网公告摄取落库 + 摄取留痕，
-- 结构照抄 hk_financials/hk_filing_ingest_log（同一套"观测层"约定），
-- 但 CN 财报几乎全是 CNY 原币种，不需要 HK 那套 CNY→HKD 换算层。

CREATE TABLE IF NOT EXISTS cn_financials (
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
CREATE INDEX IF NOT EXISTS idx_cn_financials_ticker ON cn_financials(ticker, period_end);

-- A 股一手财报（巨潮资讯网公告）摄取尝试留痕，同 hk_filing_ingest_log 的角色，
-- 供 scripts/cn-coverage.js 增量扫描 + 健康面板覆盖率统计用。
CREATE TABLE IF NOT EXISTS cn_filing_ingest_log (
  ticker               TEXT PRIMARY KEY,
  status               TEXT NOT NULL,
  detail               TEXT,
  announcements_found  INTEGER NOT NULL DEFAULT 0,
  ingested_count       INTEGER NOT NULL DEFAULT 0,
  checked_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
