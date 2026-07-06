-- 013_research_sessions_fts: P7 研究历史全文检索。
-- external content FTS5 虚拟表，索引 research_sessions 的 title/question/report_markdown/
-- thread_json（完整对话内容）。用触发器保持索引与主表同步——researchSessions.js 里现有的
-- upsert（INSERT ... ON CONFLICT DO UPDATE）/delete 代码完全不用改动，触发器自动接管。
-- tokenize='trigram'：中文没有空格分词，unicode61 默认分词器切不出中文词；trigram（3字符
-- 滑动窗口子串索引）不依赖分词就能支持中文子串搜索，SQLite 3.34+ 内置，better-sqlite3 已验证
-- 支持（3.53.2）。代价是查询串短于 3 个字符时匹配不到——前端搜索框对此有提示。

CREATE VIRTUAL TABLE IF NOT EXISTS research_sessions_fts USING fts5(
  title, question, report_markdown, thread_json,
  content='research_sessions', content_rowid='rowid',
  tokenize='trigram'
);

-- 建表时一次性回填已有数据（迁移只跑一次，不会重复回填）。
INSERT INTO research_sessions_fts(rowid, title, question, report_markdown, thread_json)
SELECT rowid, title, question, report_markdown, thread_json FROM research_sessions;

CREATE TRIGGER IF NOT EXISTS research_sessions_fts_ai AFTER INSERT ON research_sessions BEGIN
  INSERT INTO research_sessions_fts(rowid, title, question, report_markdown, thread_json)
  VALUES (new.rowid, new.title, new.question, new.report_markdown, new.thread_json);
END;

CREATE TRIGGER IF NOT EXISTS research_sessions_fts_ad AFTER DELETE ON research_sessions BEGIN
  INSERT INTO research_sessions_fts(research_sessions_fts, rowid, title, question, report_markdown, thread_json)
  VALUES ('delete', old.rowid, old.title, old.question, old.report_markdown, old.thread_json);
END;

CREATE TRIGGER IF NOT EXISTS research_sessions_fts_au AFTER UPDATE ON research_sessions BEGIN
  INSERT INTO research_sessions_fts(research_sessions_fts, rowid, title, question, report_markdown, thread_json)
  VALUES ('delete', old.rowid, old.title, old.question, old.report_markdown, old.thread_json);
  INSERT INTO research_sessions_fts(rowid, title, question, report_markdown, thread_json)
  VALUES (new.rowid, new.title, new.question, new.report_markdown, new.thread_json);
END;
