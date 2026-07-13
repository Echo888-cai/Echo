import { and, count, desc, eq } from "drizzle-orm";
import { documents } from "../schema/misc.js";
import { withTenant } from "./context.js";

function hydrate(row: typeof documents.$inferSelect) {
  return {
    id: row.id, user_id: row.userId, ticker: row.ticker, name: row.name, mime_type: row.mimeType,
    size: row.size, parser: row.parser, text: row.text, summary: row.summary, source_type: row.sourceType,
    source_url: row.sourceUrl, created_at: row.createdAt.toISOString()
  };
}

export async function addDocument(input: any) {
  const userId = input.userId || "local";
  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await withTenant(userId, (tx) => tx.insert(documents).values({
    id, userId, ticker: input.ticker ?? null, name: input.name, mimeType: input.mimeType ?? null,
    size: input.size ?? null, parser: input.parser ?? null, text: input.text ?? null, summary: input.summary ?? null,
    sourceType: input.sourceType || "upload", sourceUrl: input.sourceUrl ?? null
  }));
  return id;
}

export async function getDocuments({ ticker = null, limit = 20, userId = "local" }: any = {}) {
  return withTenant(userId, async (tx) => (await tx.select().from(documents).where(ticker
    ? and(eq(documents.userId, userId), eq(documents.ticker, ticker))
    : eq(documents.userId, userId)).orderBy(desc(documents.createdAt)).limit(limit)).map(hydrate));
}

export async function getDocument(id: string, userId = "local") {
  return withTenant(userId, async (tx) => {
    const row = (await tx.select().from(documents).where(and(eq(documents.userId, userId), eq(documents.id, id))).limit(1))[0];
    return row ? hydrate(row) : null;
  });
}

export async function deleteDocument(id: string, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.delete(documents).where(and(eq(documents.userId, userId), eq(documents.id, id)))
    .returning({ id: documents.id })).length > 0);
}

export async function getDocumentsCount(userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select({ value: count() }).from(documents).where(eq(documents.userId, userId)))[0]?.value || 0);
}
