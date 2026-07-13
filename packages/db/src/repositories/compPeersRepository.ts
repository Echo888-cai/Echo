import { eq } from "drizzle-orm";
import { compPeers } from "../schema/financials.js";
import { database } from "./context.js";

function hydrate(row: typeof compPeers.$inferSelect | undefined) {
  if (!row) return null;
  return {
    ticker: row.ticker,
    stage: row.stage,
    peers_json: row.peers ? JSON.stringify(row.peers) : null,
    anchor_json: row.anchor ? JSON.stringify(row.anchor) : null,
    provider_status: row.providerStatus,
    detail: row.detail,
    partial: row.partial ? 1 : 0,
    fetched_at: row.knowledgeTime.toISOString()
  };
}

export async function getCompPeersRow(ticker: string) {
  return hydrate((await database().select().from(compPeers).where(eq(compPeers.ticker, ticker)).limit(1))[0]);
}

export async function upsertCompPeers(input: { ticker: string; stage?: string | null; peers?: unknown[]; anchor?: unknown; providerStatus: string; detail?: string | null; partial?: boolean }) {
  const now = new Date();
  await database().insert(compPeers).values({
    ticker: input.ticker, stage: input.stage ?? null, peers: input.peers || [], anchor: input.anchor ?? null,
    providerStatus: input.providerStatus, detail: input.detail ?? null, partial: Boolean(input.partial), validTime: now, knowledgeTime: now
  }).onConflictDoUpdate({ target: compPeers.ticker, set: {
    stage: input.stage ?? null, peers: input.peers || [], anchor: input.anchor ?? null,
    providerStatus: input.providerStatus, detail: input.detail ?? null, partial: Boolean(input.partial), validTime: now, knowledgeTime: now
  } });
}
