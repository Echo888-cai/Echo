/**
 * Database index — SQLite connection + schema initialization
 *
 * Uses better-sqlite3 for synchronous, fast queries.
 * DB file is stored at project root as luvio.db.
 */
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(root, "..", "..", "luvio.db");

let db = null;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      ticker        TEXT PRIMARY KEY,
      name_zh       TEXT NOT NULL,
      name_en       TEXT,
      sector        TEXT,
      industry      TEXT,
      listing_status TEXT NOT NULL DEFAULT 'active',
      exchange      TEXT NOT NULL DEFAULT 'HKEX',
      currency      TEXT NOT NULL DEFAULT 'HKD',
      market_cap_category TEXT,
      is_hsi        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_details (
      ticker            TEXT PRIMARY KEY,
      aliases           TEXT,
      price             REAL,
      market_cap        TEXT,
      week_52_range     TEXT,
      dividend_yield    TEXT,
      pe                TEXT,
      pb                TEXT,
      ps                TEXT,
      latest_report     TEXT,
      status            TEXT,
      status_tone       TEXT,
      summary           TEXT,
      business_model    TEXT,
      metrics           TEXT,
      moat              TEXT,
      management        TEXT,
      risks             TEXT,
      bull_case         TEXT,
      bear_case         TEXT,
      monitors          TEXT,
      official_sources  TEXT,
      FOREIGN KEY (ticker) REFERENCES companies(ticker)
    );

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker          TEXT NOT NULL,
      price           REAL,
      previous_close  REAL,
      change          REAL,
      change_percent  REAL,
      open            REAL,
      high            REAL,
      low             REAL,
      volume          INTEGER,
      market_cap      REAL,
      pe              REAL,
      dividend_yield  REAL,
      week_52_high    REAL,
      week_52_low     REAL,
      source          TEXT,
      as_of           TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ticker) REFERENCES companies(ticker)
    );

    CREATE TABLE IF NOT EXISTS research_sessions (
      id              TEXT PRIMARY KEY,
      ticker          TEXT,
      question        TEXT,
      status          TEXT NOT NULL DEFAULT 'draft',
      report_markdown TEXT,
      rating          TEXT,
      confidence      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ticker) REFERENCES companies(ticker)
    );

    CREATE INDEX IF NOT EXISTS idx_market_ticker ON market_snapshots(ticker);
    CREATE INDEX IF NOT EXISTS idx_market_as_of ON market_snapshots(as_of);
    CREATE INDEX IF NOT EXISTS idx_sessions_ticker ON research_sessions(ticker);
  `);
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
