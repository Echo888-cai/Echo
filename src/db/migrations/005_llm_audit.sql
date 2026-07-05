-- 005_llm_audit: E4 模型网关调用留痕——取代此前 modelGateway.js 纯 console 的运维盲区。
-- 一行 = 一次 provider 尝试（GLM→DeepSeek→OpenAI failover 链路里的每一跳都记一行，
-- 不是只记最终成功的那次），这样才能看清"谁在接、各自延迟/失败率、慢答该怪模型
-- 还是数据管道"。观测层，不参与研究链路读路径。

CREATE TABLE IF NOT EXISTS llm_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,
  model         TEXT,
  kind          TEXT NOT NULL DEFAULT 'chat',
  status        TEXT NOT NULL,
  latency_ms    INTEGER,
  error_detail  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_audit_provider ON llm_audit(provider, created_at);
