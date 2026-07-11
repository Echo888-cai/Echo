/**
 * Seed script — populates luvio.db with HK + CN companies + detail overrides.
 *
 * Usage: node scripts/seed-db.js
 *   - Creates/resets the companies and company_details tables
 *   - Imports the HK stock universe from src/data/hkStocks.js
 *   - Imports the staged CN (A股) core universe from src/data/cnStocks.js
 *   - Merges detail overrides from src/data.js
 *   - Safe to re-run (idempotent via INSERT OR REPLACE, upsert-only — never deletes rows,
 *     since companies is FK-referenced by portfolio_positions/watch_rules/research_sessions
 *     on a live DB; a prior DELETE-then-reinsert here corrupted company_details in production)
 */
import { getDb } from "../src/db/index.js";
import hkStocks from "../src/data/hkStocks.js";
import cnStocks from "../src/data/cnStocks.js";
import { companies } from "../src/data.js";
import { detectMarket } from "../src/market.js";

const db = getDb();
const stocks = [...hkStocks, ...cnStocks];

const insertCompany = db.prepare(`
  INSERT OR REPLACE INTO companies (ticker, name_zh, name_en, sector, industry, listing_status, exchange, currency, is_hsi, market_cap_category, updated_at)
  VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, datetime('now'))
`);

const insertDetails = db.prepare(`
  INSERT OR REPLACE INTO company_details (ticker, aliases, price, market_cap, week_52_range, dividend_yield, pe, pb, ps, latest_report, status, status_tone, summary, business_model, metrics, moat, management, risks, bull_case, bear_case, monitors, official_sources)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seen = new Set();
let count = 0;

console.log(`Seeding ${stocks.length} stocks...`);

for (const [ticker, nameZh, nameEn, sector, industry, isIndexFlag] of stocks) {
  if (seen.has(ticker)) continue;
  seen.add(ticker);

  // Determine market cap category roughly by sector/name
  let mcapCat = "mid";
  if (isIndexFlag) mcapCat = "large";
  else if (sector === "科技互联网" || sector === "金融与保险") mcapCat = "mid-large";

  const market = detectMarket(ticker);
  const exchange = market === "CN" ? (ticker.endsWith(".SS") ? "SSE" : "SZSE") : "HKEX";
  const currency = market === "CN" ? "CNY" : "HKD";

  insertCompany.run(ticker, nameZh, nameEn, sector, industry, exchange, currency, isIndexFlag ? 1 : 0, mcapCat);
  count++;
}

console.log(`✓ ${count} unique companies inserted`);

// ─── Merge detail overrides from data.js ────────────────────
// These are the rich profiles (summary, risks, moat, etc.)
// from the existing seedCompanies-derived data.
let detailCount = 0;

for (const company of companies) {
  if (!company.ticker) continue;
  const detail = company;
  if (!detail.summary?.length && !detail.risks?.length) continue; // only rich profiles

  insertDetails.run(
    detail.ticker,
    JSON.stringify(detail.aliases || []),
    detail.price || null,
    detail.marketCap || null,
    detail.week52 || null,
    detail.dividendYield || null,
    detail.pe || null,
    detail.pb || null,
    detail.ps || null,
    detail.latestReport || null,
    detail.status || null,
    detail.statusTone || null,
    JSON.stringify(detail.summary || []),
    JSON.stringify(detail.businessModel || []),
    JSON.stringify(detail.metrics || []),
    JSON.stringify(detail.moat || []),
    JSON.stringify(detail.management || []),
    JSON.stringify(detail.risks || []),
    JSON.stringify(detail.bull || []),
    JSON.stringify(detail.bear || []),
    JSON.stringify(detail.monitors || []),
    JSON.stringify(detail.officialSources || [])
  );
  detailCount++;
}

console.log(`✓ ${detailCount} detail overrides merged`);
console.log("Seed complete.");
process.exit(0);
