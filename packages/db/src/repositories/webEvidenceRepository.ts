import { and, desc, eq, gte } from "drizzle-orm";
import { webEvidence } from "../schema/financials.js";
import { database, numberOrNull } from "./context.js";

function hydrate(row: typeof webEvidence.$inferSelect) {
  return {
    id: row.id, ticker: row.ticker, intent: row.intent, query: row.query || "", title: row.title || "", url: row.url,
    source: row.source || "", sourceType: row.sourceType || "", snippet: row.snippet || "",
    publishedAt: row.validTime?.toISOString() || "", fetchedAt: row.knowledgeTime.toISOString(),
    relevanceScore: numberOrNull(row.relevanceScore) || 0, credibilityScore: numberOrNull(row.credibilityScore) || 0,
    contentHash: row.contentHash || "", raw: row.raw || null
  };
}

export async function saveWebEvidence(items: any[] = []) {
  if (!Array.isArray(items) || !items.length) return [];
  await database().transaction(async (tx) => {
    for (const item of items) {
      if (!item?.ticker || !item?.intent || !item?.url) continue;
      const fetchedAt = item.fetchedAt ? new Date(item.fetchedAt) : new Date();
      const values = {
        id: item.id, ticker: item.ticker, intent: item.intent, query: item.query || "", title: item.title || "", url: item.url,
        source: item.source || "", sourceType: item.sourceType || "", snippet: item.snippet || "",
        validTime: item.publishedAt ? new Date(item.publishedAt) : null, knowledgeTime: fetchedAt,
        relevanceScore: String(Number(item.relevanceScore || 0)), credibilityScore: String(Number(item.credibilityScore || 0)),
        contentHash: item.contentHash || "", raw: item.raw || item, updatedAt: new Date()
      };
      await tx.insert(webEvidence).values(values).onConflictDoUpdate({ target: webEvidence.id, set: {
        title: values.title, source: values.source, sourceType: values.sourceType, snippet: values.snippet,
        validTime: values.validTime, knowledgeTime: values.knowledgeTime, relevanceScore: values.relevanceScore,
        credibilityScore: values.credibilityScore, raw: values.raw, updatedAt: values.updatedAt
      } });
    }
  });
  return items;
}

export async function listWebEvidence({ ticker, intent, limit = 12, maxAgeHours = 48 }: any = {}) {
  const cutoff = new Date(Date.now() - Math.max(1, Number(maxAgeHours || 48)) * 3_600_000);
  return (await database().select().from(webEvidence).where(and(
    eq(webEvidence.ticker, ticker), eq(webEvidence.intent, intent), gte(webEvidence.knowledgeTime, cutoff)
  )).orderBy(desc(webEvidence.credibilityScore), desc(webEvidence.relevanceScore), desc(webEvidence.knowledgeTime))
    .limit(Math.max(1, Math.min(50, Number(limit || 12))))).map(hydrate);
}
