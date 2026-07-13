import { and, desc, eq } from "drizzle-orm";
import { companies } from "../schema/core.js";
import { portfolioPositions } from "../schema/portfolio.js";
import { normalizeTicker, numberOrNull, numeric, withTenant } from "./context.js";

function hydrate(row: typeof portfolioPositions.$inferSelect | undefined) {
  if (!row) return null;
  return {
    ticker: row.ticker,
    companyName: row.companyName || row.ticker,
    shares: numberOrNull(row.shares),
    avgCost: numberOrNull(row.avgCost),
    stopLoss: numberOrNull(row.stopLoss),
    takeProfit: numberOrNull(row.takeProfit),
    note: row.note || "",
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function getPosition(ticker: string, userId = "local") {
  const normalized = normalizeTicker(ticker);
  return withTenant(userId, async (tx) => hydrate((await tx.select().from(portfolioPositions)
    .where(and(eq(portfolioPositions.userId, userId), eq(portfolioPositions.ticker, normalized))).limit(1))[0]));
}

export async function listPositions(userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(portfolioPositions)
    .where(eq(portfolioPositions.userId, userId)).orderBy(desc(portfolioPositions.updatedAt))).map((row) => hydrate(row)!));
}

export async function upsertPosition(ticker: string, patch: {
  companyName?: string; shares?: number; avgCost?: number; stopLoss?: number; takeProfit?: number; note?: string;
} = {}, userId = "local") {
  const normalized = normalizeTicker(ticker);
  return withTenant(userId, async (tx) => {
    const isUs = !normalized.endsWith(".HK") && !/\.(SS|SZ)$/.test(normalized);
    await tx.insert(companies).values({
      ticker: normalized,
      nameZh: patch.companyName || normalized,
      nameEn: isUs ? patch.companyName || normalized : null,
      exchange: isUs ? "US" : normalized.endsWith(".HK") ? "HKEX" : "CN",
      currency: isUs ? "USD" : normalized.endsWith(".HK") ? "HKD" : "CNY"
    }).onConflictDoNothing();
    const existing = hydrate((await tx.select().from(portfolioPositions)
      .where(and(eq(portfolioPositions.userId, userId), eq(portfolioPositions.ticker, normalized))).limit(1))[0]);
    const values = {
      userId,
      ticker: normalized,
      companyName: patch.companyName ?? existing?.companyName ?? normalized,
      shares: numeric(patch.shares ?? existing?.shares),
      avgCost: numeric(patch.avgCost ?? existing?.avgCost),
      stopLoss: numeric(patch.stopLoss ?? existing?.stopLoss),
      takeProfit: numeric(patch.takeProfit ?? existing?.takeProfit),
      note: patch.note ?? existing?.note ?? "",
      updatedAt: new Date()
    };
    const [saved] = await tx.insert(portfolioPositions).values(values).onConflictDoUpdate({
      target: [portfolioPositions.userId, portfolioPositions.ticker],
      set: { ...values, userId: undefined, ticker: undefined }
    }).returning();
    return hydrate(saved);
  });
}

export async function deletePosition(ticker: string, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.delete(portfolioPositions)
    .where(and(eq(portfolioPositions.userId, userId), eq(portfolioPositions.ticker, normalizeTicker(ticker))))
    .returning({ ticker: portfolioPositions.ticker })).length > 0);
}
