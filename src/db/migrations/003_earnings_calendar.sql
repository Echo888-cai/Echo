-- 003_earnings_calendar: G-2 财报日历读穿透缓存（24h TTL，见 earningsCalendar.js）。
-- 一行 = 一只 ticker 的"下一业绩日"最新已知状态；不做历史序列，只关心"下一次是什么时候"。

CREATE TABLE IF NOT EXISTS earnings_calendar (
  ticker            TEXT PRIMARY KEY,
  next_date         TEXT,
  quarter           INTEGER,
  year              INTEGER,
  eps_estimate      REAL,
  revenue_estimate  REAL,
  source            TEXT,
  provider_status   TEXT NOT NULL DEFAULT 'missing',
  detail            TEXT,
  fetched_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
