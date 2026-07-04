/**
 * documentRepository — persists uploaded research documents to SQLite.
 */

import { getDb } from "../../db/index.js";
import { randomUUID } from "node:crypto";

export function addDocument({ ticker = null, name, mimeType = null, size = null, parser = null, text = null, summary = null, sourceType = "upload", sourceUrl = null }) {
  const db = getDb();
  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO documents (id, ticker, name, mime_type, size, parser, text, summary, source_type, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ticker, name, mimeType, size, parser, text, summary, sourceType, sourceUrl);
  return id;
}

export function getDocuments({ ticker = null, limit = 20 } = {}) {
  const db = getDb();
  if (ticker) {
    return db.prepare("SELECT * FROM documents WHERE ticker = ? ORDER BY created_at DESC LIMIT ?").all(ticker, limit);
  }
  return db.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT ?").all(limit);
}

export function getDocument(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) || null;
}

export function deleteDocument(id) {
  const db = getDb();
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
}

export function getDocumentsCount() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM documents").get();
  return row?.cnt || 0;
}
