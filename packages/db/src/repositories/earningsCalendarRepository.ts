import { and, eq, isNotNull } from "drizzle-orm";
import { earningsCalendar } from "../schema/financials.js";
import { database, numberOrNull, numeric } from "./context.js";

function hydrate(row: typeof earningsCalendar.$inferSelect | undefined) {
  if (!row) return null;
  return {
    ticker: row.ticker, next_date: row.nextDate, quarter: row.quarter, year: row.year,
    eps_estimate: numberOrNull(row.epsEstimate), revenue_estimate: numberOrNull(row.revenueEstimate),
    source: row.source, provider_status: row.providerStatus, detail: row.detail,
    last_date: row.lastDate, last_quarter: row.lastQuarter, last_year: row.lastYear,
    last_eps_estimate: numberOrNull(row.lastEpsEstimate), last_eps_actual: numberOrNull(row.lastEpsActual),
    last_revenue_estimate: numberOrNull(row.lastRevenueEstimate), last_revenue_actual: numberOrNull(row.lastRevenueActual),
    last_eps_surprise_pct: numberOrNull(row.lastEpsSurprisePct), last_revenue_surprise_pct: numberOrNull(row.lastRevenueSurprisePct),
    fetched_at: row.knowledgeTime.toISOString()
  };
}

export async function getEarningsCalendarRow(ticker: string) {
  return hydrate((await database().select().from(earningsCalendar).where(eq(earningsCalendar.ticker, ticker)).limit(1))[0]);
}

export async function upsertEarningsCalendar(input: any) {
  const last = input.lastReported || null;
  const values = {
    ticker: input.ticker, nextDate: input.nextDate ?? null, quarter: input.quarter ?? null, year: input.year ?? null,
    epsEstimate: numeric(input.epsEstimate), revenueEstimate: numeric(input.revenueEstimate), source: input.source ?? null,
    providerStatus: input.providerStatus, detail: input.detail ?? null,
    lastDate: last?.date ?? null, lastQuarter: last?.quarter ?? null, lastYear: last?.year ?? null,
    lastEpsEstimate: numeric(last?.epsEstimate), lastEpsActual: numeric(last?.epsActual),
    lastRevenueEstimate: numeric(last?.revenueEstimate), lastRevenueActual: numeric(last?.revenueActual),
    lastEpsSurprisePct: numeric(last?.epsSurprisePct), lastRevenueSurprisePct: numeric(last?.revenueSurprisePct),
    validTime: last?.date ?? null, knowledgeTime: new Date()
  };
  await database().insert(earningsCalendar).values(values).onConflictDoUpdate({ target: earningsCalendar.ticker, set: values });
}

export async function listWithLastReported() {
  const rows = await database().select().from(earningsCalendar).where(and(
    isNotNull(earningsCalendar.lastYear), isNotNull(earningsCalendar.lastQuarter), isNotNull(earningsCalendar.lastEpsActual)
  ));
  return rows.map((row) => hydrate(row)!);
}
