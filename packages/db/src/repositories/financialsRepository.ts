import { count, desc, eq, ilike, sql } from "drizzle-orm";
import { companies } from "../schema/core.js";
import { hkFilingIngestLog, hkFinancials } from "../schema/financials.js";
import { database, numberOrNull, numeric } from "./context.js";

type FinancialTable = typeof hkFinancials;
type LogTable = typeof hkFilingIngestLog;

function values(row: any) {
  return {
    ticker: row.ticker, periodLabel: row.periodLabel ?? null, validTime: row.periodEnd ?? null,
    periodType: row.periodType ?? null, currency: row.currency ?? null, unitLabel: row.unitLabel ?? null,
    revenue: numeric(row.revenue), revenuePrior: numeric(row.revenuePrior), grossProfit: numeric(row.grossProfit),
    grossProfitPrior: numeric(row.grossProfitPrior), operatingIncome: numeric(row.operatingIncome),
    operatingIncomePrior: numeric(row.operatingIncomePrior), netIncome: numeric(row.netIncome), netIncomePrior: numeric(row.netIncomePrior),
    netIncomeAttributable: numeric(row.netIncomeAttributable), eps: numeric(row.eps), operatingCashFlow: numeric(row.operatingCashFlow),
    cashAndEquivalents: numeric(row.cashAndEquivalents), netCash: numeric(row.netCash), sourceTitle: row.sourceTitle ?? null,
    sourceUrl: row.sourceUrl, publishedAt: row.publishedAt ? new Date(row.publishedAt) : null, knowledgeTime: new Date()
  };
}

function hydrate(row: any) {
  return {
    id: row.id, ticker: row.ticker, period_label: row.periodLabel, period_end: row.validTime, period_type: row.periodType,
    currency: row.currency, unit_label: row.unitLabel, revenue: numberOrNull(row.revenue), revenue_prior: numberOrNull(row.revenuePrior),
    gross_profit: numberOrNull(row.grossProfit), gross_profit_prior: numberOrNull(row.grossProfitPrior),
    operating_income: numberOrNull(row.operatingIncome), operating_income_prior: numberOrNull(row.operatingIncomePrior),
    net_income: numberOrNull(row.netIncome), net_income_prior: numberOrNull(row.netIncomePrior),
    net_income_attributable: numberOrNull(row.netIncomeAttributable), eps: numberOrNull(row.eps),
    operating_cash_flow: numberOrNull(row.operatingCashFlow), cash_and_equivalents: numberOrNull(row.cashAndEquivalents),
    net_cash: numberOrNull(row.netCash), source_title: row.sourceTitle, source_url: row.sourceUrl,
    published_at: row.publishedAt?.toISOString() || null, extracted_at: row.knowledgeTime.toISOString()
  };
}

export function createFinancialsRepository(table: FinancialTable, logTable: LogTable) {
  return {
    async upsert(row: any) {
      const input = values(row);
      await database().insert(table as any).values(input).onConflictDoUpdate({ target: (table as any).sourceUrl, set: input });
    },
    async list(ticker: string, limit = 4) {
      const rows = await database().select().from(table as any).where(eq((table as any).ticker, ticker))
        .orderBy(desc(sql`coalesce(${(table as any).validTime}, ${(table as any).publishedAt}::text)`)).limit(limit);
      return rows.map(hydrate);
    },
    async hasUrl(sourceUrl: string) {
      return (await database().select({ id: (table as any).id }).from(table as any).where(eq((table as any).sourceUrl, sourceUrl)).limit(1)).length > 0;
    },
    async upsertLog(input: any) {
      const now = new Date();
      const row = { ticker: input.ticker, status: input.status, detail: input.detail ?? null,
        announcementsFound: input.announcementsFound || 0, ingestedCount: input.ingestedCount || 0, validTime: now, knowledgeTime: now };
      await database().insert(logTable as any).values(row).onConflictDoUpdate({ target: (logTable as any).ticker, set: row });
    },
    async coverage() {
      const tickerCondition = ilike(companies.ticker, "%.HK");
      const total = Number((await database().select({ value: count() }).from(companies).where(tickerCondition))[0]?.value || 0);
      const withFirstParty = Number((await database().select({ value: sql<number>`count(distinct ${(table as any).ticker})` }).from(table as any))[0]?.value || 0);
      const checked = Number((await database().select({ value: count() }).from(logTable as any))[0]?.value || 0);
      const failed = Array.from(await database().execute(sql.raw(`
        select l.ticker, c.name_zh as company_name, l.status, l.detail, l.knowledge_time as checked_at
        from hk_filing_ingest_log l
        left join companies c on c.ticker = l.ticker where l.status != 'ok'
        order by l.knowledge_time desc limit 50
      `)));
      return { totalHk: total, withFirstParty, checked, uncheckedCount: Math.max(0, total - checked), failed };
    }
  };
}

export const hkRepository = createFinancialsRepository(hkFinancials, hkFilingIngestLog);
