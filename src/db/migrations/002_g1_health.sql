-- 002_g1_health: G-1 数据可信度底座——真实数据 canary 落库 + 港股一手财报摄取留痕。
-- 两张表都是"观测层"，不参与研究链路的读路径，纯供健康面板/覆盖率统计查询。

-- 每次 `npm run canary` 一批（batch_id = 运行时间戳），每个 (source, ticker) 一行结果。
CREATE TABLE IF NOT EXISTS canary_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT NOT NULL,
  source      TEXT NOT NULL,
  ticker      TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT,
  latency_ms  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canary_batch ON canary_runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_canary_source ON canary_runs(source, created_at);

-- 港股一手财报（HKEX PDF）摄取尝试留痕：无论触发方式（研究请求后台补摄取 /
-- 手动 API / npm run hk-coverage 增量扫描），每次尝试都 upsert 一行，取代此前
-- refreshHkFinancialsInBackground 的纯 console 静默失败（E2/E3）。
CREATE TABLE IF NOT EXISTS hk_filing_ingest_log (
  ticker               TEXT PRIMARY KEY,
  status               TEXT NOT NULL,
  detail               TEXT,
  announcements_found  INTEGER NOT NULL DEFAULT 0,
  ingested_count       INTEGER NOT NULL DEFAULT 0,
  checked_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
