-- 019_user_usage（U-4 / E15）：模型调用按用户计量，支撑每日配额与成本视图。
-- 旧记录归 owner 'local'；token/cost 只在 provider 返回 usage 时记录，缺失保持 NULL，
-- 不用字符数伪装精确 token。

ALTER TABLE llm_audit ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
ALTER TABLE llm_audit ADD COLUMN input_tokens INTEGER;
ALTER TABLE llm_audit ADD COLUMN output_tokens INTEGER;
ALTER TABLE llm_audit ADD COLUMN estimated_cost_usd REAL;

CREATE INDEX IF NOT EXISTS idx_llm_audit_user_time ON llm_audit(user_id, created_at);
