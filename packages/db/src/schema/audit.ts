import { pgTable, text, bigserial, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    detail: jsonb("detail"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    userIdx: index("idx_audit_log_user").on(t.userId, t.createdAt),
    actionIdx: index("idx_audit_log_action").on(t.action, t.createdAt),
    resourceIdx: index("idx_audit_log_resource").on(t.resource, t.resourceId)
  })
);
