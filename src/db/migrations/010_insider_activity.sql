-- 010_insider_activity: F-4a 股东回报供数（美股先行）——SEC EDGAR Form 4 内部人交易
-- 汇总缓存。一行 = 一只 ticker 最近一次拉取的内部人交易汇总（近 180 天窗口，只统计
-- 真实公开市场买卖 P/S 代码，不含期权行权/税务代扣等薪酬性交易），24h TTL 读穿透。

CREATE TABLE IF NOT EXISTS insider_activity (
  ticker              TEXT PRIMARY KEY,
  provider_status     TEXT NOT NULL DEFAULT 'missing',
  net_shares          INTEGER,
  net_value_usd       REAL,
  buy_count           INTEGER,
  sell_count          INTEGER,
  distinct_insiders   INTEGER,
  last_transaction_at TEXT,
  transactions_json   TEXT,
  detail              TEXT,
  fetched_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
