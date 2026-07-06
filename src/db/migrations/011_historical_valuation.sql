-- 011_historical_valuation: F-5 历史估值分位（近似口径，US 先行，港股经 ADR 映射）。
-- 一行 = 一只 ticker 最近一次拉取的 Finnhub 年度 PE 序列（逐年财年末快照，非逐日分布），
-- 24h TTL 读穿透缓存——年度数据几乎不变，缓存收益最大；当前 PE 与百分位不缓存在这张表里，
-- 每次调用用调用方传入的实时 PE 现算，避免"缓存了24小时前的百分位"这种隐藏陈旧。

CREATE TABLE IF NOT EXISTS historical_valuation (
  ticker          TEXT PRIMARY KEY,
  provider_status TEXT NOT NULL DEFAULT 'missing',
  series_json     TEXT,
  detail          TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
