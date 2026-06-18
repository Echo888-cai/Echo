/**
 * Seed script — populates luvio.db with 500+ HK companies + detail overrides.
 *
 * Usage: node scripts/seed-db.js
 *   - Creates/resets the companies and company_details tables
 *   - Imports the 500+ stock universe from src/data/hkStocks.js
 *   - Merges detail overrides from src/data.js
 *   - Safe to re-run (idempotent via INSERT OR REPLACE)
 */
import { getDb } from "../src/db/index.js";
import stocks from "../src/data/hkStocks.js";
import { companies } from "../src/data.js";

const db = getDb();

// Clear existing data for clean reseed
db.exec("DELETE FROM company_details");
db.exec("DELETE FROM companies");

const insertCompany = db.prepare(`
  INSERT OR REPLACE INTO companies (ticker, name_zh, name_en, sector, industry, listing_status, exchange, currency, is_hsi, market_cap_category, updated_at)
  VALUES (?, ?, ?, ?, ?, 'active', 'HKEX', 'HKD', ?, ?, datetime('now'))
`);

const insertDetails = db.prepare(`
  INSERT OR REPLACE INTO company_details (ticker, aliases, price, market_cap, week_52_range, dividend_yield, pe, pb, ps, latest_report, status, status_tone, summary, business_model, metrics, moat, management, risks, bull_case, bear_case, monitors, official_sources)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seen = new Set();
let count = 0;

console.log(`Seeding ${stocks.length} stocks...`);

for (const [ticker, nameZh, nameEn, sector, industry, isHsi] of stocks) {
  if (seen.has(ticker)) continue;
  seen.add(ticker);

  // Determine market cap category roughly by sector/name
  let mcapCat = "mid";
  if (isHsi) mcapCat = "large";
  else if (sector === "科技互联网" || sector === "金融与保险") mcapCat = "mid-large";

  insertCompany.run(ticker, nameZh, nameEn, sector, industry, isHsi ? 1 : 0, mcapCat);
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
