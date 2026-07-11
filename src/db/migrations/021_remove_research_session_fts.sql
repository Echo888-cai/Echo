-- 历史研究搜索已下线：删除 FTS 索引和触发器，避免每次保存会话仍维护未使用的副本。
DROP TRIGGER IF EXISTS research_sessions_fts_ai;
DROP TRIGGER IF EXISTS research_sessions_fts_ad;
DROP TRIGGER IF EXISTS research_sessions_fts_au;
DROP TABLE IF EXISTS research_sessions_fts;
