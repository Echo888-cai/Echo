import { desc, eq } from "drizzle-orm";
import { feedback } from "../schema/misc.js";
import { withTenant } from "./context.js";

export async function insertFeedback(userId: string, message: string, context: unknown = null) {
  return withTenant(userId, async (tx) => {
    const [saved] = await tx.insert(feedback).values({
      userId,
      message: String(message || "").trim().slice(0, 2000),
      context
    }).returning({ id: feedback.id });
    return saved.id;
  });
}

export async function listFeedback(userId: string, limit = 50) {
  return withTenant(userId, (tx) => tx.select().from(feedback).where(eq(feedback.userId, userId)).orderBy(desc(feedback.id)).limit(limit));
}
