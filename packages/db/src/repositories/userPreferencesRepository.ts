import { eq } from "drizzle-orm";
import { userPreferences } from "../schema/misc.js";
import { withTenant } from "./context.js";

const defaults = {
  onboardingCompleted: false,
  notifyDigest: true,
  notifyPositions: true,
  notifyFalsify: true,
  notifyReview: true,
  notifyEarnings: true
};

type Preferences = typeof defaults;

function hydrate(row: typeof userPreferences.$inferSelect | undefined): Preferences {
  if (!row) return { ...defaults };
  return {
    onboardingCompleted: row.onboardingCompleted,
    notifyDigest: row.notifyDigest,
    notifyPositions: row.notifyPositions,
    notifyFalsify: row.notifyFalsify,
    notifyReview: row.notifyReview,
    notifyEarnings: row.notifyEarnings
  };
}

export async function getUserPreferences(userId = "local") {
  return withTenant(userId, async (tx) => hydrate((await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1))[0]));
}

export async function updateUserPreferences(userId = "local", patch: Partial<Preferences> = {}) {
  return withTenant(userId, async (tx) => {
    const current = hydrate((await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1))[0]);
    const next = { ...current };
    for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
      if (typeof patch[key] === "boolean") next[key] = patch[key];
    }
    const [saved] = await tx.insert(userPreferences).values({ userId, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { ...next, updatedAt: new Date() } }).returning();
    return hydrate(saved);
  });
}

const kindPreference: Record<string, keyof Preferences> = {
  digest: "notifyDigest",
  position_alert: "notifyPositions",
  falsify_alert: "notifyFalsify",
  review_reminder: "notifyReview",
  earnings_review: "notifyEarnings"
};

export async function notificationEnabled(userId: string, kind: string) {
  const key = kindPreference[kind];
  return key ? (await getUserPreferences(userId))[key] : true;
}
