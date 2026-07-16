import { eq, and } from "drizzle-orm";
import { plans, subscriptions } from "../schema/billing.js";
import { database } from "./context.js";

export async function listPlans(activeOnly = true) {
  if (activeOnly) {
    return database().select().from(plans).where(eq(plans.active, true));
  }
  return database().select().from(plans);
}

export async function getSubscription(userId: string) {
  const [row] = await database()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function createSubscription(
  userId: string,
  planId: string,
  periodStart: Date,
  periodEnd: Date,
  externalId?: string
) {
  const id = crypto.randomUUID();
  const [row] = await database()
    .insert(subscriptions)
    .values({
      id,
      userId,
      planId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      externalId: externalId ?? null
    })
    .returning();
  return row;
}

export async function cancelSubscription(subscriptionId: string) {
  const [row] = await database()
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId))
    .returning();
  return row ?? null;
}
