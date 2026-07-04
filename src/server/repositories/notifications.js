/**
 * notifications repository — 通知中心的持久层。
 *
 * 通知 = 系统主动产出的、值得用户知道的事：盘前速报、持仓触线、证伪命中、系统消息。
 * Web 通知中心从这张表读；Telegram 推送只是同一条通知的额外出口（见 services/notifier.js）。
 *
 * dedupe_key：防刷屏。同 key 在窗口期内只落一条（如触线巡检每 30 分钟跑一次，
 * 同一根止损线 12 小时内只提醒一次）。
 *
 * 商业化预留：user_id 缺省 'local'（见 docs/PLAN.md §4 的新表 user_id 约定）。
 */

import { getDb } from "../../db/index.js";

/**
 * 落一条通知。带 dedupeKey 时，若窗口期（默认 12h）内已有同 key 通知则跳过。
 * @returns {{ id:number }|null} null = 被去重跳过
 */
export function insertNotification({ kind, title, body = "", ticker = null, payload = null, dedupeKey = null, dedupeWindowHours = 12 }) {
  const db = getDb();
  if (dedupeKey) {
    const dup = db
      .prepare("SELECT id FROM notifications WHERE dedupe_key = ? AND created_at >= datetime('now', ?) LIMIT 1")
      .get(dedupeKey, `-${Math.max(1, Math.round(dedupeWindowHours))} hours`);
    if (dup) return null;
  }
  const info = db
    .prepare(`
      INSERT INTO notifications (kind, title, body, ticker, payload, dedupe_key)
      VALUES (@kind, @title, @body, @ticker, @payload, @dedupeKey)
    `)
    .run({
      kind: String(kind || "system"),
      title: String(title || "").slice(0, 300),
      body: String(body || "").slice(0, 4000),
      ticker: ticker || null,
      payload: payload ? JSON.stringify(payload) : null,
      dedupeKey: dedupeKey || null
    });
  return { id: Number(info.lastInsertRowid) };
}

/** 最近通知（新的在前）。 */
export function listNotifications(limit = 20) {
  return getDb()
    .prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT ?")
    .all(Math.min(100, Math.max(1, limit)))
    .map(hydrate);
}

export function unreadCount() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL").get().n;
}

export function markRead(id) {
  getDb().prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL").run(Number(id));
}

export function markAllRead() {
  getDb().prepare("UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL").run();
}

function hydrate(row) {
  let payload = null;
  if (row.payload) {
    try { payload = JSON.parse(row.payload); } catch { payload = null; }
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body || "",
    ticker: row.ticker || null,
    payload,
    createdAt: row.created_at,
    readAt: row.read_at || null
  };
}
