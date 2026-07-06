-- 009_watch_rules_metric: F-3 基本面证伪条件——`watch_rules` 此前只装得下价格类规则
-- （kind=price_below/price_above，阈值单位天然是"价格"）。基本面规则（"毛利率跌破 40%"）
-- 需要知道阈值对应哪个财务指标才能核对，追加 metric 列（price 类规则该列恒为 NULL，
-- 不影响既有查询）。

ALTER TABLE watch_rules ADD COLUMN metric TEXT;
