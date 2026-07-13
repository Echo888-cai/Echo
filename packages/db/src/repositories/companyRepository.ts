import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { companies, companyDetails, marketSnapshots } from "../schema/core.js";
import { database, normalizeTicker, numberOrNull, numeric } from "./context.js";

function hydrateCompany(row: any) {
  return {
    ticker: row.ticker,
    nameZh: row.nameZh || "",
    nameEn: row.nameEn || "",
    sector: row.sector || "",
    industry: row.industry || "",
    listingStatus: row.listingStatus || "active",
    currency: row.currency || "HKD",
    exchange: row.exchange || "HKEX",
    isHsi: Boolean(row.isHsi),
    hasPortrait: Boolean(row.businessModel?.length),
    aliases: row.aliases || [],
    price: numberOrNull(row.price),
    marketCap: row.marketCap || null,
    week52: row.week52Range || null,
    dividendYield: row.dividendYield || null,
    pe: row.pe || null,
    pb: row.pb || null,
    ps: row.ps || null,
    latestReport: row.latestReport || null,
    status: row.status || null,
    statusTone: row.statusTone || null,
    summary: row.summary || [],
    businessModel: row.businessModel || [],
    metrics: row.metrics || [],
    moat: row.moat || [],
    management: row.management || [],
    risks: row.risks || [],
    bull: row.bullCase || [],
    bear: row.bearCase || [],
    monitors: row.monitors || [],
    officialSources: row.officialSources || []
  };
}

export async function searchCompanies(query: string, { limit = 20 } = {}) {
  const pattern = `%${query}%`;
  const rows = await database().select({
    ticker: companies.ticker,
    nameZh: companies.nameZh,
    nameEn: companies.nameEn,
    sector: companies.sector,
    industry: companies.industry,
    hasPortrait: sql<boolean>`${companyDetails.ticker} is not null`
  }).from(companies).leftJoin(companyDetails, eq(companies.ticker, companyDetails.ticker))
    .where(or(ilike(companies.ticker, pattern), ilike(companies.nameZh, pattern), ilike(companies.nameEn, pattern)))
    .orderBy(
      sql`case when ${companies.ticker} ilike ${pattern} then 0 else 1 end`,
      sql`case when ${companies.nameZh} ilike ${pattern} then 0 else 1 end`,
      asc(companies.nameZh)
    ).limit(limit);
  return rows.map((row) => ({ ...row, hasPortrait: Boolean(row.hasPortrait) }));
}

export async function getCompanyByTickerComplete(ticker: string) {
  const normalized = normalizeTicker(ticker);
  const [row] = await database().select({
    ticker: companies.ticker,
    nameZh: companies.nameZh,
    nameEn: companies.nameEn,
    sector: companies.sector,
    industry: companies.industry,
    listingStatus: companies.listingStatus,
    currency: companies.currency,
    exchange: companies.exchange,
    isHsi: companies.isHsi,
    aliases: companyDetails.aliases,
    price: companyDetails.price,
    marketCap: companyDetails.marketCap,
    week52Range: companyDetails.week52Range,
    dividendYield: companyDetails.dividendYield,
    pe: companyDetails.pe,
    pb: companyDetails.pb,
    ps: companyDetails.ps,
    latestReport: companyDetails.latestReport,
    status: companyDetails.status,
    statusTone: companyDetails.statusTone,
    summary: companyDetails.summary,
    businessModel: companyDetails.businessModel,
    metrics: companyDetails.metrics,
    moat: companyDetails.moat,
    management: companyDetails.management,
    risks: companyDetails.risks,
    bullCase: companyDetails.bullCase,
    bearCase: companyDetails.bearCase,
    monitors: companyDetails.monitors,
    officialSources: companyDetails.officialSources
  }).from(companies).leftJoin(companyDetails, eq(companies.ticker, companyDetails.ticker))
    .where(eq(companies.ticker, normalized)).limit(1);
  return row ? hydrateCompany(row) : null;
}

export async function getLatestMarketSnapshot(ticker: string) {
  const [row] = await database().select().from(marketSnapshots)
    .where(eq(marketSnapshots.ticker, normalizeTicker(ticker)))
    .orderBy(desc(marketSnapshots.validTime), desc(marketSnapshots.id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    ticker: row.ticker,
    price: numberOrNull(row.price),
    previous_close: numberOrNull(row.previousClose),
    change: numberOrNull(row.change),
    change_percent: numberOrNull(row.changePercent),
    open: numberOrNull(row.open),
    high: numberOrNull(row.high),
    low: numberOrNull(row.low),
    volume: numberOrNull(row.volume),
    market_cap: numberOrNull(row.marketCap),
    pe: numberOrNull(row.pe),
    dividend_yield: numberOrNull(row.dividendYield),
    week_52_high: numberOrNull(row.week52High),
    week_52_low: numberOrNull(row.week52Low),
    source: row.source,
    as_of: row.validTime.toISOString(),
    created_at: row.knowledgeTime.toISOString()
  };
}

export async function saveMarketSnapshot(data: any) {
  await database().insert(marketSnapshots).values({
    ticker: normalizeTicker(data.ticker),
    price: numeric(data.price),
    previousClose: numeric(data.previousClose),
    change: numeric(data.change),
    changePercent: numeric(data.changePercent),
    open: numeric(data.open),
    high: numeric(data.high),
    low: numeric(data.low),
    volume: numeric(data.volume),
    marketCap: numeric(data.marketCap),
    pe: numeric(data.pe),
    dividendYield: numeric(data.dividendYield),
    week52High: numeric(data.week52High),
    week52Low: numeric(data.week52Low),
    source: data.source || "api",
    validTime: data.asOf ? new Date(data.asOf) : new Date()
  });
}

function companyRow(row: typeof companies.$inferSelect & { hasPortrait?: boolean }) {
  return {
    ticker: row.ticker,
    name_zh: row.nameZh,
    name_en: row.nameEn,
    sector: row.sector,
    industry: row.industry,
    listing_status: row.listingStatus,
    exchange: row.exchange,
    currency: row.currency,
    market_cap_category: row.marketCapCategory,
    is_hsi: row.isHsi ? 1 : 0,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(row.hasPortrait == null ? {} : { has_portrait: row.hasPortrait ? 1 : 0 })
  };
}

export async function getCompaniesBySector() {
  const rows = await database().select({ ...getTableColumns(companies), hasPortrait: sql<boolean>`${companyDetails.ticker} is not null` })
    .from(companies).leftJoin(companyDetails, eq(companies.ticker, companyDetails.ticker))
    .where(eq(companies.listingStatus, "active")).orderBy(asc(companies.sector), asc(companies.nameZh));
  return rows.reduce<Record<string, ReturnType<typeof companyRow>[]>>((groups, row) => {
    const sector = row.sector || "其他";
    (groups[sector] ||= []).push(companyRow(row));
    return groups;
  }, {});
}

export async function getAllCompanies() {
  return (await database().select().from(companies).orderBy(asc(companies.sector), asc(companies.nameZh))).map(companyRow);
}
