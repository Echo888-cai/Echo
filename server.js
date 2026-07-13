/**
 * Echo Research server entry point.
 *
 * Thin HTTP layer: serves the static SPA and dispatches the JSON API the
 * frontend actually uses — company search, chat research, deep report,
 * research sessions, document parsing and status.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./src/server/utils/env.js";
import { isAllowedStaticPath, rateLimitCheck, generalBucket, heavyBucket } from "./src/server/utils/httpGuard.js";
import { sendError } from "./src/server/utils/async.js";

// Routes
import { handleStatusApi } from "./src/server/routes/status.js";
import { handleDocumentParseApi } from "./src/server/routes/documents.js";
import { handleCompanySearch, handleCompanyResolve, handleCompanyVerify } from "./src/server/routes/companies.js";
import { handleSessionList, handleConversationList, handleSessionClear, handleSessionGet, handleSessionDelete } from "./src/server/routes/research.js";
import { handleChatApi } from "./src/server/routes/chat.js";
import { handleDiscoverApi } from "./src/server/routes/discover.js";
import { handleAskApi } from "./src/server/routes/ask.js";
import { handleReportGenerateApi } from "./src/server/routes/reports.js";
import { handleProfileList, handleProfileGet, handleProfileDelete, handleProfileReview, handleResearchScorecard } from "./src/server/routes/portraits.js";
import { handleEventsDigest } from "./src/server/routes/events.js";
import { handleWatchDesk, handleWatchStock, handleWatchTrack, handleWatchUntrack } from "./src/server/routes/watch.js";
import { handlePortfolioList, handlePortfolioUpsert, handlePortfolioDelete, handlePortfolioReview, handlePortfolioSnapshots } from "./src/server/routes/portfolio.js";
import { handleNotificationsList, handleNotificationsUnread, handleNotificationsRead, handleNotificationsTest, handleSchedulerStatus } from "./src/server/routes/notifications.js";
import { handleHkFinancialsList, handleHkFinancialsIngest } from "./src/server/routes/hkFinancials.js";
import { handleAuthLogin, handleAuthRegister, handleAuthLogout, handleAuthMe, handleAuthInvite } from "./src/server/routes/auth.js";
import { handlePreferencesGet, handlePreferencesUpdate, handleFeedbackCreate } from "./src/server/routes/preferences.js";
import { resolveRequestUser } from "./src/server/services/auth.js";
import { startScheduler } from "./src/server/services/scheduler.js";
import { enterRequestUser } from "./src/server/services/requestContext.js";

const root = fileURLToPath(new URL(".", import.meta.url));
loadEnvFile(root);

const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = normalize(cleanPath === "/" ? "/index.html" : cleanPath);
  return join(root, normalized);
}

/** E11：白名单判定用的规范化 pathname（与 resolvePath 同一套 decode+normalize）。 */
function normalizedPathname(urlPath) {
  try {
    return normalize(decodeURIComponent(urlPath.split("?")[0]));
  } catch {
    return "/"; // 畸形编码一律当根路径处理（回 SPA 壳）
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // ── E11 限速：API 才计数（静态资源不算），重型端点单独更紧的桶 ──
  if (url.startsWith("/api/")) {
    const limited = rateLimitCheck(req, normalizedPathname(url));
    if (limited) return sendError(res, limited.status, limited.message);

    // ── U-1 CSRF：非 GET 一律要求自定义头（跨站表单/图片发不出自定义头；
    //    前端 fetch 统一带 X-Echo-Auth: 1）。SameSite=Lax 是第二道锁。──
    if (method !== "GET" && method !== "HEAD" && req.headers["x-echo-auth"] !== "1") {
      return sendError(res, 403, "缺少校验请求头（请从 Echo Research 页面发起请求）");
    }

    // ── U-1 鉴权：/api/auth/* 公开；其余端点需要身份。
    //    users 表为空 = 单用户 legacy 模式（恒为 owner 'local'，与今天行为一致），
    //    建 owner 账号后自动进入多用户模式（PLAN v5 E12）。──
    if (method === "POST" && url.startsWith("/api/auth/login")) return handleAuthLogin(req, res);
    if (method === "POST" && url.startsWith("/api/auth/register")) return handleAuthRegister(req, res);
    if (method === "POST" && url.startsWith("/api/auth/logout")) return handleAuthLogout(req, res);
    if (method === "POST" && url.startsWith("/api/auth/invite")) return handleAuthInvite(req, res);
    if (method === "GET" && url.startsWith("/api/auth/me")) return handleAuthMe(req, res);
    const user = resolveRequestUser(req);
    if (!user) return sendError(res, 401, "请先登录");
    // 后续路由从 req 上取当前用户（U-2 起私有数据全部按它过滤，红线 18）。
    /** @type {any} */ (req).echoUser = user;
    // U-4：让本请求内的所有模型调用自动归属当前用户，不在几十层 service 之间传全局单例。
    enterRequestUser(user.id);
  }

  // ── Company search ─────────────────────────────────────
  if (method === "GET" && url.startsWith("/api/companies/verify")) return handleCompanyVerify(req, res);
  if (method === "GET" && url.startsWith("/api/companies/resolve")) return handleCompanyResolve(req, res);
  if (method === "GET" && url.startsWith("/api/companies/search")) return handleCompanySearch(req, res);

  // ── Status ─────────────────────────────────────────────
  if (method === "GET" && url.startsWith("/api/status")) return handleStatusApi(req, res);
  if (method === "GET" && url.startsWith("/api/preferences")) return handlePreferencesGet(req, res);
  if (method === "PATCH" && url.startsWith("/api/preferences")) return handlePreferencesUpdate(req, res);
  if (method === "POST" && url.startsWith("/api/feedback")) return handleFeedbackCreate(req, res);

  // ── Documents (upload parsing for the composer) ────────
  if (method === "POST" && url.startsWith("/api/parse-document")) return handleDocumentParseApi(req, res);

  // ── 统一入口（EA-0：一条对话的所有问题都从这进，服务端决定路由） ──
  if (method === "POST" && url.startsWith("/api/ask")) return handleAskApi(req, res);

  // ── Research conversation + deep report ────────────────
  if (method === "POST" && url.startsWith("/api/chat")) return handleChatApi(req, res);
  if (method === "POST" && url.startsWith("/api/report/generate")) return handleReportGenerateApi(req, res);

  // ── Discover（P6 发现层：筛选器 + 宏观，不绑定公司） ────
  if (method === "POST" && url.startsWith("/api/discover")) return handleDiscoverApi(req, res);

  // ── Event engine digest ────────────────────────────────
  if (method === "GET" && url.startsWith("/api/events/digest")) return handleEventsDigest(req, res);

  // ── 港股一手财报（P7：HKEX 业绩公告 PDF 管道） ──────────
  if (method === "POST" && url.startsWith("/api/hk-financials/ingest")) return handleHkFinancialsIngest(req, res);
  if (method === "GET" && url.startsWith("/api/hk-financials")) return handleHkFinancialsList(req, res);

  // ── Notifications (通知中心 + 定时任务状态) ─────────────
  if (method === "GET" && url.startsWith("/api/notifications/unread")) return handleNotificationsUnread(req, res);
  if (method === "POST" && url.startsWith("/api/notifications/read")) return handleNotificationsRead(req, res);
  if (method === "POST" && url.startsWith("/api/notifications/test")) return handleNotificationsTest(req, res);
  if (method === "GET" && url.startsWith("/api/notifications")) return handleNotificationsList(req, res);
  if (method === "GET" && url.startsWith("/api/scheduler/status")) return handleSchedulerStatus(req, res);

  // ── Watch (看盘：关注列表聚合 / 公司页 / 手动增删关注) ──
  if (method === "GET" && url.startsWith("/api/watch/stock")) return handleWatchStock(req, res);
  if (method === "GET" && url.startsWith("/api/watch/desk")) return handleWatchDesk(req, res);
  if (method === "POST" && url.startsWith("/api/watch/track")) return handleWatchTrack(req, res);
  if (method === "POST" && url.startsWith("/api/watch/untrack")) return handleWatchUntrack(req, res);

  // ── Portfolio (natural-language ledger + manual edit) ──
  if (method === "GET" && url.startsWith("/api/portfolio/review")) return handlePortfolioReview(req, res);
  if (method === "GET" && url.startsWith("/api/portfolio/snapshots")) return handlePortfolioSnapshots(req, res);
  if (method === "GET" && url.startsWith("/api/portfolio")) return handlePortfolioList(req, res);
  if (method === "POST" && url.startsWith("/api/portfolio")) return handlePortfolioUpsert(req, res);
  if (method === "DELETE" && url.startsWith("/api/portfolio")) return handlePortfolioDelete(req, res);

  // ── Company portraits (long-term memory) ───────────────
  if (method === "GET" && url.startsWith("/api/company/profiles")) return handleProfileList(req, res);
  if (method === "GET" && url.startsWith("/api/company/review")) return handleProfileReview(req, res);
  if (method === "GET" && url.startsWith("/api/company/profile")) return handleProfileGet(req, res);
  if (method === "DELETE" && url.startsWith("/api/company/profile")) return handleProfileDelete(req, res);

  // ── R7 研究记分卡（全局）────────────────────────────────
  if (method === "GET" && url.startsWith("/api/research/scorecard")) return handleResearchScorecard(req, res);

  // ── Research sessions ──────────────────────────────────
  if (method === "GET" && url.startsWith("/api/research/conversations")) return handleConversationList(req, res);
  if (method === "GET" && url.startsWith("/api/research/sessions") && !url.includes("/api/research/sessions/")) return handleSessionList(req, res);
  if (method === "DELETE" && url.split("?")[0] === "/api/research/sessions") return handleSessionClear(req, res);
  if (method === "GET" && /^\/api\/research\/sessions\/[^/]+$/.test(url.split("?")[0])) {
    const id = url.replace("/api/research/sessions/", "").split("?")[0];
    return handleSessionGet(req, res, id);
  }
  if (method === "DELETE" && /^\/api\/research\/sessions\/[^/]+$/.test(url.split("?")[0])) {
    const id = url.replace("/api/research/sessions/", "").split("?")[0];
    return handleSessionDelete(req, res, id);
  }

  // ── Static files（E11 白名单，红线 19）────────────────────
  // 名单内的真实文件才发；名单外（含 /.env、/echo.db、docs/、src/server/**）与
  // 不存在的路径一律回 SPA 壳——对外不区分"被拒"和"不存在"，不泄露文件布局。
  if (method === "GET" || method === "HEAD") {
    const pathname = normalizedPathname(url);
    if (isAllowedStaticPath(pathname)) {
      try {
        const filePath = resolvePath(url);
        const body = await readFile(filePath);
        res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
        res.end(body);
        return;
      } catch { /* 名单内但文件缺失：落到下面的 SPA 壳 */ }
    }
    try {
      const body = await readFile(join(root, "index.html"));
      res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
      res.end(body);
      return;
    } catch { /* index.html 都读不到：落到 404 */ }
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

// E11：限速桶按小时清理闲置 key，防止长期运行下 Map 膨胀。
setInterval(() => { generalBucket.prune(); heavyBucket.prune(); }, 3600_000).unref();

// 全局兜底：单用户本地研究工具，保活 >> 崩溃。任何漏网的 unhandled rejection / uncaught
// exception 只记日志，绝不让 Node 24 据此杀进程（A-P0.1：一条坏请求曾掀翻整个后台）。
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

server.listen(port, "127.0.0.1", () => {
  console.log(`Echo Research is running at http://127.0.0.1:${port}`);
  // 定时任务（盘前速报/触线巡检）随服务启动；ECHO_DISABLE_SCHEDULER=1 可关。
  startScheduler();
});
