/**
 * 身份认证 — 密码哈希、登录会话与请求鉴权。
 *
 * 全部用 node:crypto，零新增依赖（红线 1）：
 *   · 口令：scrypt（N=16384, r=8, p=1，随机 16B salt），格式 s1$saltHex$hashHex；
 *     校验用 timingSafeEqual，不给计时侧信道。
 *   · 会话：32B 随机 token 发给 cookie，库里只存 sha256(token)——库泄露不等于会话泄露，
 *     且可服务端随时撤销（删行即登出），比纯签名 cookie 更可控。
 *   · CSRF：SameSite=Lax + 全部非 GET 请求要求自定义头 X-Echo-Auth: 1
 *     （跨站表单/图片发不出自定义头；我们的前端 fetch 统一带上）。
 *
 * 运行模式（resolveRequestUser）：
 *   · ECHO_AUTH_DISABLED=1        → 恒为 owner（CI/单测/本机逃生门）。
 *   · users 表为空（尚未建 owner）  → 单用户 legacy 模式，恒为 owner（'local'）——
 *     现有本机工作流零改变；跑 scripts/manage-users.js create-owner 后鉴权自动生效。
 *   · 有用户                       → 必须携带有效会话 cookie，否则 401。
 */

import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import {
  getUserById, getUserByUsername, countUsers, createUser, createUserWithInvite, touchLastLogin,
  getUnusedInvite,
  insertSession, getLiveSession, refreshSession, deleteSessionByHash, pruneExpiredSessions
} from "../repositories/authRepository.js";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;
const COOKIE_NAME = "echo_session";
/** owner 固定 id：让 user_id DEFAULT 'local' 的既有数据自动归属 owner（见 017 迁移注释）。 */
export const OWNER_USER_ID = "local";

// 不存在的用户名也必须跑一次真实 scrypt，避免响应耗时暴露“这个用户名是否存在”。
// 固定盐/固定哨兵口令不承担认证用途，只用于把失败路径的计算成本拉齐。
const DUMMY_PASSWORD_HASH = `s1$${Buffer.alloc(16).toString("hex")}$${scryptSync("echo-invalid-login-sentinel", Buffer.alloc(16), 64, SCRYPT_PARAMS).toString("hex")}`;

// ── 口令 ─────────────────────────────────────────────────────

export function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) throw new Error("口令至少 8 位");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT_PARAMS);
  return `s1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored || "").split("$");
    if (scheme !== "s1" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(String(password ?? ""), Buffer.from(saltHex, "hex"), expected.length, SCRYPT_PARAMS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── 会话 ─────────────────────────────────────────────────────

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const daysFromNow = (d) => new Date(Date.now() + d * 86400_000).toISOString();

/** 登录成功后开会话，返回要放进 cookie 的原文 token。 */
export function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  insertSession(sha256(token), userId, daysFromNow(SESSION_DAYS));
  pruneExpiredSessions(); // 顺手清库
  return token;
}

/** token → user；有效则滑动续期（剩余 < 一半时延到满 30 天）。 */
export function getSessionUser(token) {
  if (!token) return null;
  const live = getLiveSession(sha256(token));
  if (!live) return null;
  const remainingMs = Date.parse(live.expiresAt) - Date.now();
  if (remainingMs < (SESSION_DAYS / 2) * 86400_000) refreshSession(live.tokenHash, daysFromNow(SESSION_DAYS));
  return getUserById(live.userId);
}

export function destroySession(token) {
  if (!token) return false;
  return deleteSessionByHash(sha256(token));
}

// ── 注册 / 登录（业务规则收在这里，route 只做 IO） ──────────────

const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

/**
 * 凭邀请码注册。返回 { user, token }；任何失败抛 Error（中文文案直接给前端）。
 */
export function registerWithInvite({ invite, username, password, displayName }) {
  const uname = String(username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(uname)) throw new Error("用户名 3-24 位，只能用小写字母/数字/_-");
  if (getUserByUsername(uname)) throw new Error("用户名已被使用");
  const inviteRow = getUnusedInvite(invite);
  if (!inviteRow) throw new Error("邀请码无效或已被使用");
  const id = `u_${randomBytes(6).toString("hex")}`;
  const user = createUserWithInvite(
    { id, username: uname, passHash: hashPassword(password), displayName, role: "member" },
    inviteRow.code
  );
  const token = createSession(id);
  touchLastLogin(id);
  return { user: publicUser(user), token };
}

export function loginWithPassword({ username, password }) {
  const user = getUserByUsername(username);
  // 用户不存在也走一次哈希校验，登录失败的耗时不区分"没这个人"和"密码错"。
  const ok = verifyPassword(password, user?.passHash || DUMMY_PASSWORD_HASH) && Boolean(user);
  if (!ok) throw new Error("用户名或密码不对");
  const token = createSession(user.id);
  touchLastLogin(user.id);
  return { user: publicUser(user), token };
}

/** 建 owner（scripts/manage-users.js 用；也是从单用户模式切多用户的开关）。 */
export function createOwner({ username, password, displayName }) {
  if (getUserById(OWNER_USER_ID)) throw new Error("owner 已存在");
  const uname = String(username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(uname)) throw new Error("用户名 3-24 位，只能用小写字母/数字/_-");
  return publicUser(createUser({ id: OWNER_USER_ID, username: uname, passHash: hashPassword(password), displayName, role: "owner" }));
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

// ── 请求侧 ───────────────────────────────────────────────────

function parseCookies(req) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** 单用户 legacy 模式判定结果缓存一进程一次会拿不到"刚建 owner"的变化——不缓存，countUsers 是索引点查，便宜。 */
function legacyOwner() {
  return { id: OWNER_USER_ID, username: "local", displayName: "本机用户", role: "owner" };
}

/**
 * 解析请求的用户身份。
 * @returns {{id:string, username:string, displayName:string, role:string}|null}
 */
export function resolveRequestUser(req) {
  if (process.env.ECHO_AUTH_DISABLED === "1") return legacyOwner();
  if (countUsers() === 0) return legacyOwner(); // 尚未建 owner：单用户模式，行为与今天完全一致
  const token = parseCookies(req)[COOKIE_NAME];
  const user = getSessionUser(token);
  return user ? publicUser(user) : null;
}

/** 登录/登出要写的 Set-Cookie 值。生产（反代后）带 Secure，本机 http 不带。 */
export function sessionCookie(token, { clear = false } = {}) {
  const secure = process.env.ECHO_TRUST_PROXY === "1" ? "; Secure" : "";
  if (clear) return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

/** 从请求读会话 token（登出用）。 */
export function requestToken(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

/** 多用户模式是否已启用（前端据此显示"退出登录"）。 */
export function multiUserEnabled() {
  return process.env.ECHO_AUTH_DISABLED !== "1" && countUsers() > 0;
}
