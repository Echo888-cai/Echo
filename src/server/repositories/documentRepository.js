/**
 * documentRepository — persists uploaded research documents to SQLite.
 */

import { getDb } from "../../db/index.js";
import { randomUUID } from "node:crypto";

let ensured = false;

function ensureTable() {
  if (ensured) return;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    ticker TEXT,
    name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    parser TEXT,
    text TEXT,
    summary TEXT,
    source_type TEXT NOT NULL DEFAULT 'upload',
    source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // migration: add columns that may not exist
  const cols = new Set(db.prepare("PRAGMA table_info(documents)").all().map(c => c.name));
  const additions = {
    ticker: "TEXT",
    source_url: "TEXT"
  };
  for (const [name, def] of Object.entries(additions)) {
    if (!cols.has(name)) {
      try { db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${def}`); } catch {}
    }
  }
  ensured = true;
}

export function addDocument({ ticker = null, name, mimeType = null, size = null, parser = null, text = null, summary = null, sourceType = "upload", sourceUrl = null }) {
  ensureTable();
  const db = getDb();
  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO documents (id, ticker, name, mime_type, size, parser, text, summary, source_type, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ticker, name, mimeType, size, parser, text, summary, sourceType, sourceUrl);
  return id;
}

export function getDocuments({ ticker = null, limit = 20 } = {}) {
  ensureTable();
  const db = getDb();
  if (ticker) {
    return db.prepare("SELECT * FROM documents WHERE ticker = ? ORDER BY created_at DESC LIMIT ?").all(ticker, limit);
  }
  return db.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT ?").all(limit);
}

export function getDocument(id) {
  ensureTable();
  const db = getDb();
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) || null;
}

export function deleteDocument(id) {
  ensureTable();
  const db = getDb();
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
}

export function getDocumentsCount() {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM documents").get();
  return row?.cnt || 0;
}
