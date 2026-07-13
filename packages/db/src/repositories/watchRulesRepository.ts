import { and, asc, eq } from "drizzle-orm";
import { watchRules } from "../schema/portfolio.js";
import { numberOrNull, numeric, withTenant } from "./context.js";

function hydrate(row: typeof watchRules.$inferSelect) {
  return { id: row.id, ticker: row.ticker, kind: row.kind, threshold: numberOrNull(row.threshold), label: row.label || "",
    metric: row.metric || null, source: row.source, sessionId: row.sessionId || null, active: row.active,
    createdAt: row.createdAt.toISOString(), lastTriggeredAt: row.lastTriggeredAt?.toISOString() || null };
}

export async function listRules(ticker: string, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(watchRules).where(and(eq(watchRules.userId, userId),
    eq(watchRules.ticker, String(ticker || "").toUpperCase()), eq(watchRules.active, true))).orderBy(asc(watchRules.id))).map(hydrate));
}

export async function listAllActiveRules(userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(watchRules).where(and(eq(watchRules.userId, userId), eq(watchRules.active, true)))
    .orderBy(asc(watchRules.ticker), asc(watchRules.id))).map(hydrate));
}

export async function replaceFalsifierRules(ticker: string, rules: any[] = [], { sessionId = null, userId = "local" }: any = {}) {
  const normalized = String(ticker || "").toUpperCase();
  if (!normalized) return 0;
  return withTenant(userId, async (tx) => {
    await tx.delete(watchRules).where(and(eq(watchRules.userId, userId), eq(watchRules.ticker, normalized), eq(watchRules.source, "falsifier")));
    if (rules.length) await tx.insert(watchRules).values(rules.map((rule) => ({ userId, ticker: normalized, kind: rule.kind,
      threshold: numeric(rule.threshold)!, label: String(rule.label || "").slice(0, 300), metric: rule.metric || null, source: "falsifier", sessionId })));
    return rules.length;
  });
}

export async function markTriggered(id: number, userId = "local") {
  await withTenant(userId, (tx) => tx.update(watchRules).set({ lastTriggeredAt: new Date() }).where(and(eq(watchRules.userId, userId), eq(watchRules.id, Number(id)))));
}
