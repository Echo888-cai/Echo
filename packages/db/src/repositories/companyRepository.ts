import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { companies, companyDetails, marketSnapshots } from "../schema/core.js";
import { database, databaseRead, normalizeTicker, numberOrNull, numeric } from "./context.js";

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

/**
 * 经外部数据源核实过的新代码建档入口（美股/港股皆可）。
 *
 * 会话-first 产品必须能研究任意合法标的：此前 companies 行只在"保存研究会话"时顺带
 * 插入（researchSessionsRepository.ensureCompany，事务内），而研究链路又要求行先存在
 * ——鸡生蛋，任何库里没有的公司第一问必死（"alibaba → BABA → 我还没识别出公司"）。
 * 这里是研究前的显式建档口。**调用方必须已经用真实数据源验证过代码**（行情探活 /
 * FMP 搜索命中），不得拿未验证的猜测代码建行——脏行会永远留在搜索结果里。
 */
export async function ensureCompanyRow(ticker: string, patch: { nameZh?: string; nameEn?: string; sector?: string; industry?: string } = {}) {
  const normalized = normalizeTicker(ticker);
  const isUs = !normalized.includes(".");
  await database().insert(companies).values({
    ticker: normalized,
    nameZh: patch.nameZh || normalized,
    nameEn: patch.nameEn || (isUs ? patch.nameZh || normalized : null),
    ...(patch.sector ? { sector: patch.sector } : {}),
    ...(patch.industry ? { industry: patch.industry } : {}),
    exchange: isUs ? "US" : "HKEX",
    currency: isUs ? "USD" : "HKD"
  }).onConflictDoNothing();
  return getCompanyByTickerComplete(normalized);
}

// Read-only, tolerant of a little replication lag, and the highest-traffic lookup in the
// desk/portfolio views — routed at the replica so it can be moved off the primary connection
// pool without touching call sites (see packages/db/src/repositories/context.ts).
export async function getLatestMarketSnapshot(ticker: string) {
  const [row] = await databaseRead().select().from(marketSnapshots)
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

/** Distinct daily closes for the price chart — one point per valid_time day, most recent last. */
export async function listRecentMarketSnapshots(ticker: string, days = 252) {
  const rows = await databaseRead().select().from(marketSnapshots)
    .where(eq(marketSnapshots.ticker, normalizeTicker(ticker)))
    .orderBy(desc(marketSnapshots.validTime), desc(marketSnapshots.id)).limit(days * 4);
  const byDay = new Map<string, { date: string; close: number }>();
  for (const row of rows) {
    const price = numberOrNull(row.price);
    if (price == null) continue;
    const date = row.validTime.toISOString().slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, { date, close: price });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
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
