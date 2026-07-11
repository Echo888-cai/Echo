/**
 * auth repository — 用户 / 邀请码 / 登录会话（U-1，migration 017）。
 *
 * 只做 SQL，不做密码学——哈希/校验/发 token 在 services/authService.js。
 * 所有函数同步（better-sqlite3），无网络即可单测。
 */

import { getDb } from "../../db/index.js";

// ── users ────────────────────────────────────────────────────

/** @returns {{id:string, username:string, passHash:string, displayName:string, role:string, createdAt:string, lastLoginAt:string|null}|null} */
function hydrateUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passHash: row.pass_hash,
    displayName: row.display_name || row.username,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}

export function getUserById(id) {
  return hydrateUser(getDb().prepare("SELECT * FROM users WHERE id = ?").get(id));
}

export function getUserByUsername(username) {
  return hydrateUser(getDb().prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim().toLowerCase()));
}

export function countUsers() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

export function listUsers() {
  return getDb().prepare("SELECT * FROM users ORDER BY created_at").all().map(hydrateUser);
}

/**
 * 建用户。username 统一小写存储（登录不区分大小写）。
 * @param {{id: string, username: string, passHash: string, displayName?: string, role?: string}} u
 */
export function createUser(u) {
  getDb().prepare(`
    INSERT INTO users (id, username, pass_hash, display_name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(u.id, u.username.trim().toLowerCase(), u.passHash, u.displayName || null, u.role || "member");
  return getUserById(u.id);
}

export function touchLastLogin(userId) {
  getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
}

// ── invite codes ─────────────────────────────────────────────

/** @param {string} code @param {{note?: string|null, createdBy?: string|null}} [opts] */
export function createInvite(code, { note, createdBy } = {}) {
  getDb().prepare("INSERT INTO invite_codes (code, note, created_by) VALUES (?, ?, ?)").run(code, note || null, createdBy || null);
  return code;
}

/**
 * 原子地消费邀请码并创建用户。任何一步失败都会整体回滚，避免留下“用户已建、邀请码未用”
 * 或“邀请码已用、用户没建”的半成品。
 * @param {{id: string, username: string, passHash: string, displayName?: string, role?: string}} u
 * @param {string} inviteCode
 */
export function createUserWithInvite(u, inviteCode) {
  const db = getDb();
  return db.transaction(() => {
    const invite = db.prepare("SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL").get(inviteCode);
    if (!invite) throw new Error("邀请码无效或已被使用");
    const user = createUser(u);
    const consumed = consumeInvite(inviteCode, u.id);
    if (!consumed) throw new Error("邀请码刚被别人用掉了");
    return user;
  })();
}

/** 未使用的邀请码才有效。 */
export function getUnusedInvite(code) {
  const row = getDb().prepare("SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL").get(String(code || "").trim());
  return row ? { code: row.code, note: row.note } : null;
}

/** 标记已用。返回 false 表示已被抢用（并发注册守卫）。 */
export function consumeInvite(code, userId) {
  return getDb()
    .prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL")
    .run(userId, code).changes > 0;
}

export function listInvites() {
  return getDb().prepare("SELECT * FROM invite_codes ORDER BY created_at DESC").all();
}

// ── auth sessions ────────────────────────────────────────────

export function insertSession(tokenHash, userId, expiresAtIso) {
  getDb().prepare(`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at, last_seen_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(tokenHash, userId, expiresAtIso);
}

/** 有效（未过期）会话，顺带滑动续期交给 service 决定。 */
export function getLiveSession(tokenHash, nowIso = new Date().toISOString()) {
  const row = getDb()
    .prepare("SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?")
    .get(tokenHash, nowIso);
  return row ? { tokenHash: row.token_hash, userId: row.user_id, expiresAt: row.expires_at } : null;
}

export function refreshSession(tokenHash, newExpiresAtIso) {
  getDb()
    .prepare("UPDATE auth_sessions SET expires_at = ?, last_seen_at = datetime('now') WHERE token_hash = ?")
    .run(newExpiresAtIso, tokenHash);
}

export function deleteSessionByHash(tokenHash) {
  return getDb().prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash).changes > 0;
}

export function deleteSessionsForUser(userId) {
  return getDb().prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId).changes;
}

/** 清过期会话（scheduler 或登录时顺手调）。 */
export function pruneExpiredSessions(nowIso = new Date().toISOString()) {
  return getDb().prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(nowIso).changes;
}
