/**
 * 通知中心路由：
 *   GET  /api/notifications            → { notifications, unread }（最近 20 条 + 未读数）
 *   GET  /api/notifications/unread     → { unread }（前端 60s 轮询，保持轻）
 *   POST /api/notifications/read       → body {id} 单条已读 / {all:true} 全部已读
 *   POST /api/notifications/test       → 发一条测试通知（验证 Telegram 接线）
 *   GET  /api/scheduler/status         → 定时任务状态（设置页）
 */

import { readJsonBody, sendOk, sendError } from "../utils/async.js";
import { listNotifications, unreadCount, markRead, markAllRead } from "../repositories/notifications.js";
import { notify, telegramConfigured } from "../services/notifier.js";
import { schedulerStatus } from "../services/scheduler.js";
import { beijingMinute } from "../utils/time.js";

const userId = (req) => req.echoUser?.id || "local";

export function handleNotificationsList(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = Number(url.searchParams.get("limit")) || 20;
    const uid = userId(req);
    sendOk(res, { notifications: listNotifications(limit, uid), unread: unreadCount(uid), telegram: telegramConfigured() });
  } catch (error) {
    sendError(res, 500, error.message || "读取通知失败");
  }
}

export function handleNotificationsUnread(req, res) {
  try {
    sendOk(res, { unread: unreadCount(userId(req)) });
  } catch (error) {
    sendError(res, 500, error.message || "读取未读数失败");
  }
}

export async function handleNotificationsRead(req, res) {
  try {
    const body = await readJsonBody(req);
    const uid = userId(req);
    if (body?.all) markAllRead(uid);
    else if (body?.id) markRead(body.id, uid);
    else return sendError(res, 400, "需要 {id} 或 {all:true}");
    sendOk(res, { unread: unreadCount(uid) });
  } catch (error) {
    sendError(res, 500, error.message || "标记已读失败");
  }
}

export async function handleNotificationsTest(req, res) {
  try {
    const result = await notify({
      kind: "system",
      title: "测试通知",
      body: `这是一条来自 Echo Research 的测试通知（${beijingMinute()} 北京时间）。看到即链路正常。`,
      userId: userId(req)
      // 刻意不带 dedupeKey：测试要每次都发
    });
    sendOk(res, { ...result, telegramConfigured: telegramConfigured() });
  } catch (error) {
    sendError(res, 500, error.message || "发送测试通知失败");
  }
}

export function handleSchedulerStatus(req, res) {
  try {
    sendOk(res, { scheduler: schedulerStatus(), telegram: telegramConfigured() });
  } catch (error) {
    sendError(res, 500, error.message || "读取调度状态失败");
  }
}
