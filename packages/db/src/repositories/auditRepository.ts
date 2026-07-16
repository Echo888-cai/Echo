import { desc, eq } from "drizzle-orm";
import { auditLog } from "../schema/audit.js";
import { database } from "./context.js";

export async function logAction(entry: {
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  detail?: unknown;
  ipAddress?: string;
}) {
  const [row] = await database().insert(auditLog).values(entry).returning();
  return row;
}

export async function listAuditLog(userId?: string, limit = 50, offset = 0) {
  let query = database().select().from(auditLog).$dynamic();
  if (userId) query = query.where(eq(auditLog.userId, userId));
  return query.orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset);
}
