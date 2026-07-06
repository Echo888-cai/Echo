-- 006_research_snapshots: R7 研究记分卡/自动复盘——Phase A 数据沉淀。
-- 一行 = 一次"判断快照"（建档 / 判断变化 / 证伪线演进，跟 profile_events 同一批触发点，
-- 不做流水账），记录当时的估值带、价格在带内的相对位置与证伪条件，供以后核对
-- "当时说了什么 vs 后来实际发生了什么"。纯观测层，不参与研究链路读路径。
--
-- valuation_position 刻意不是"看多/看空"这类主观评级（宪法第 4 条：不给买卖指令）——
-- 只记录"当时价格相对我们自己算的估值带在哪"这一客观几何关系：'below_base'（低于
-- 估值中枢）/ 'above_base'（高于中枢）/ 'at_base'（等于中枢）/ NULL（无估值数据）。

CREATE TABLE IF NOT EXISTS research_snapshots (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker              TEXT NOT NULL,
  snapshot_date       TEXT NOT NULL,
  thesis              TEXT,
  valuation_position  TEXT,           -- 'below_base' | 'above_base' | 'at_base' | NULL
  valuation_bear      REAL,
  valuation_base      REAL,
  valuation_bull      REAL,
  valuation_currency  TEXT,
  price_at_snapshot   REAL,
  falsifiers_json     TEXT,           -- 当时的证伪条件文本清单（可核对是否后来被触发）
  session_id          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_snapshots_ticker ON research_snapshots(ticker, snapshot_date);
