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
  question: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'draft'",
  report_markdown: "TEXT",
  rating: "TEXT",
  confidence: "TEXT",
  decision_panel: "TEXT",
  full_research: "TEXT",
  data_sources: "TEXT",
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
  const id = payload.id || `s_${randomUUID()}`;
  const stmt = db.prepare(`
    INSERT INTO research_sessions
      (id, ticker, question, status, report_markdown, rating, confidence, decision_panel, full_research, data_sources, updated_at)
    VALUES
      (@id, @ticker, @question, @status, @reportMarkdown, @rating, @confidence, @decisionPanel, @fullResearch, @dataSources, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      ticker = excluded.ticker,
      question = excluded.question,
      status = excluded.status,
      report_markdown = excluded.report_markdown,
      rating = excluded.rating,
      confidence = excluded.confidence,
      decision_panel = excluded.decision_panel,
      full_research = excluded.full_research,
      data_sources = excluded.data_sources,
      updated_at = datetime('now')
  `);
  stmt.run({
    id,
    ticker: payload.ticker,
    question: payload.question || "",
    status: payload.status || "completed",
    reportMarkdown: payload.reportMarkdown || null,
    rating: payload.researchStatus || payload.rating || null,
    confidence: payload.confidence || null,
    decisionPanel: payload.decisionPanel ? JSON.stringify(payload.decisionPanel) : null,
    fullResearch: payload.fullResearch || null,
    dataSources: payload.dataSources ? JSON.stringify(payload.dataSources) : null
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
    question: row.question,
    status: row.status,
    reportMarkdown: row.report_markdown,
    rating: row.rating,
    confidence: row.confidence,
    decisionPanel: row.decision_panel ? safeParse(row.decision_panel) : null,
    fullResearch: row.full_research,
    dataSources: row.data_sources ? safeParse(row.data_sources) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listResearchSessions({ limit = 20, ticker } = {}) {
  ensureColumns();
  const db = getDb();
  const rows = ticker
    ? db.prepare("SELECT id, ticker, question, status, rating, confidence, created_at, updated_at FROM research_sessions WHERE ticker = ? ORDER BY updated_at DESC LIMIT ?").all(ticker, limit)
    : db.prepare("SELECT id, ticker, question, status, rating, confidence, created_at, updated_at FROM research_sessions ORDER BY updated_at DESC LIMIT ?").all(limit);
  return rows;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
