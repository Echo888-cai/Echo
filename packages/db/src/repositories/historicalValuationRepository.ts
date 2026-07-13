import { asc, eq } from "drizzle-orm";
import { historicalValuation, historicalValuationPoints } from "../schema/financials.js";
import { database, numberOrNull, numeric } from "./context.js";

export async function getHistoricalValuationRow(ticker: string) {
  const parent = (await database().select().from(historicalValuation).where(eq(historicalValuation.ticker, ticker)).limit(1))[0];
  if (!parent) return null;
  const points = await database().select().from(historicalValuationPoints)
    .where(eq(historicalValuationPoints.ticker, ticker)).orderBy(asc(historicalValuationPoints.periodEndDate));
  return {
    ticker,
    provider_status: parent.providerStatus,
    series_json: points.length ? JSON.stringify(points.map((point) => ({ period: point.periodEndDate, value: numberOrNull(point.peValue) }))) : null,
    detail: parent.detail,
    fetched_at: parent.knowledgeTime.toISOString()
  };
}

export async function upsertHistoricalValuationSeries({ ticker, series = [], providerStatus, detail = null }: any) {
  await database().transaction(async (tx) => {
    await tx.insert(historicalValuation).values({ ticker, providerStatus, detail, knowledgeTime: new Date() })
      .onConflictDoUpdate({ target: historicalValuation.ticker, set: { providerStatus, detail, knowledgeTime: new Date() } });
    await tx.delete(historicalValuationPoints).where(eq(historicalValuationPoints.ticker, ticker));
    if (Array.isArray(series) && series.length) {
      await tx.insert(historicalValuationPoints).values(series.map((point: any) => ({
        ticker, periodEndDate: String(point.period), peValue: numeric(point.value)
      })));
    }
  });
}
