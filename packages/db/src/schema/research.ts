/**
 * research.ts — research_sessions / company_profiles / profile_events / research_snapshots
 *
 * Source:
 *   001_init.sql (research_sessions, company_profiles, profile_events)
 *   006_research_snapshots.sql (research_snapshots)
 *   013/021 (research_sessions_fts full-text index — created then dropped in
 *     021_remove_research_session_fts.sql; the feature was decommissioned, so it is
 *     intentionally NOT reconstructed here)
 *   018_multiuser.sql (user_id columns + company_profiles PK rebuild to (user_id, ticker))
 *   canonical company profile and research session repository shapes,
 *     researchSnapshotsRepository.js for JSON column shapes.
 */
import { pgTable, text, integer, bigserial, numeric, timestamp, jsonb, index, primaryKey, uniqueIndex, date } from "drizzle-orm/pg-core";
import { companies } from "./core.js";
import { users } from "./auth.js";

/**
 * research_sessions — one row per research turn/session.
 * thread_json (full LLM conversation), decision_panel (LLM-structured verdict) and
 * data_sources (provider list) are all raw LLM/agent output with no fixed schema
 * across versions -> kept as JSONB, not structured, per the "freeform LLM output"
 * rule of thumb.
 */
export const researchSessions = pgTable(
  "research_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .default("local")
      .references(() => users.id),
    ticker: text("ticker").references(() => companies.ticker),
    title: text("title"),
    question: text("question"),
    conversationId: text("conversation_id"),
    status: text("status").notNull().default("draft"),
    reportMarkdown: text("report_markdown"),
    rating: text("rating"),
    confidence: text("confidence"),
    decisionPanel: jsonb("decision_panel"),
    fullResearch: text("full_research"),
    dataSources: jsonb("data_sources"),
    threadJson: jsonb("thread_json"),
    turnCount: integer("turn_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tickerIdx: index("idx_sessions_ticker").on(t.ticker),
    userIdx: index("idx_sessions_user").on(t.userId, t.updatedAt)
  })
);

/**
 * company_profiles — long-lived "current view" portrait per (user, ticker).
 * bull/bear/monitors/falsifiers are flat string-list JSON -> structured as text[].
 * valuation_json is a small fixed record {method,bear,base,bull,currentPrice} (see
 * companyProfiles.js renderProfileMarkdown) -> structured into real numeric columns
 * rather than kept as JSONB.
 */
export const companyProfiles = pgTable(
  "company_profiles",
  {
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull(),
    companyName: text("company_name"),
    thesis: text("thesis"),
    researchStatus: text("research_status"),
    confidence: text("confidence"),
    bull: text("bull").array(),
    bear: text("bear").array(),
    monitors: text("monitors").array(),
    falsifiers: text("falsifiers").array(),
    valuationMethod: text("valuation_method"),
    valuationBear: numeric("valuation_bear"),
    valuationBase: numeric("valuation_base"),
    valuationBull: numeric("valuation_bull"),
    valuationCurrentPrice: numeric("valuation_current_price"),
    profileMd: text("profile_md"),
    turnCount: integer("turn_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.ticker] })
  })
);

/**
 * profile_events — append-only timeline entries on a profile.
 * evidence_json is a short list of {url,title}-shaped citation blobs sourced straight
 * from LLM/web-search output — genuinely freeform (fields vary by provider) -> JSONB.
 */
export const profileEvents = pgTable(
  "profile_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    rationale: text("rationale"),
    evidenceJson: jsonb("evidence_json"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tickerIdx: index("idx_profile_events_ticker").on(t.ticker, t.id),
    userIdx: index("idx_profile_events_user").on(t.userId, t.ticker, t.id)
  })
);

/**
 * research_snapshots — R7 point-in-time judgement snapshot ("what we believed + the
 * valuation band + falsifiers, at this moment"). This table is inherently bitemporal
 * already: snapshot_date (renamed -> valid_time) is the business judgement date;
 * created_at (renamed -> knowledge_time) is when the row was written.
 * falsifiers_json is a flat string list -> structured as text[].
 */
export const researchSnapshots = pgTable(
  "research_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull(),
    // renamed from snapshot_date
    validTime: date("valid_time").notNull(),
    thesis: text("thesis"),
    valuationPosition: text("valuation_position"), // 'below_base' | 'above_base' | 'at_base' | null
    valuationBear: numeric("valuation_bear"),
    valuationBase: numeric("valuation_base"),
    valuationBull: numeric("valuation_bull"),
    valuationCurrency: text("valuation_currency"),
    priceAtSnapshot: numeric("price_at_snapshot"),
    falsifiers: text("falsifiers").array(),
    sessionId: text("session_id"),
    // renamed from created_at
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tickerIdx: index("idx_research_snapshots_ticker").on(t.ticker, t.validTime),
    userIdx: index("idx_research_snapshots_user").on(t.userId, t.ticker, t.validTime),
    // 0005: 一天一条判断——upsertResearchSnapshot 的冲突目标。
    dayUq: uniqueIndex("uq_research_snapshots_user_ticker_day").on(t.userId, t.ticker, t.validTime)
  })
);
