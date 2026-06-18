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

const SCHEMA = {
  id: "TEXT PRIMARY KEY",
  ticker: "TEXT",
  title: "TEXT",
  question: "TEXT",
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
  const id = payload.id || payload.sessionId || `s_${randomUUID()}`;
  const thread = Array.isArray(payload.thread) ? payload.thread.slice(-80) : null;
  const stmt = db.prepare(`
    INSERT INTO research_sessions
      (id, ticker, title, question, status, report_markdown, rating, confidence, decision_panel, full_research, data_sources, thread_json, turn_count, updated_at)
    VALUES
      (@id, @ticker, @title, @question, @status, @reportMarkdown, @rating, @confidence, @decisionPanel, @fullResearch, @dataSources, @threadJson, @turnCount, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      ticker = excluded.ticker,
      title = COALESCE(NULLIF(excluded.title, ''), research_sessions.title, excluded.question),
      question = COALESCE(NULLIF(excluded.question, ''), research_sessions.question),
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
        SELECT s.id, s.ticker, s.title, s.question, s.status, s.rating, s.confidence,
               s.turn_count, s.created_at, s.updated_at, c.name_zh AS company_name
        FROM research_sessions s
        LEFT JOIN companies c ON c.ticker = s.ticker
        WHERE s.ticker = ?
        ORDER BY s.updated_at DESC
        LIMIT ?
      `).all(ticker, limit)
    : db.prepare(`
        SELECT s.id, s.ticker, s.title, s.question, s.status, s.rating, s.confidence,
               s.turn_count, s.created_at, s.updated_at, c.name_zh AS company_name
        FROM research_sessions s
        LEFT JOIN companies c ON c.ticker = s.ticker
        ORDER BY s.updated_at DESC
        LIMIT ?
      `).all(limit);
  return rows;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
