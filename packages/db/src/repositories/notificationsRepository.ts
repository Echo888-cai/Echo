import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { notifications } from "../schema/notifications.js";
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

export async function insertNotification({ kind, title, body = "", ticker = null, payload = null, dedupeKey = null, dedupeWindowHours = 12, userId = "local" }: {
  kind: string; title: string; body?: string; ticker?: string | null; payload?: unknown; dedupeKey?: string | null; dedupeWindowHours?: number; userId?: string;
}) {
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
