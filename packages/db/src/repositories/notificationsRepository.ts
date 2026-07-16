import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { notifications } from "../schema/notifications.js";
import { notificationEnabled, isInQuietHours } from "./userPreferencesRepository.js";
import { withTenant } from "./context.js";

function hydrate(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body || "",
    ticker: row.ticker || null,
    payload: row.payload || null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() || null
  };
}

/**
 * 用户的通知偏好在这里生效，不在各调用方。
 *
 * `notificationEnabled` 此前全仓库零调用——设置页的 5 个开关一个都不起作用，关掉证伪
 * 告警照样推。根因是"每个调用方各自记得查一遍"，而 5 处调用点没有一处记得。这里已经是
 * dedupe 策略的咽喉（"这条通知该不该产生"本来就归它管），偏好检查放同一处，
 * 新增调用方无从遗漏。
 */
export async function insertNotification({ kind, title, body = "", ticker = null, payload = null, dedupeKey = null, dedupeWindowHours = 12, userId = "local" }: {
  kind: string; title: string; body?: string; ticker?: string | null; payload?: unknown; dedupeKey?: string | null; dedupeWindowHours?: number; userId?: string;
}) {
  if (!await notificationEnabled(userId, kind)) return null;
  const URGENT_KINDS = ["falsify_alert", "position_alert"];
  if (!URGENT_KINDS.includes(kind) && await isInQuietHours(userId)) return null;
  return withTenant(userId, async (tx) => {
    if (dedupeKey) {
      const cutoff = new Date(Date.now() - Math.max(1, Math.round(dedupeWindowHours)) * 3_600_000);
      const duplicate = await tx.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.userId, userId), eq(notifications.dedupeKey, dedupeKey), gte(notifications.createdAt, cutoff)
      )).limit(1);
      if (duplicate.length) return null;
    }
    const [saved] = await tx.insert(notifications).values({
      userId,
      kind: String(kind || "system"),
      title: String(title || "").slice(0, 300),
      body: String(body || "").slice(0, 4000),
      ticker,
      payload,
      dedupeKey
    }).returning({ id: notifications.id });
    return { id: saved.id };
  });
}

export async function listNotifications(limit = 20, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.id)).limit(Math.min(100, Math.max(1, limit)))).map(hydrate));
}

export async function unreadCount(userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select({ value: count() }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))))[0]?.value || 0);
}

export async function markRead(id: string | number, userId = "local") {
  await withTenant(userId, (tx) => tx.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.userId, userId), eq(notifications.id, Number(id)), isNull(notifications.readAt)
  )));
}

export async function markAllRead(userId = "local") {
  await withTenant(userId, (tx) => tx.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))));
}
