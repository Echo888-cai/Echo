import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  countUsers,
  createUser,
  createUserWithInvite,
  deleteSessionByHash,
  ensureLocalUser,
  getLiveSession,
  getUnusedInvite,
  getUserById,
  getUserByUsername,
  insertSession,
  pruneExpiredSessions,
  refreshSession,
  touchLastLogin
} from "@echo/db/repositories/authRepository.js";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;
const COOKIE_NAME = "echo_session";
export const OWNER_USER_ID = "local";
// scryptSync here runs once at module load, not on the request path — safe to stay synchronous.
const DUMMY_PASSWORD_HASH = `s1$${Buffer.alloc(16).toString("hex")}$${scryptSync("echo-invalid-login-sentinel", Buffer.alloc(16), 64, SCRYPT_PARAMS).toString("hex")}`;
const ACCOUNT_RE = /^(?:[a-z0-9_-]{3,24}|[^\s@]+@[^\s@]+\.[^\s@]+)$/i;
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: typeof SCRYPT_PARAMS) => Promise<Buffer>;

export async function hashPassword(password: string) {
  if (password.length < 8) throw new Error("口令至少 8 位");
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, SCRYPT_PARAMS);
  return `s1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  try {
    const [scheme, saltHex, hashHex] = String(stored || "").split("$");
    if (scheme !== "s1" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT_PARAMS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await insertSession(sha256(token), userId, daysFromNow(SESSION_DAYS));
  await pruneExpiredSessions();
  return token;
}

export async function getSessionUser(token: string | null) {
  if (!token) return null;
  const live = await getLiveSession(sha256(token));
  if (!live) return null;
  if (Date.parse(live.expiresAt) - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
    await refreshSession(live.tokenHash, daysFromNow(SESSION_DAYS));
  }
  return getUserById(live.userId);
}

export async function destroySession(token: string | null) {
  return token ? deleteSessionByHash(sha256(token)) : false;
}

function publicUser(user: any) {
  return user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role } : null;
}

export async function registerWithInvite(input: { invite: string; username: string; password: string; displayName?: string }) {
  const username = input.username.trim().toLowerCase();
  if (!ACCOUNT_RE.test(username)) throw new Error("请输入有效邮箱");
  if (await getUserByUsername(username)) throw new Error("邮箱已被使用");
  const invite = await getUnusedInvite(input.invite);
  if (!invite) throw new Error("邀请码无效或已被使用");
  const id = `u_${randomBytes(6).toString("hex")}`;
  const user = await createUserWithInvite({
    id,
    username,
    passHash: await hashPassword(input.password),
    displayName: input.displayName,
    role: "member"
  }, invite.code);
  const token = await createSession(id);
  await touchLastLogin(id);
  return { user: publicUser(user), token };
}

export async function loginWithPassword(input: { username: string; password: string }) {
  const user = await getUserByUsername(input.username);
  const valid = await verifyPassword(input.password, user?.passHash || DUMMY_PASSWORD_HASH) && Boolean(user);
  if (!valid || !user) throw new Error("用户名或密码不对");
  const token = await createSession(user.id);
  await touchLastLogin(user.id);
  return { user: publicUser(user), token };
}

export async function createOwner(input: { username: string; password: string; displayName?: string }) {
  if (await getUserById(OWNER_USER_ID)) throw new Error("owner 已存在");
  const username = input.username.trim().toLowerCase();
  if (!ACCOUNT_RE.test(username)) throw new Error("请输入有效邮箱");
  return publicUser(await createUser({ id: OWNER_USER_ID, username, passHash: await hashPassword(input.password), displayName: input.displayName, role: "owner" }));
}

function parseCookies(headers: Headers) {
  const cookies: Record<string, string> = {};
  for (const part of String(headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0) cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return cookies;
}

async function localOwner() {
  const id = process.env.ECHO_AUTH_DISABLED_USER_ID || OWNER_USER_ID;
  await ensureLocalUser(id);
  return { id, username: "local", displayName: "本机用户", role: "owner" as const };
}

export async function resolveRequestUser(request: Request) {
  if (process.env.ECHO_AUTH_DISABLED === "1" || await countUsers() === 0) return localOwner();
  return publicUser(await getSessionUser(parseCookies(request.headers)[COOKIE_NAME] || null));
}

export function sessionCookie(token: string, { clear = false } = {}) {
  const secure = process.env.ECHO_TRUST_PROXY === "1" ? "; Secure" : "";
  return clear
    ? `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
    : `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
}

export function requestToken(request: Request) {
  return parseCookies(request.headers)[COOKIE_NAME] || null;
}

export async function multiUserEnabled() {
  return process.env.ECHO_AUTH_DISABLED !== "1" && await countUsers() > 0;
}
