-- 012_hk_buybacks: F-4b 股东回报供数（港股）——HKEX 翌日披露报表（FF305 表格）里的
-- "购回报告"部分。一行 = 一份披露公告（=一个交易日的真实购回）：购回股数、价格区间、
-- 总代价，以及同一份公告里"已发行股份（不包括库存股份）"期末结存数，用于粗略股本趋势
-- （HKEX 规则下购回股份注销有滞后，这里只是"已发行股份数在各次披露间的变化"这条粗线，
-- 不等于"即时净购回股数"，事实块必须诚实标注这条限制）。source_url 唯一约束防重复摄取。

CREATE TABLE IF NOT EXISTS hk_buybacks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker              TEXT NOT NULL,
  trade_date          TEXT,
  shares_repurchased  INTEGER,
  price_high          REAL,
  price_low           REAL,
  total_consideration REAL,
  currency            TEXT,
  shares_issued_total INTEGER,
  period_end_date     TEXT,
  source_title        TEXT,
  source_url          TEXT UNIQUE,
  published_at        TEXT,
  fetched_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hk_buybacks_ticker_date ON hk_buybacks(ticker, trade_date);
