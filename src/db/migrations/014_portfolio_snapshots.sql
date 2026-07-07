-- 014_portfolio_snapshots: M-1 每日组合快照（净值曲线数据源 + 数据护城河自沉淀序列，PLAN v4 E9）。
-- 一天一行，snapshot_date 做主键：scheduler 每天补写一次，同一天重复运行走 upsert 覆盖
-- （不追加重复行），进程重启/misfire 补跑都是幂等的。
-- total_*_usd 是跨币种近似折算（USD≈7.8HKD，与 portfolioReview.js 组合体检用同一常量），
-- 仅供净值曲线与概览横幅展示，不是交易口径（PLAN v4 红线 11/15 的延伸：近似必须标注、
-- 净值曲线不插值不回填——没跑快照的那天就是断口，不用相邻两天的值内插）。
-- totals_json 保留分币种明细（未折算），供未来展开明细用，不在本阶段的 UI 里展开。
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  snapshot_date TEXT PRIMARY KEY,
  total_value_usd REAL,
  total_cost_usd REAL,
  total_pnl_usd REAL,
  position_count INTEGER NOT NULL,
  totals_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
