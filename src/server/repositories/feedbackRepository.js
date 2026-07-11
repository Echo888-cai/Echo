import { getDb } from "../../db/index.js";

export function insertFeedback(userId, message, context = null) {
  const info = getDb().prepare(`
    INSERT INTO feedback (user_id, message, context_json)
    VALUES (?, ?, ?)
  `).run(userId, String(message || "").trim().slice(0, 2000), context ? JSON.stringify(context) : null);
  return Number(info.lastInsertRowid);
}

export function listFeedback(userId, limit = 50) {
  return getDb().prepare("SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit);
}
