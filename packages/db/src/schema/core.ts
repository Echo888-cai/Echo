/**
 * core.ts — companies / company_details / market_snapshots
 *
 * Source: src/db/migrations/001_init.sql (companies, company_details,
 * market_snapshots), reconciled against src/db/index.js's hydrateCompany().
 */
import { pgTable, text, serial, numeric, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  ticker: text("ticker").primaryKey(),
  nameZh: text("name_zh").notNull(),
  nameEn: text("name_en"),
  sector: text("sector"),
  industry: text("industry"),
  listingStatus: text("listing_status").notNull().default("active"),
  exchange: text("exchange").notNull().default("HKEX"),
  currency: text("currency").notNull().default("HKD"),
  marketCapCategory: text("market_cap_category"),
  isHsi: boolean("is_hsi").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * company_details — the "portrait" columns joined 1:1 onto companies.
 *
 * hydrateCompany() in src/db/index.js JSON.parse()s aliases/summary/business_model/
 * metrics/moat/management/risks/bull_case/bear_case/monitors/official_sources — every
 * one of them is a flat array of strings (never nested objects), so they're structured
 * here as native Postgres `text[]` rather than kept as JSONB (rule of thumb: fixed,
 * well-typed shape -> real column).
 *
 * No per-row timestamp exists in SQLite for this table's market-derived subset
 * (price/market_cap/week_52_range/dividend_yield/pe/pb/ps) — they're overwritten in
 * place with no history. valid_time and knowledge_time are new; because there's no
 * distinct "business period" concept for a live quote snapshot (unlike market_snapshots,
 * which has one row per pull), the two coincide at insert/update time here.
 */
export const companyDetails = pgTable("company_details", {
  ticker: text("ticker")
    .primaryKey()
    .references(() => companies.ticker),
  aliases: text("aliases").array(),
  price: numeric("price"),
  marketCap: text("market_cap"),
  week52Range: text("week_52_range"),
  dividendYield: text("dividend_yield"),
  pe: text("pe"),
  pb: text("pb"),
  ps: text("ps"),
  latestReport: text("latest_report"),
  status: text("status"),
  statusTone: text("status_tone"),
  summary: text("summary").array(),
  businessModel: text("business_model").array(),
  metrics: text("metrics").array(),
  moat: text("moat").array(),
  management: text("management").array(),
  risks: text("risks").array(),
  bullCase: text("bull_case").array(),
  bearCase: text("bear_case").array(),
  monitors: text("monitors").array(),
  officialSources: text("official_sources").array(),
  // New bitemporal columns (see class doc comment above for why they coincide here).
  validTime: timestamp("valid_time", { withTimezone: true }).defaultNow(),
  knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
});

/**
 * market_snapshots — one row per market-data pull (001_init.sql).
 * `as_of` -> valid_time (straight rename: as_of already meant "the moment this quote
 * reflects", i.e. business time). `created_at` -> knowledge_time (straight rename:
 * it already meant "when we ingested this row", i.e. system time) — no redundant
 * bolt-on columns needed, the bitemporal pair was already implicit in the old names.
 */
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    price: numeric("price"),
    previousClose: numeric("previous_close"),
    change: numeric("change"),
    changePercent: numeric("change_percent"),
    open: numeric("open"),
    high: numeric("high"),
    low: numeric("low"),
    volume: numeric("volume"),
    marketCap: numeric("market_cap"),
    pe: numeric("pe"),
    dividendYield: numeric("dividend_yield"),
    week52High: numeric("week_52_high"),
    week52Low: numeric("week_52_low"),
    source: text("source"),
    // renamed from as_of
    validTime: timestamp("valid_time", { withTimezone: true }).notNull(),
    // renamed from created_at
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tickerIdx: index("idx_market_ticker").on(t.ticker),
    validTimeIdx: index("idx_market_valid_time").on(t.validTime)
  })
);
