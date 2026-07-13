import { and, desc, eq } from "drizzle-orm";
import { watchlistPrefs } from "../schema/portfolio.js";
import { normalizeTicker, withTenant } from "./context.js";

export async function listWatchAdds(userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(watchlistPrefs).where(and(
    eq(watchlistPrefs.userId, userId), eq(watchlistPrefs.mode, "add")
  )).orderBy(desc(watchlistPrefs.createdAt))).map((row) => ({ ticker: row.ticker, nameZh: row.companyName || row.ticker })));
}

export async function getHiddenTickers(userId = "local") {
  return withTenant(userId, async (tx) => new Set((await tx.select({ ticker: watchlistPrefs.ticker }).from(watchlistPrefs).where(and(
    eq(watchlistPrefs.userId, userId), eq(watchlistPrefs.mode, "hide")
  ))).map((row) => row.ticker)));
}

export async function addToWatch(ticker: string, name?: string, userId = "local") {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return false;
  await withTenant(userId, (tx) => tx.insert(watchlistPrefs).values({ userId, ticker: normalized, companyName: name || null, mode: "add" })
    .onConflictDoUpdate({ target: [watchlistPrefs.userId, watchlistPrefs.ticker], set: { mode: "add", ...(name ? { companyName: name } : {}), createdAt: new Date() } }));
  return true;
}

export async function removeFromWatch(ticker: string, userId = "local") {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return false;
  await withTenant(userId, (tx) => tx.insert(watchlistPrefs).values({ userId, ticker: normalized, companyName: null, mode: "hide" })
    .onConflictDoUpdate({ target: [watchlistPrefs.userId, watchlistPrefs.ticker], set: { mode: "hide", createdAt: new Date() } }));
  return true;
}
