import { and, desc, eq, inArray } from "drizzle-orm";
import { portfolioSnapshots, portfolioSnapshotTotals } from "../schema/portfolio.js";
import { numberOrNull, numeric, withTenant } from "./context.js";

export async function upsertSnapshot(snapshot: any, userId = "local") {
  await withTenant(userId, async (tx) => {
    const values = { userId, validTime: snapshot.date, totalValueUsd: numeric(snapshot.totalValueUsd), totalCostUsd: numeric(snapshot.totalCostUsd),
      totalPnlUsd: numeric(snapshot.totalPnlUsd), positionCount: snapshot.positionCount, knowledgeTime: new Date() };
    await tx.insert(portfolioSnapshots).values(values).onConflictDoUpdate({ target: [portfolioSnapshots.userId, portfolioSnapshots.validTime], set: values });
    await tx.delete(portfolioSnapshotTotals).where(and(eq(portfolioSnapshotTotals.userId, userId), eq(portfolioSnapshotTotals.snapshotValidTime, snapshot.date)));
    if (snapshot.totals?.length) await tx.insert(portfolioSnapshotTotals).values(snapshot.totals.map((item: any) => ({
      userId, snapshotValidTime: snapshot.date, currency: item.currency, marketValue: numeric(item.marketValue)!
    })));
  });
}

export async function listSnapshots(limit = 180, userId = "local") {
  return withTenant(userId, async (tx) => {
    const rows = (await tx.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId))
      .orderBy(desc(portfolioSnapshots.validTime)).limit(limit)).reverse();
    if (!rows.length) return [];
    const dates = rows.map((row) => row.validTime);
    const totals = await tx.select().from(portfolioSnapshotTotals).where(and(eq(portfolioSnapshotTotals.userId, userId), inArray(portfolioSnapshotTotals.snapshotValidTime, dates)));
    return rows.map((row) => ({ date: row.validTime, totalValueUsd: numberOrNull(row.totalValueUsd), totalCostUsd: numberOrNull(row.totalCostUsd),
      totalPnlUsd: numberOrNull(row.totalPnlUsd), positionCount: row.positionCount,
      totals: totals.filter((item) => item.snapshotValidTime === row.validTime).map((item) => ({ currency: item.currency, marketValue: numberOrNull(item.marketValue) })) }));
  });
}
