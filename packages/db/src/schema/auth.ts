/**
 * auth.ts — users / invite_codes / auth_sessions
 * Source: src/db/migrations/017_users_auth.sql
 */
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  // 'local' is the fixed owner id (see 017 comment) — kept as free-text PK, not a
  // generated UUID, so the existing 'local' convention keeps working unmodified.
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  // format s1$saltHex$hashHex (scrypt N=16384,r=8,p=1) — kept as opaque text, not
  // structured, since it's a self-describing versioned credential blob, not a fact.
  passHash: text("pass_hash").notNull(),
  displayName: text("display_name"),
  role: text("role").notNull().default("member"), // 'owner' | 'member'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true })
});

export const inviteCodes = pgTable("invite_codes", {
  code: text("code").primaryKey(),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedBy: text("used_by"),
  usedAt: timestamp("used_at", { withTimezone: true })
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    // sha256(token) hex — only the hash is stored, never the raw token.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
  },
  (t) => ({
    userIdx: index("idx_auth_sessions_user").on(t.userId),
    expiresIdx: index("idx_auth_sessions_expires").on(t.expiresAt)
  })
);
