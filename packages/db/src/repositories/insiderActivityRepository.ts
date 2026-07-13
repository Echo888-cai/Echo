import { eq } from "drizzle-orm";
import { insiderActivity } from "../schema/financials.js";
import { database, numberOrNull, numeric } from "./context.js";

function hydrate(row: typeof insiderActivity.$inferSelect | undefined) {
  if (!row) return null;
  return {
    ticker: row.ticker, provider_status: row.providerStatus, net_shares: numberOrNull(row.netShares),
    net_value_usd: numberOrNull(row.netValueUsd), buy_count: row.buyCount, sell_count: row.sellCount,
    distinct_insiders: row.distinctInsiders, last_transaction_at: row.validTime?.toISOString() || null,
    transactions_json: row.transactions ? JSON.stringify(row.transactions) : null, detail: row.detail,
    fetched_at: row.knowledgeTime.toISOString()
  };
}

export async function getInsiderActivityRow(ticker: string) {
  return hydrate((await database().select().from(insiderActivity).where(eq(insiderActivity.ticker, ticker)).limit(1))[0]);
}

export async function upsertInsiderActivity(input: any) {
  const values = {
    ticker: input.ticker, providerStatus: input.providerStatus, netShares: numeric(input.netShares), netValueUsd: numeric(input.netValueUsd),
    buyCount: input.buyCount ?? null, sellCount: input.sellCount ?? null, distinctInsiders: input.distinctInsiders ?? null,
    validTime: input.lastTransactionAt ? new Date(input.lastTransactionAt) : null,
    transactions: Array.isArray(input.transactions) && input.transactions.length ? input.transactions.slice(0, 10) : null,
    detail: input.detail ?? null, knowledgeTime: new Date()
  };
  await database().insert(insiderActivity).values(values).onConflictDoUpdate({ target: insiderActivity.ticker, set: values });
}
