/**
 * notifier — 通知的唯一入口：落库（Web 通知中心）+ 尽力推送（Telegram）。
 *
 * 设计原则：
 *   1. 落库是主路径，永远先落库；Telegram 只是"同一条通知的手机出口"，失败不影响主路径。
 *   2. 无 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 时静默跳过推送，Web 通知照常。
 *   3. 纯 fetch 调 Telegram Bot API，不引依赖。
 *
 * 配置（.env）：
 *   TELEGRAM_BOT_TOKEN  找 @BotFather 建 bot 拿 token
 *   TELEGRAM_CHAT_ID    给 bot 发条消息后访问
 *                       https://api.telegram.org/bot<token>/getUpdates 取 chat.id
 */

import { insertNotification } from "../repositories/notifications.js";

const TG_TIMEOUT_MS = 8000;

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

/** 发一条 Telegram 文本（纯文本，避免 Markdown 转义坑）。返回 "sent"|"skipped"|"failed:<原因>"。 */
export async function sendTelegram(text) {
  if (!telegramConfigured()) return "skipped";
  const token = process.env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: String(text || "").slice(0, 4000), disable_web_page_preview: true }),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return `failed:HTTP ${res.status}${detail ? ` ${detail.slice(0, 120)}` : ""}`;
    }
    return "sent";
  } catch (err) {
    return `failed:${err?.name === "AbortError" ? "timeout" : err?.message || "network"}`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 发出一条通知：落库 + 尽力 Telegram。
 * @returns {{ ok:true, id?:number, deduped?:boolean, telegram:string }}
 */
export async function notify({ kind, title, body = "", ticker = null, payload = null, dedupeKey = null, dedupeWindowHours = 12 }) {
  const inserted = insertNotification({ kind, title, body, ticker, payload, dedupeKey, dedupeWindowHours });
  if (!inserted) return { ok: true, deduped: true, telegram: "skipped" };
  const telegram = await sendTelegram(body ? `${title}\n\n${body}` : title);
  if (telegram.startsWith("failed")) console.error(`[notifier] Telegram 推送失败：${telegram}（通知已落库 #${inserted.id}）`);
  return { ok: true, id: inserted.id, telegram };
}
