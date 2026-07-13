import { and, desc, eq, gte } from "drizzle-orm";
import { hkBuybacks } from "../schema/financials.js";
import { database, numeric } from "./context.js";

export async function hasHkBuybackForUrl(sourceUrl: string) {
  return (await database().select({ id: hkBuybacks.id }).from(hkBuybacks).where(eq(hkBuybacks.sourceUrl, sourceUrl)).limit(1)).length > 0;
}

export async function upsertHkBuyback(input: any) {
  await database().insert(hkBuybacks).values({
    ticker: input.ticker, tradeDate: input.tradeDate, sharesRepurchased: numeric(input.sharesRepurchased),
    priceHigh: numeric(input.priceHigh), priceLow: numeric(input.priceLow), totalConsideration: numeric(input.totalConsideration),
    currency: input.currency, sharesIssuedTotal: numeric(input.sharesIssuedTotal), periodEndDate: input.periodEndDate ?? null,
    sourceTitle: input.sourceTitle, sourceUrl: input.sourceUrl, publishedAt: input.publishedAt ? new Date(input.publishedAt) : null
  }).onConflictDoNothing({ target: hkBuybacks.sourceUrl });
}

export async function listRecentHkBuybacks(ticker: string, days = 180) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return database().select().from(hkBuybacks).where(and(eq(hkBuybacks.ticker, ticker), gte(hkBuybacks.tradeDate, cutoff)))
    .orderBy(desc(hkBuybacks.tradeDate));
}

export async function getLatestHkBuybackFetchedAt(ticker: string) {
  return (await database().select({ value: hkBuybacks.knowledgeTime }).from(hkBuybacks).where(eq(hkBuybacks.ticker, ticker))
    .orderBy(desc(hkBuybacks.knowledgeTime)).limit(1))[0]?.value.toISOString() || null;
}
