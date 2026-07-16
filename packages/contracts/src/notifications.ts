/**
 * Notification and orchestration-status contracts.
 *
 *   GET  /api/notifications         → {notifications, unread}
 *   GET  /api/notifications/unread  → {unread}
 *   POST /api/notifications/read    → {id?} | {all:true} → {unread}
 *   POST /api/notifications/test    → {inserted}
 *   GET  /api/scheduler/status      → {scheduler}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

/** Mirrors repositories/notificationsRepository.js hydrate(). */
export const notificationSchema = z.object({
  id: z.number(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  ticker: z.string().nullable(),
  payload: z.unknown().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable()
});

export const notificationsListResponseSchema = okEnvelope(
  z.object({
    notifications: z.array(notificationSchema),
    unread: z.number()
  })
);

export const notificationsUnreadResponseSchema = okEnvelope(z.object({ unread: z.number() }));

export const notificationsReadRequestSchema = z.union([
  z.object({ id: z.union([z.number(), z.string()]) }),
  z.object({ all: z.literal(true) })
]);
export const notificationsReadResponseSchema = okEnvelope(z.object({ unread: z.number() }));

export const notificationsTestResponseSchema = okEnvelope(z.object({ inserted: z.literal(true) }));

export const schedulerStatusResponseSchema = okEnvelope(
  z.object({
    scheduler: z.record(z.string(), z.unknown())
  })
);
