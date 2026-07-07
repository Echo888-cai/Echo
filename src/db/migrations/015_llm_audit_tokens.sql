-- 015_llm_audit_tokens: E10 研究成本汇总视图——给 llm_audit 补 token 用量两列。
-- OpenAI 兼容响应体（GLM/DeepSeek/OpenAI 都是）在 usage 字段里真实返回
-- prompt_tokens/completion_tokens，此前 modelGateway.js 解析响应时直接丢弃了。
-- 补上这两列后，"每轮研究的真实成本"才有源头数据——是否折算成美元交给
-- 可选的价格环境变量（未配置就诚实只显示用量，不假设一个可能过期的价格）。
ALTER TABLE llm_audit ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE llm_audit ADD COLUMN completion_tokens INTEGER;
