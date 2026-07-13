/**
 * companyRepository — queries the 654+ companies in SQLite.
 *
 * Wraps company queries with profile/hasPortrait detection
 * so callers can distinguish between "rich profile (31)" and "basic (654+)".
 */

import { getDb } from "../../db/index.js";
import { bareSymbol, cnTicker, detectMarket, hkCode } from "../../market.js";

export function searchCompanies(query, { limit = 20 } = {}) {
  const db = getDb();
  const like = `%${query}%`;
  const rows = db.prepare(`
    SELECT c.ticker, c.name_zh, c.name_en, c.sector, c.industry,
           CASE WHEN d.ticker IS NOT NULL THEN 1 ELSE 0 END AS has_portrait
    FROM companies c
    LEFT JOIN company_details d ON c.ticker = d.ticker
    WHERE c.ticker LIKE ? OR c.name_zh LIKE ? OR c.name_en LIKE ?
    ORDER BY
      CASE WHEN c.ticker LIKE ? THEN 0 ELSE 1 END,
      CASE WHEN c.name_zh LIKE ? THEN 0 ELSE 1 END,
      c.name_zh
    LIMIT ?
  `).all(like, like, like, like, like, limit);
  // Convert snake_case to camelCase + boolean
  return rows.map(r => ({
    ticker: r.ticker,
    nameZh: r.name_zh,
    nameEn: r.name_en,
    sector: r.sector,
    industry: r.industry,
    hasPortrait: !!r.has_portrait
  }));
}

export function getCompanyByTickerComplete(ticker) {
  const db = getDb();
  const normalized = normalizeTicker(ticker);
  // d.* 放前面、c.* 放后面：两表都有 ticker 列，company_details 没有该 ticker 的行时
  // d.ticker 是 NULL，若 c.* 在前会被这个 NULL 覆盖掉真实 ticker（同 db/index.js 的
  // getCompanyByTicker 同一个 bug，一并修）。
  const row = db.prepare(`
    SELECT d.*, c.* FROM companies c
    LEFT JOIN company_details d ON c.ticker = d.ticker
    WHERE c.ticker = ?
  `).get(normalized);
  if (!row) return null;
  return hydrateCompany(row);
}

export function getLatestMarketSnapshot(ticker) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM market_snapshots
    WHERE ticker = ?
    ORDER BY as_of DESC LIMIT 1
  `).get(normalizeTicker(ticker)) || null;
}

export function saveMarketSnapshot(data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO market_snapshots
      (ticker, price, previous_close, change, change_percent, open, high, low, volume, market_cap, pe, dividend_yield, week_52_high, week_52_low, source, as_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeTicker(data.ticker),
    data.price, data.previousClose, data.change, data.changePercent,
    data.open, data.high, data.low, data.volume,
    data.marketCap, data.pe, data.dividendYield,
    data.week52High, data.week52Low,
    data.source || "api", data.asOf || new Date().toISOString()
  );
}

export function getCompaniesBySector() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*, CASE WHEN d.ticker IS NOT NULL THEN 1 ELSE 0 END AS has_portrait
    FROM companies c
    LEFT JOIN company_details d ON c.ticker = d.ticker
    WHERE c.listing_status = 'active'
    ORDER BY c.sector, c.name_zh
  `).all();
  return rows.reduce((groups, company) => {
    const sector = company.sector || "其他";
    if (!groups[sector]) groups[sector] = [];
    groups[sector].push(company);
    return groups;
  }, {});
}

export function getAllCompanies() {
  const db = getDb();
  return db.prepare("SELECT * FROM companies ORDER BY sector, name_zh").all();
}

function normalizeTicker(input) {
  if (!input) return "";
  const ticker = String(input).trim().toUpperCase();
  const market = detectMarket(ticker);
  if (market === "US") return bareSymbol(ticker);
  if (market === "CN") return cnTicker(ticker);
  return `${hkCode(ticker)}.HK`;
}

function hydrateCompany(row) {
  const parseList = (val) => {
    if (!val) return [];
    try { return JSON.parse(val); } catch { return []; }
  };
  return {
    ticker: row.ticker,
    nameZh: row.name_zh || "",
    nameEn: row.name_en || "",
    sector: row.sector || "",
    industry: row.industry || "",
    listingStatus: row.listing_status || "active",
    currency: row.currency || "HKD",
    exchange: row.exchange || "HKEX",
    isHsi: !!row.is_hsi,
    hasPortrait: !!row.business_model,
    // detail fields (nullable)
    aliases: parseList(row.aliases),
    price: row.price || null,
    marketCap: row.market_cap || null,
    week52: row.week_52_range || null,
    dividendYield: row.dividend_yield || null,
    pe: row.pe || null,
    pb: row.pb || null,
    ps: row.ps || null,
    latestReport: row.latest_report || null,
    status: row.status || null,
    statusTone: row.status_tone || null,
    summary: parseList(row.summary),
    businessModel: parseList(row.business_model),
    metrics: parseList(row.metrics),
    moat: parseList(row.moat),
    management: parseList(row.management),
    risks: parseList(row.risks),
    bull: parseList(row.bull_case),
    bear: parseList(row.bear_case),
    monitors: parseList(row.monitors),
    officialSources: parseList(row.official_sources)
  };
}
