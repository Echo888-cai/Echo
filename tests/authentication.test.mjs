// U-1（E12 鉴权与邀请制）：scrypt 口令、邀请码一次性、登录会话生命周期、
// 单用户 legacy 模式 → 多用户模式的切换（PLAN v5）。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import {
  hashPassword, verifyPassword, createOwner, registerWithInvite, loginWithPassword,
  getSessionUser, destroySession, resolveRequestUser, multiUserEnabled,
  sessionCookie, OWNER_USER_ID
} from "../src/server/services/auth.js";
import {
  createInvite, getUnusedInvite, consumeInvite, countUsers, getUserByUsername
} from "../src/server/repositories/authRepository.js";

// ── 口令哈希 ──────────────────────────────────────────────────
const hash = hashPassword("correct-horse-1");
assert.match(hash, /^s1\$[0-9a-f]{32}\$[0-9a-f]{128}$/, "格式 s1$salt$hash");
assert.ok(verifyPassword("correct-horse-1", hash));
assert.ok(!verifyPassword("wrong-password-1", hash));
assert.ok(!verifyPassword("correct-horse-1", "garbage"), "坏存储格式不抛错，只判 false");
assert.notEqual(hashPassword("correct-horse-1"), hash, "随机盐：同口令两次哈希不同");
assert.throws(() => hashPassword("short"), /至少 8 位/);

// ── 单用户 legacy 模式（还没建任何用户）──────────────────────────
assert.equal(countUsers(), 0);
assert.equal(multiUserEnabled(), false);
const legacyUser = resolveRequestUser(/** @type {any} */ ({ headers: {} }));
assert.equal(legacyUser.id, OWNER_USER_ID, "无用户时恒为 owner 'local'（行为与今天一致）");

// ── 建 owner：多用户模式自动开启 ─────────────────────────────────
const owner = createOwner({ username: "Arlan", password: "arlan-pass-123" });
assert.equal(owner.id, OWNER_USER_ID, "owner 固定 id 'local'，既有数据自动归属");
assert.equal(owner.username, "arlan", "用户名统一小写");
assert.equal(owner.role, "owner");
assert.throws(() => createOwner({ username: "again", password: "whatever-123" }), /已存在/);
assert.equal(multiUserEnabled(), true);
assert.equal(resolveRequestUser(/** @type {any} */ ({ headers: {} })), null, "多用户模式下无 cookie = 401");

// ── 登录 + 会话生命周期 ─────────────────────────────────────────
assert.throws(() => loginWithPassword({ username: "arlan", password: "wrong-pass-123" }), /用户名或密码不对/);
assert.throws(() => loginWithPassword({ username: "nobody", password: "wrong-pass-123" }), /用户名或密码不对/, "不区分'没这个人'");
const { token } = loginWithPassword({ username: "ARLAN", password: "arlan-pass-123" });
assert.ok(token.length > 30);
assert.equal(getSessionUser(token).id, OWNER_USER_ID);
const cookieUser = resolveRequestUser(/** @type {any} */ ({ headers: { cookie: `echo_session=${token}` } }));
assert.equal(cookieUser.id, OWNER_USER_ID, "cookie 会话应解析出用户");
assert.ok(destroySession(token));
assert.equal(getSessionUser(token), null, "登出即失效（库里删行，可撤销）");

// ── 邀请码注册 ──────────────────────────────────────────────────
createInvite("echo-test0001", { note: "单测", createdBy: OWNER_USER_ID });
assert.ok(getUnusedInvite("echo-test0001"));
assert.throws(() => registerWithInvite({ invite: "echo-nothere", username: "bro", password: "bro-pass-123" }), /邀请码无效/);
assert.throws(() => registerWithInvite({ invite: "echo-test0001", username: "x", password: "bro-pass-123" }), /用户名 3-24 位/);
assert.throws(() => registerWithInvite({ invite: "echo-test0001", username: "arlan", password: "bro-pass-123" }), /已被使用/);
const reg = registerWithInvite({ invite: "echo-test0001", username: "brother", password: "bro-pass-123" });
assert.equal(reg.user.role, "member");
assert.ok(reg.user.id.startsWith("u_"));
assert.equal(getSessionUser(reg.token).id, reg.user.id, "注册即登录");
assert.equal(getUnusedInvite("echo-test0001"), null, "邀请码一次性");
assert.ok(!consumeInvite("echo-test0001", "u_zzz"), "已用的码不能再消费");
assert.ok(getUserByUsername("brother"));

// ── cookie 属性 ────────────────────────────────────────────────
const setCookie = sessionCookie("tok123");
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /SameSite=Lax/);
assert.match(setCookie, /Path=\//);
assert.ok(!setCookie.includes("Secure"), "本机 http 不带 Secure（ECHO_TRUST_PROXY=1 才带）");
assert.match(sessionCookie("", { clear: true }), /Max-Age=0/);

// ── ECHO_AUTH_DISABLED 逃生门 ─────────────────────────────────
process.env.ECHO_AUTH_DISABLED = "1";
assert.equal(resolveRequestUser(/** @type {any} */ ({ headers: {} })).id, OWNER_USER_ID);
assert.equal(multiUserEnabled(), false);
delete process.env.ECHO_AUTH_DISABLED;

console.log("phase-u1 ✓ 鉴权与邀请制（scrypt / 会话 / 邀请码 / legacy 切换）");
