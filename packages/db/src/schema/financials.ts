/**
 * financials.ts — the financial-facts warehouse tables.
 *
 * Source:
 *   001_init.sql (hk_financials)
 *   002_g1_health.sql (hk_filing_ingest_log)
 *   003_earnings_calendar.sql + 008_earnings_actuals.sql (earnings_calendar)
 *   004_comp_peers.sql (comp_peers)
 *   010_insider_activity.sql (insider_activity)
 *   011_historical_valuation.sql (historical_valuation)
 *   012_hk_buybacks.sql (hk_buybacks)
 *   015_cn_financials.sql (cn_financials, cn_filing_ingest_log)
 *   src/server/repositories/{compPeersRepository,webEvidenceRepository,
 *     historicalValuationRepository,insiderActivityRepository}.js for JSON shapes.
 */
import {
  pgTable,
  text,
  integer,
  bigserial,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { companies } from "./core";

/**
 * hk_financials / cn_financials — first-party filing extracts (HKEX PDF / 巨潮资讯网).
 * `period_end` (the reporting period this row's figures pertain to) -> valid_time.
 * `extracted_at` (when our pipeline pulled + parsed the filing) -> knowledge_time.
 * Both are straight renames of an already-bitemporal pair; period_label/period_type
 * are kept as-is (display label, not a real date).
 */
function financialsColumns() {
  return {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    periodLabel: text("period_label"),
    // renamed from period_end
    validTime: text("valid_time"),
    periodType: text("period_type"),
    currency: text("currency"),
    unitLabel: text("unit_label"),
    revenue: numeric("revenue"),
    revenuePrior: numeric("revenue_prior"),
    grossProfit: numeric("gross_profit"),
    grossProfitPrior: numeric("gross_profit_prior"),
    operatingIncome: numeric("operating_income"),
    operatingIncomePrior: numeric("operating_income_prior"),
    netIncome: numeric("net_income"),
    netIncomePrior: numeric("net_income_prior"),
    netIncomeAttributable: numeric("net_income_attributable"),
    eps: numeric("eps"),
    operatingCashFlow: numeric("operating_cash_flow"),
    cashAndEquivalents: numeric("cash_and_equivalents"),
    netCash: numeric("net_cash"),
    sourceTitle: text("source_title"),
    sourceUrl: text("source_url").unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // renamed from extracted_at
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
  };
}

export const hkFinancials = pgTable("hk_financials", financialsColumns(), (t) => ({
  tickerIdx: index("idx_hk_financials_ticker").on(t.ticker, t.validTime)
}));

export const cnFinancials = pgTable("cn_financials", financialsColumns(), (t) => ({
  tickerIdx: index("idx_cn_financials_ticker").on(t.ticker, t.validTime)
}));

/**
 * hk_filing_ingest_log / cn_filing_ingest_log — ingestion-attempt log, one row per
 * ticker (upserted on every scan). This is a pure operational log, not a fact with a
 * distinct reporting period — there's nothing to call valid_time except "when we
 * checked", so valid_time intentionally mirrors knowledge_time here (both map to the
 * old `checked_at`); kept as two columns anyway for schema uniformity across the
 * warehouse tables per the task's bitemporal convention.
 */
function ingestLogColumns() {
  return {
    ticker: text("ticker")
      .primaryKey()
      .references(() => companies.ticker),
    status: text("status").notNull(),
    detail: text("detail"),
    announcementsFound: integer("announcements_found").notNull().default(0),
    ingestedCount: integer("ingested_count").notNull().default(0),
    // renamed from checked_at; valid_time left equal to knowledge_time (see doc above)
    validTime: timestamp("valid_time", { withTimezone: true }).notNull().defaultNow(),
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
  };
}

export const hkFilingIngestLog = pgTable("hk_filing_ingest_log", ingestLogColumns());
export const cnFilingIngestLog = pgTable("cn_filing_ingest_log", ingestLogColumns());

/**
 * earnings_calendar — one row per ticker: latest known "next report" prediction plus
 * (008) the most recent actual-vs-estimate outcome. There's no single clean valid_time
 * for the whole row (next_date is forward-looking; last_date is the true last reported
 * period) — per the task's guidance we don't bolt on a redundant column when mapping
 * is ambiguous, so valid_time maps to `last_date` (the most recent real business
 * period this row has confirmed actuals for) and is nullable until a first report
 * lands; `fetched_at` -> knowledge_time (straight rename).
 */
export const earningsCalendar = pgTable("earnings_calendar", {
  ticker: text("ticker")
    .primaryKey()
    .references(() => companies.ticker),
  nextDate: text("next_date"),
  quarter: integer("quarter"),
  year: integer("year"),
  epsEstimate: numeric("eps_estimate"),
  revenueEstimate: numeric("revenue_estimate"),
  source: text("source"),
  providerStatus: text("provider_status").notNull().default("missing"),
  detail: text("detail"),
  lastDate: text("last_date"),
  lastQuarter: integer("last_quarter"),
  lastYear: integer("last_year"),
  lastEpsEstimate: numeric("last_eps_estimate"),
  lastEpsActual: numeric("last_eps_actual"),
  lastRevenueEstimate: numeric("last_revenue_estimate"),
  lastRevenueActual: numeric("last_revenue_actual"),
  lastEpsSurprisePct: numeric("last_eps_surprise_pct"),
  lastRevenueSurprisePct: numeric("last_revenue_surprise_pct"),
  // valid_time == last_date (text) kept as text to mirror last_date's own type/format
  validTime: text("valid_time"),
  // renamed from fetched_at
  knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
});

/**
 * comp_peers — cached comparable-company list + valuation anchors (G-3), 24h TTL.
 * peers_json is a provider-shaped list of peer records whose fields vary by stage/
 * provider (ticker/name/pe/pb/... not all always present) -> kept as JSONB array.
 * anchor_json is a small computed object but its shape depends on which valuation
 * method produced it -> kept as JSONB object too (not a single fixed record type).
 * No distinct business period exists (it's "the peer list as currently known") so
 * valid_time mirrors knowledge_time, both mapped from fetched_at.
 */
export const compPeers = pgTable("comp_peers", {
  ticker: text("ticker")
    .primaryKey()
    .references(() => companies.ticker),
  stage: text("stage"),
  peers: jsonb("peers_json"),
  anchor: jsonb("anchor_json"),
  providerStatus: text("provider_status").notNull().default("missing"),
  detail: text("detail"),
  partial: boolean("partial").notNull().default(false),
  validTime: timestamp("valid_time", { withTimezone: true }).notNull().defaultNow(),
  // renamed from fetched_at
  knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
});

/**
 * insider_activity — SEC EDGAR Form 4 net buy/sell summary cache (F-4a), 24h TTL.
 * transactions_json is a bounded (<=10) sample of provider-shaped transaction
 * records — kept as JSONB array (provider payload, not a canonical fact we query by
 * field). `last_transaction_at` (the most recent real trade this aggregate reflects)
 * -> valid_time; `fetched_at` -> knowledge_time.
 */
export const insiderActivity = pgTable("insider_activity", {
  ticker: text("ticker")
    .primaryKey()
    .references(() => companies.ticker),
  providerStatus: text("provider_status").notNull().default("missing"),
  netShares: numeric("net_shares"),
  netValueUsd: numeric("net_value_usd"),
  buyCount: integer("buy_count"),
  sellCount: integer("sell_count"),
  distinctInsiders: integer("distinct_insiders"),
  // renamed from last_transaction_at
  validTime: timestamp("valid_time", { withTimezone: true }),
  transactions: jsonb("transactions_json"),
  detail: text("detail"),
  // renamed from fetched_at
  knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
});

/**
 * historical_valuation — cached annual PE series (F-5), 24h TTL. series_json is an
 * array of simple {year, pe}-shaped points — a fixed, well-typed record -> structured
 * into a child table (historicalValuationPoints) instead of kept as JSONB. The parent
 * row has no single valid_time (it holds a multi-year series); knowledge_time maps
 * from fetched_at, valid_time is left null at the parent level (each child point
 * carries its own year).
 */
export const historicalValuation = pgTable("historical_valuation", {
  ticker: text("ticker")
    .primaryKey()
    .references(() => companies.ticker),
  providerStatus: text("provider_status").notNull().default("missing"),
  detail: text("detail"),
  // no single business period for a multi-year series row; see doc above
  validTime: timestamp("valid_time", { withTimezone: true }),
  // renamed from fetched_at
  knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Child table replacing historical_valuation.series_json (see doc comment above).
 * Actual source shape (src/server/services/historicalValuation.js) is a flat list of
 * {period: "YYYY-MM-DD", value: number} — fiscal-year-end date + PE at that date, not
 * a {year, pe} pair as one might guess from the table name.
 */
export const historicalValuationPoints = pgTable(
  "historical_valuation_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    periodEndDate: text("period_end_date").notNull(),
    peValue: numeric("pe_value")
  },
  (t) => ({
    tickerIdx: index("idx_historical_valuation_points_ticker").on(t.ticker, t.periodEndDate),
    // one row per (ticker, period) — makes ETL re-runs idempotent via ON CONFLICT
    // instead of duplicating the annual-PE series on every re-run.
    tickerPeriodUnique: uniqueIndex("uq_historical_valuation_points_ticker_period").on(t.ticker, t.periodEndDate)
  })
);

/**
 * hk_buybacks — HKEX FF305 next-day disclosure rows (F-4b), already fully columnar
 * (no JSON to structure). `trade_date` is already the unambiguous business date this
 * disclosure covers -> kept as-is; valid_time is added alongside as an alias-with-
 * intent rather than renamed, since "trade_date" is clearer domain language and is
 * referenced by name elsewhere. `fetched_at` -> knowledge_time (straight rename).
 */
export const hkBuybacks = pgTable(
  "hk_buybacks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    tradeDate: text("trade_date"),
    sharesRepurchased: numeric("shares_repurchased"),
    priceHigh: numeric("price_high"),
    priceLow: numeric("price_low"),
    totalConsideration: numeric("total_consideration"),
    currency: text("currency"),
    sharesIssuedTotal: numeric("shares_issued_total"),
    periodEndDate: text("period_end_date"),
    sourceTitle: text("source_title"),
    sourceUrl: text("source_url").unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // renamed from fetched_at
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tickerDateIdx: index("idx_hk_buybacks_ticker_date").on(t.ticker, t.tradeDate)
  })
);

/**
 * web_evidence — cached web/search evidence used by research (24h-48h TTL).
 * raw_json is the raw provider search-result payload — genuinely freeform -> JSONB.
 * `published_at` (when the underlying article/filing was published, i.e. the
 * business time of the fact) -> valid_time. `fetched_at` (when we pulled it) ->
 * knowledge_time. Both are straight renames.
 */
export const webEvidence = pgTable(
  "web_evidence",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    intent: text("intent").notNull(),
    query: text("query"),
    title: text("title"),
    url: text("url").notNull(),
    source: text("source"),
    sourceType: text("source_type"),
    snippet: text("snippet"),
    // renamed from published_at
    validTime: timestamp("valid_time", { withTimezone: true }),
    // renamed from fetched_at
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull(),
    relevanceScore: numeric("relevance_score"),
    credibilityScore: numeric("credibility_score"),
    contentHash: text("content_hash"),
    raw: jsonb("raw_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tickerIntentIdx: index("idx_web_evidence_ticker_intent").on(t.ticker, t.intent),
    urlIdx: index("idx_web_evidence_url").on(t.url),
    knowledgeTimeIdx: index("idx_web_evidence_knowledge_time").on(t.knowledgeTime)
  })
);
