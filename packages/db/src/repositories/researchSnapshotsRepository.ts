import { and, asc, eq, sql } from "drizzle-orm";
import { researchSnapshots } from "../schema/research.js";
import { numberOrNull, numeric, withTenant } from "./context.js";

function hydrate(row: typeof researchSnapshots.$inferSelect) {
  return { id: row.id, ticker: row.ticker, snapshotDate: row.validTime, thesis: row.thesis || "",
    valuationPosition: row.valuationPosition || null, valuationBear: numberOrNull(row.valuationBear), valuationBase: numberOrNull(row.valuationBase),
    valuationBull: numberOrNull(row.valuationBull), valuationCurrency: row.valuationCurrency || null,
    priceAtSnapshot: numberOrNull(row.priceAtSnapshot), falsifiers: row.falsifiers || [], sessionId: row.sessionId || null,
    createdAt: row.knowledgeTime.toISOString() };
}

export async function insertResearchSnapshot(input: any) {
  const userId = input.userId || "local";
  try {
    await withTenant(userId, (tx) => tx.insert(researchSnapshots).values({ userId, ticker: String(input.ticker || "").toUpperCase(),
      validTime: input.snapshotDate, thesis: input.thesis ?? null, valuationPosition: input.valuationPosition ?? null,
      valuationBear: numeric(input.valuationBear), valuationBase: numeric(input.valuationBase), valuationBull: numeric(input.valuationBull),
      valuationCurrency: input.valuationCurrency ?? null, priceAtSnapshot: numeric(input.priceAtSnapshot),
      falsifiers: Array.isArray(input.falsifiers) ? input.falsifiers.slice(0, 6) : [], sessionId: input.sessionId ?? null }));
  } catch (error) { console.error("[researchSnapshots] 写入失败：", error); }
}

export async function listSnapshots(ticker: string, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(researchSnapshots).where(and(
    eq(researchSnapshots.userId, userId), eq(researchSnapshots.ticker, String(ticker || "").toUpperCase())
  )).orderBy(asc(researchSnapshots.id))).map(hydrate));
}

export async function listSnapshotTickers(userId = "local") {
  return withTenant(userId, async (tx) => Array.from(await tx.execute(sql`
    select ticker, min(knowledge_time) as "firstSnapshotAt", max(knowledge_time) as "lastSnapshotAt", count(*)::int as "snapshotCount"
    from research_snapshots where user_id = ${userId} group by ticker order by ticker
  `)) as Array<{ ticker: string; firstSnapshotAt: Date; lastSnapshotAt: Date; snapshotCount: number }>);
}
