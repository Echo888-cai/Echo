/**
 * Auth routes（U-1 / E12）：
 *
 * POST /api/auth/login    {username, password}            → Set-Cookie + {user}
 * POST /api/auth/register {invite, username, password}    → Set-Cookie + {user}
 * POST /api/auth/logout                                    → 清 cookie
 * GET  /api/auth/me                                        → {user, multiUser}（登录页判断入口）
 * POST /api/auth/invite   {note?}（仅 owner）              → {code}
 *
 * 业务规则全在 services/authService.js；这里只做 IO 与 cookie。
 */

import { randomBytes } from "node:crypto";
import { sendOk, sendError, readJsonBody } from "../utils/async.js";
import {
  loginWithPassword, registerWithInvite, destroySession, requestToken, sessionCookie,
  resolveRequestUser, multiUserEnabled
} from "../services/authService.js";
import { createInvite } from "../repositories/authRepository.js";

export async function handleAuthLogin(req, res) {
  try {
    const body = await readJsonBody(req, { maxBytes: 4096 });
    const { user, token } = loginWithPassword({ username: body.username, password: body.password });
    res.setHeader("Set-Cookie", sessionCookie(token));
    sendOk(res, { user });
  } catch (error) {
    sendError(res, 401, error.message || "登录失败");
  }
}

export async function handleAuthRegister(req, res) {
  try {
    const body = await readJsonBody(req, { maxBytes: 4096 });
    const { user, token } = registerWithInvite({
      invite: body.invite, username: body.username, password: body.password, displayName: body.displayName
    });
    res.setHeader("Set-Cookie", sessionCookie(token));
    sendOk(res, { user });
  } catch (error) {
    sendError(res, 400, error.message || "注册失败");
  }
}

export async function handleAuthLogout(req, res) {
  destroySession(requestToken(req));
  res.setHeader("Set-Cookie", sessionCookie("", { clear: true }));
  sendOk(res, { loggedOut: true });
}

export async function handleAuthMe(req, res) {
  // 这条是公开端点：登录页靠它区分"要登录"和"单用户模式直接进"。
  const user = resolveRequestUser(req);
  sendOk(res, { user, multiUser: multiUserEnabled() });
}

/** 仅 owner：生成一枚一次性邀请码（beta 期给朋友发码用）。 */
export async function handleAuthInvite(req, res) {
  try {
    // legacy 模式的“本机 owner”不是登录态。否则公网部署前忘记建 owner 时，任何人都能
    // 先生成邀请码并注册。生产必须先由 CLI 建真实 owner，再允许从页面发邀请码。
    if (!multiUserEnabled()) { sendError(res, 409, "请先用管理命令创建 owner 账号"); return; }
    const user = resolveRequestUser(req);
    if (!user || user.role !== "owner") { sendError(res, 403, "只有 owner 能生成邀请码"); return; }
    const body = await readJsonBody(req, { maxBytes: 4096 });
    const code = `echo-${randomBytes(4).toString("hex")}`;
    createInvite(code, { note: body.note, createdBy: user.id });
    sendOk(res, { code });
  } catch (error) {
    sendError(res, 500, error.message || "生成邀请码失败");
  }
}
