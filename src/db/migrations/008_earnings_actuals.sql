-- 008_earnings_actuals: F-2 业绩闭环——`earnings_calendar` 此前只存"下一次业绩日"的预期
-- 数字，没有任何字段记录"财报来了之后，实际数字跟预期比怎么样"。研究桌的第一问
-- "现在到底有没有预期差"因此从不被事后核对。这里给同一行 ticker 追加"最近一次已报告
-- 季度"的实际值与惊喜幅度——不新开一张历史表，因为当前只需要"最近一次"，用于业绩后
-- 触发一次性提醒 + 复盘联动；更早的历史季度不追踪（如需要，属于后续按真实需求再加）。

ALTER TABLE earnings_calendar ADD COLUMN last_date TEXT;
ALTER TABLE earnings_calendar ADD COLUMN last_quarter INTEGER;
ALTER TABLE earnings_calendar ADD COLUMN last_year INTEGER;
ALTER TABLE earnings_calendar ADD COLUMN last_eps_estimate REAL;
ALTER TABLE earnings_calendar ADD COLUMN last_eps_actual REAL;
ALTER TABLE earnings_calendar ADD COLUMN last_revenue_estimate REAL;
ALTER TABLE earnings_calendar ADD COLUMN last_revenue_actual REAL;
ALTER TABLE earnings_calendar ADD COLUMN last_eps_surprise_pct REAL;
ALTER TABLE earnings_calendar ADD COLUMN last_revenue_surprise_pct REAL;
