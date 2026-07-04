/**
 * Database index — SQLite connection + schema initialization
 *
 * Uses better-sqlite3 for synchronous, fast queries.
 * DB file is stored at project root as luvio.db.
 */
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";

const root = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(root, "..", "..", "luvio.db");

let db = null;

// Resolved lazily (inside getDb) so tests can point LUVIO_DB_PATH at a temp file
// before the first connection — keeps the test suite from polluting the dev DB.
export function dbPath() {
  return process.env.LUVIO_DB_PATH || DEFAULT_DB_PATH;
}

export function getDb() {
  if (!db) {
    db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  }
  return db;
}

// ─── Company queries ────────────────────────────────────────

export function getAllCompanies() {
  const db2 = getDb();
  return db2.prepare("SELECT * FROM companies ORDER BY sector, name_zh").all();
}

export function getCompanyByTicker(ticker) {
  const db2 = getDb();
  const normalized = normalizeTicker(ticker);
  const row = db2.prepare("SELECT c.*, d.* FROM companies c LEFT JOIN company_details d ON c.ticker = d.ticker WHERE c.ticker = ?").get(normalized);
  if (!row) return null;
  return hydrateCompany(row);
}

export function findCompanies(query) {
  const db2 = getDb();
  const like = `%${query}%`;
  const rows = db2.prepare(`
    SELECT c.* FROM companies c
    WHERE c.ticker LIKE ? OR c.name_zh LIKE ? OR c.name_en LIKE ?
    LIMIT 20
  `).all(like, like, like);
  return rows;
}

export function getCompaniesBySector() {
  const db2 = getDb();
  const rows = db2.prepare(`
    SELECT c.* FROM companies c
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

// ─── Market data queries ────────────────────────────────────

export function getLatestMarketSnapshot(ticker) {
  const db2 = getDb();
  const normalized = normalizeTicker(ticker);
  return db2.prepare(`
    SELECT * FROM market_snapshots
    WHERE ticker = ?
    ORDER BY as_of DESC
    LIMIT 1
  `).get(normalized) || null;
}

export function saveMarketSnapshot(data) {
  const db2 = getDb();
  const stmt = db2.prepare(`
    INSERT INTO market_snapshots (ticker, price, previous_close, change, change_percent, open, high, low, volume, market_cap, pe, dividend_yield, week_52_high, week_52_low, source, as_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    normalizeTicker(data.ticker),
    data.price, data.previousClose, data.change, data.changePercent,
    data.open, data.high, data.low, data.volume,
    data.marketCap, data.pe, data.dividendYield,
    data.week52High, data.week52Low,
    data.source || "api", data.asOf || new Date().toISOString()
  );
}

// ─── Research sessions ──────────────────────────────────────

export function saveSession(session) {
  const db2 = getDb();
  const stmt = db2.prepare(`
    INSERT OR REPLACE INTO research_sessions (id, ticker, question, status, report_markdown, rating, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(session.id, session.ticker, session.question, session.status || "draft", session.reportMarkdown || null, session.rating || null, session.confidence || null);
}

export function getRecentSessions(limit = 20) {
  const db2 = getDb();
  return db2.prepare(`
    SELECT s.*, c.name_zh as company_name
    FROM research_sessions s
    LEFT JOIN companies c ON s.ticker = c.ticker
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(limit);
}

// ─── Helpers ────────────────────────────────────────────────

function normalizeTicker(input) {
  if (!input) return "";
  let ticker = String(input).trim().toUpperCase();
  if (!ticker.includes(".")) ticker += ".HK";
  return ticker;
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
