import { and, asc, eq, inArray } from "drizzle-orm";
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

/**
 * 先删后插地重建某只票的证伪来源规则。
 *
 * `kinds` 限定删除范围：证伪线有两条互不相干的产出路径——价格线走 parseFalsifierRules
 * 的文本解析，基本面线（kind=fundamental_*）走 F-3 的模型结构化输出。两者都写 source
 * ='falsifier'，若不限定 kind，只掌握价格线的调用方会连带删掉基本面线（反之亦然）。
 * 不传 kinds 时替换全部证伪规则，保持原语义。
 */
export async function replaceFalsifierRules(ticker: string, rules: any[] = [], { sessionId = null, userId = "local", kinds = null }: any = {}) {
  const normalized = String(ticker || "").toUpperCase();
  if (!normalized) return 0;
  return withTenant(userId, async (tx) => {
    await tx.delete(watchRules).where(and(eq(watchRules.userId, userId), eq(watchRules.ticker, normalized), eq(watchRules.source, "falsifier"),
      ...(Array.isArray(kinds) && kinds.length ? [inArray(watchRules.kind, kinds)] : [])));
    if (rules.length) await tx.insert(watchRules).values(rules.map((rule) => ({ userId, ticker: normalized, kind: rule.kind,
      threshold: numeric(rule.threshold)!, label: String(rule.label || "").slice(0, 300), metric: rule.metric || null, source: "falsifier", sessionId })));
    return rules.length;
  });
}

export async function markTriggered(id: number, userId = "local") {
  await withTenant(userId, (tx) => tx.update(watchRules).set({ lastTriggeredAt: new Date() }).where(and(eq(watchRules.userId, userId), eq(watchRules.id, Number(id)))));
}
