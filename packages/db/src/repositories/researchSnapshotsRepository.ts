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

/**
 * 一天一条：研究是逐轮对话推进的，每轮插一条会让同一天堆出几十条近乎相同的快照，
 * 它们同时"成熟"、同时进 computeTickerScorecard 的分母，等于让最啰嗦的那天决定命中率。
 * 判断的粒度是"某天我们怎么看这家公司"，所以 (user, ticker, valid_time) 唯一，
 * 当天复研究覆盖当天那条（见 0005_research_snapshots_daily_unique.sql）。
 *
 * 写入失败只记日志不抛：快照是复盘用的旁路账，不该让用户的这次研究回答失败。
 */
export async function upsertResearchSnapshot(input: any) {
  const userId = input.userId || "local";
  const values = {
    userId, ticker: String(input.ticker || "").toUpperCase(),
    validTime: input.snapshotDate, thesis: input.thesis ?? null, valuationPosition: input.valuationPosition ?? null,
    valuationBear: numeric(input.valuationBear), valuationBase: numeric(input.valuationBase), valuationBull: numeric(input.valuationBull),
    valuationCurrency: input.valuationCurrency ?? null, priceAtSnapshot: numeric(input.priceAtSnapshot),
    falsifiers: Array.isArray(input.falsifiers) ? input.falsifiers.slice(0, 6) : [], sessionId: input.sessionId ?? null
  };
  try {
    await withTenant(userId, (tx) => tx.insert(researchSnapshots).values(values).onConflictDoUpdate({
      target: [researchSnapshots.userId, researchSnapshots.ticker, researchSnapshots.validTime],
      set: { thesis: values.thesis, valuationPosition: values.valuationPosition, valuationBear: values.valuationBear,
        valuationBase: values.valuationBase, valuationBull: values.valuationBull, valuationCurrency: values.valuationCurrency,
        priceAtSnapshot: values.priceAtSnapshot, falsifiers: values.falsifiers, sessionId: values.sessionId,
        knowledgeTime: new Date() }
    }));
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
