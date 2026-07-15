import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { authSessions, inviteCodes, users } from "../schema/auth.js";
import { database, withTenant } from "./context.js";

function hydrateUser(row: typeof users.$inferSelect | undefined) {
  if (!row) return null;
  return { id: row.id, username: row.username, passHash: row.passHash, displayName: row.displayName || row.username,
    role: row.role, createdAt: row.createdAt.toISOString(), lastLoginAt: row.lastLoginAt?.toISOString() || null };
}

export async function getUserById(id: string) {
  return hydrateUser((await database().select().from(users).where(eq(users.id, id)).limit(1))[0]);
}

export async function getUserByUsername(username: string) {
  return hydrateUser((await database().select().from(users).where(eq(users.username, String(username || "").trim().toLowerCase())).limit(1))[0]);
}

export async function countUsers() {
  return Number((await database().select({ value: count() }).from(users))[0]?.value || 0);
}

export async function listUsers() {
  return (await database().select().from(users).orderBy(asc(users.createdAt))).map((row) => hydrateUser(row)!);
}

export async function createUser(input: any) {
  const [saved] = await database().insert(users).values({ id: input.id, username: input.username.trim().toLowerCase(),
    passHash: input.passHash, displayName: input.displayName || null, role: input.role || "member" }).returning();
  return hydrateUser(saved);
}

export async function ensureLocalUser(id = "local") {
  const [saved] = await database().insert(users).values({
    id,
    username: id.toLowerCase(),
    passHash: "!local-auth-disabled",
    displayName: "本机用户",
    role: "owner"
  }).onConflictDoNothing({ target: users.id }).returning();
  return hydrateUser(saved) || getUserById(id);
}

export async function touchLastLogin(userId: string) {
  await database().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export async function createInvite(code: string, { note, createdBy }: any = {}) {
  await database().insert(inviteCodes).values({ code, note: note || null, createdBy: createdBy || null });
  return code;
}

export async function createUserWithInvite(input: any, inviteCode: string) {
  return database().transaction(async (tx) => {
    const invite = (await tx.select({ code: inviteCodes.code }).from(inviteCodes)
      .where(and(eq(inviteCodes.code, inviteCode), isNull(inviteCodes.usedBy))).for("update").limit(1))[0];
    if (!invite) throw new Error("邀请码无效或已被使用");
    const [saved] = await tx.insert(users).values({ id: input.id, username: input.username.trim().toLowerCase(),
      passHash: input.passHash, displayName: input.displayName || null, role: input.role || "member" }).returning();
    const consumed = await tx.update(inviteCodes).set({ usedBy: input.id, usedAt: new Date() })
      .where(and(eq(inviteCodes.code, inviteCode), isNull(inviteCodes.usedBy))).returning({ code: inviteCodes.code });
    if (!consumed.length) throw new Error("邀请码刚被别人用掉了");
    return hydrateUser(saved);
  });
}

export async function getUnusedInvite(code: string) {
  const row = (await database().select().from(inviteCodes).where(and(eq(inviteCodes.code, String(code || "").trim()), isNull(inviteCodes.usedBy))).limit(1))[0];
  return row ? { code: row.code, note: row.note } : null;
}

// `consumeInvite(code, userId)` 曾在这里：一条**非原子**的销号路径（先查后改，中间有
// TOCTOU 窗口，两个人能同时用掉同一个邀请码）。真正的注册流程走 `createUserWithInvite`,
// 它在单个事务里 `SELECT ... FOR UPDATE` + update，没有这个窗口。旧函数零调用、且是个
// 等人踩的陷阱，已删除——不是"清理死代码"，是移走一把上了膛的枪。

export async function listInvites() {
  return database().select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt));
}

export async function insertSession(tokenHash: string, userId: string, expiresAtIso: string) {
  await withTenant(userId, (tx) => tx.insert(authSessions).values({ tokenHash, userId, expiresAt: new Date(expiresAtIso), lastSeenAt: new Date() }));
}

export async function getLiveSession(tokenHash: string, nowIso = new Date().toISOString()) {
  const result = await database().execute(sql`select * from authenticate_session(${tokenHash}, ${nowIso})`);
  const row = Array.from(result)[0] as any;
  return row ? { tokenHash: row.token_hash, userId: row.user_id, expiresAt: new Date(row.expires_at).toISOString() } : null;
}

export async function refreshSession(tokenHash: string, newExpiresAtIso: string) {
  await database().execute(sql`select refresh_auth_session(${tokenHash}, ${newExpiresAtIso})`);
}

export async function deleteSessionByHash(tokenHash: string) {
  const result = await database().execute(sql`select delete_auth_session(${tokenHash}) as deleted`);
  return Boolean((Array.from(result)[0] as any)?.deleted);
}

export async function deleteSessionsForUser(userId: string) {
  return withTenant(userId, async (tx) => (await tx.delete(authSessions).where(eq(authSessions.userId, userId)).returning({ tokenHash: authSessions.tokenHash })).length);
}

export async function pruneExpiredSessions(nowIso = new Date().toISOString()) {
  const result = await database().execute(sql`select prune_auth_sessions(${nowIso}) as count`);
  return Number((Array.from(result)[0] as any)?.count || 0);
}
