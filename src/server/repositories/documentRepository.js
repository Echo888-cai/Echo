/**
 * documentRepository — persists uploaded research documents to SQLite.
 */

import { getDb } from "../../db/index.js";
import { randomUUID } from "node:crypto";

export function addDocument({ ticker = null, name, mimeType = null, size = null, parser = null, text = null, summary = null, sourceType = "upload", sourceUrl = null, userId = "local" }) {
  const db = getDb();
  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO documents (id, user_id, ticker, name, mime_type, size, parser, text, summary, source_type, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, ticker, name, mimeType, size, parser, text, summary, sourceType, sourceUrl);
  return id;
}

export function getDocuments({ ticker = null, limit = 20, userId = "local" } = {}) {
  const db = getDb();
  if (ticker) {
    return db.prepare("SELECT * FROM documents WHERE user_id = ? AND ticker = ? ORDER BY created_at DESC LIMIT ?").all(userId, ticker, limit);
  }
  return db.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
}

export function getDocument(id, userId = "local") {
  const db = getDb();
  return db.prepare("SELECT * FROM documents WHERE user_id = ? AND id = ?").get(userId, id) || null;
}

export function deleteDocument(id, userId = "local") {
  const db = getDb();
  return db.prepare("DELETE FROM documents WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
}

export function getDocumentsCount(userId = "local") {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE user_id = ?").get(userId);
  return row?.cnt || 0;
}
