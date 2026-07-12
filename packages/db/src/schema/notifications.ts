/**
 * notifications.ts — src/db/migrations/001_init.sql + 018_multiuser.sql (index only,
 * user_id already existed from 001).
 * payload is a per-notification-kind blob (shape depends on `kind`: price-line hit,
 * earnings surprise, system message, ...) — genuinely polymorphic -> kept as JSONB.
 */
import { pgTable, text, bigserial, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./core";

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    ticker: text("ticker").references(() => companies.ticker),
    payload: jsonb("payload"),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true })
  },
  (t) => ({
    readIdx: index("idx_notif_read").on(t.readAt),
    dedupeIdx: index("idx_notif_dedupe").on(t.dedupeKey, t.createdAt),
    userIdx: index("idx_notif_user").on(t.userId, t.readAt)
  })
);
