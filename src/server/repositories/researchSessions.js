/**
 * research_sessions repository — persists /api/agent output to SQLite.
 *
 * The schema (in src/db/index.js) has columns: id, ticker, question, status,
 * report_markdown, rating, confidence, created_at, updated_at. For Phase-1
 * reliability, we additionally serialize the full decisionPanel + fullResearch
 * + dataSources into a JSON column when available, and we set `status` to
 * one of: draft | completed | error.
 */

import { getDb } from "../../db/index.js";
import { randomUUID } from "node:crypto";
import { detectMarket } from "../../market.js";

/**
 * Ensure a minimal companies row exists so the research_sessions FK is satisfied.
 * US (and any not-yet-seeded) tickers aren't in the seed DB — without this, saving
 * their session fails with "FOREIGN KEY constraint failed" and the research is lost.
 */
function ensureCompanyRow(db, ticker, name) {
  if (!ticker) return;
  try {
    const us = detectMarket(ticker) === "US";
    db.prepare(
      `INSERT OR IGNORE INTO companies (ticker, name_zh, name_en, exchange, currency, listing_status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    ).run(ticker, name || ticker, us ? name || ticker : null, us ? "US" : "HKEX", us ? "USD" : "HKD");
  } catch {
    // best effort — never block persistence on this
  }
}

const SCHEMA = {
  id: "TEXT PRIMARY KEY",
  ticker: "TEXT",
  title: "TEXT",
  question: "TEXT",
  conversation_id: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'draft'",
  report_markdown: "TEXT",
  rating: "TEXT",
  confidence: "TEXT",
  decision_panel: "TEXT",
  full_research: "TEXT",
  data_sources: "TEXT",
  thread_json: "TEXT",
  turn_count: "INTEGER",
  created_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
  updated_at: "TEXT NOT NULL DEFAULT (datetime('now'))"
};

let ensured = false;
function ensureColumns() {
  if (ensured) return;
  const db = getDb();
  const cols = new Set(db.prepare("PRAGMA table_info(research_sessions)").all().map((c) => c.name));
  for (const [name, def] of Object.entries(SCHEMA)) {
    if (!cols.has(name)) {
      try {
        db.exec(`ALTER TABLE research_sessions ADD COLUMN ${name} ${def.replace("PRIMARY KEY", "").trim()}`);
      } catch {
        // ignore: column already exists or alter failed for other reasons
      }
    }
  }
  ensured = true;
}

/**
 * Persist one research session. Accepts a payload shaped like:
 *   { id?, ticker, question, status?, decisionPanel, fullResearch, dataSources, reportMarkdown?, rating?, confidence? }
 */
export function saveResearchSession(payload) {
  if (!payload?.ticker) throw new Error("research_sessions 需要 ticker");
  ensureColumns();
  const db = getDb();
  ensureCompanyRow(db, payload.ticker, payload.companyName || payload.title);
  const id = payload.id || payload.sessionId || `s_${randomUUID()}`;
  const thread = Array.isArray(payload.thread) ? payload.thread.slice(-80) : null;
  // EA-5.1：会话分组。首次落库的会话若未指定 conversationId，自成一组（= 自身 id）；
  // 同一对话内切公司时前端会把稳定的 conversationId 带过来，新行加入同一组。已入组的
  // 行不会被后续更新覆盖分组（COALESCE 保底），换句话说分组一旦落定就不会被悄悄改写。
  const stmt = db.prepare(`
    INSERT INTO research_sessions
      (id, ticker, title, question, conversation_id, status, report_markdown, rating, confidence, decision_panel, full_research, data_sources, thread_json, turn_count, updated_at)
    VALUES
      (@id, @ticker, @title, @question, @conversationId, @status, @reportMarkdown, @rating, @confidence, @decisionPanel, @fullResearch, @dataSources, @threadJson, @turnCount, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      ticker = excluded.ticker,
      title = COALESCE(NULLIF(excluded.title, ''), research_sessions.title, excluded.question),
      question = COALESCE(NULLIF(excluded.question, ''), research_sessions.question),
      conversation_id = COALESCE(research_sessions.conversation_id, excluded.conversation_id),
      status = excluded.status,
      report_markdown = excluded.report_markdown,
      rating = excluded.rating,
      confidence = excluded.confidence,
      decision_panel = excluded.decision_panel,
      full_research = excluded.full_research,
      data_sources = excluded.data_sources,
      thread_json = COALESCE(excluded.thread_json, research_sessions.thread_json),
      turn_count = COALESCE(excluded.turn_count, research_sessions.turn_count),
      updated_at = datetime('now')
  `);
  stmt.run({
    id,
    ticker: payload.ticker,
    title: payload.title || payload.sessionTitle || payload.question || "",
    question: payload.question || "",
    conversationId: payload.conversationId || id,
    status: payload.status || "completed",
    reportMarkdown: payload.reportMarkdown || null,
    rating: payload.researchStatus || payload.rating || null,
    confidence: payload.confidence || null,
    decisionPanel: payload.decisionPanel ? JSON.stringify(payload.decisionPanel) : null,
    fullResearch: payload.fullResearch || null,
    dataSources: payload.dataSources ? JSON.stringify(payload.dataSources) : null,
    threadJson: thread ? JSON.stringify(thread) : null,
    turnCount: Number.isFinite(payload.turnCount)
      ? payload.turnCount
      : thread
        ? thread.filter((message) => message?.role === "user").length
        : null
  });
  return { id };
}

export function getResearchSession(id) {
  ensureColumns();
  const db = getDb();
  const row = db.prepare("SELECT * FROM research_sessions WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    ticker: row.ticker,
    title: row.title || row.question,
    question: row.question,
    conversationId: row.conversation_id || row.id,
    status: row.status,
    reportMarkdown: row.report_markdown,
    rating: row.rating,
    confidence: row.confidence,
    decisionPanel: row.decision_panel ? safeParse(row.decision_panel) : null,
    fullResearch: row.full_research,
    dataSources: row.data_sources ? safeParse(row.data_sources) : null,
    thread: row.thread_json ? safeParse(row.thread_json) : null,
    turnCount: row.turn_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listResearchSessions({ limit = 20, ticker } = {}) {
  ensureColumns();
  const db = getDb();
  const rows = ticker
    ? db.prepare(`
        SELECT s.id, s.ticker, s.title, s.question, s.conversation_id, s.status, s.rating, s.confidence,
               s.turn_count, s.created_at, s.updated_at, c.name_zh AS company_name
        FROM research_sessions s
        LEFT JOIN companies c ON c.ticker = s.ticker
        WHERE s.ticker = ?
        ORDER BY s.updated_at DESC
        LIMIT ?
      `).all(ticker, limit)
    : db.prepare(`
        SELECT s.id, s.ticker, s.title, s.question, s.conversation_id, s.status, s.rating, s.confidence,
               s.turn_count, s.created_at, s.updated_at, c.name_zh AS company_name
        FROM research_sessions s
        LEFT JOIN companies c ON c.ticker = s.ticker
        ORDER BY s.updated_at DESC
        LIMIT ?
      `).all(limit);
  return rows;
}

/**
 * EA-5.1：会话分组列表——研究前端侧栏的权威数据源。把 research_sessions 按
 * COALESCE(conversation_id, id) 分组，每组按最近更新排序，组内按时间顺序列出
 * 途经过的每一家公司（同一次对话切换标的时留下的每一行）。
 *
 * 旧数据没有 conversation_id（迁移前的行）→ COALESCE 退化成自身 id，等价于"自成一组"，
 * 和分组前的历史列表行为完全一致，不需要回填迁移。
 */
export function listConversations({ limit = 20 } = {}) {
  ensureColumns();
  const db = getDb();
  // 拉取比目标分组数更多的原始行，保证同一分组的历史成员不会因为行数上限被切掉。
  // 按 rowid（sqlite 隐式插入序）排序，而非 created_at：datetime('now') 只到秒级精度，
  // 同一秒内的多次写入靠 created_at 排不出先后，rowid 单调递增能兜底这个精度差。
  const rows = db.prepare(`
    SELECT s.rowid AS row_seq, s.id, s.ticker, s.title, s.question, s.status, s.rating, s.confidence,
           s.turn_count, s.created_at, s.updated_at,
           COALESCE(s.conversation_id, s.id) AS conv_id,
           c.name_zh AS company_name
    FROM research_sessions s
    LEFT JOIN companies c ON c.ticker = s.ticker
    ORDER BY s.rowid ASC
  `).all();

  const groups = new Map();
  for (const row of rows) {
    let group = groups.get(row.conv_id);
    if (!group) {
      group = { conversationId: row.conv_id, title: row.title || row.question || row.company_name || row.ticker, updatedAt: row.updated_at, lastSeq: row.row_seq, sessions: [] };
      groups.set(row.conv_id, group);
    }
    if (row.updated_at >= group.updatedAt) { group.updatedAt = row.updated_at; group.lastSeq = row.row_seq; }
    group.sessions.push({
      id: row.id,
      ticker: row.ticker,
      companyName: row.company_name || row.ticker,
      title: row.title || row.question || row.ticker,
      status: row.status,
      rating: row.rating,
      confidence: row.confidence,
      turnCount: row.turn_count || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  const list = [...groups.values()].map(({ lastSeq, ...group }) => {
    const seen = new Set();
    const companies = [];
    for (const s of group.sessions) {
      if (s.ticker && !seen.has(s.ticker)) { seen.add(s.ticker); companies.push({ ticker: s.ticker, name: s.companyName }); }
    }
    return { ...group, companies, lastSeq };
  });
  list.sort((a, b) => (a.updatedAt !== b.updatedAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : b.lastSeq - a.lastSeq));
  return list.slice(0, limit).map(({ lastSeq, ...group }) => group);
}

export function deleteResearchSession(id) {
  ensureColumns();
  const db = getDb();
  const result = db.prepare("DELETE FROM research_sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

export function clearResearchSessions() {
  ensureColumns();
  const db = getDb();
  const result = db.prepare("DELETE FROM research_sessions").run();
  return result.changes;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
