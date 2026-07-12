/**
 * portfolio.ts — portfolio_positions / watchlist_prefs / watch_rules / portfolio_snapshots
 *
 * Source: 001_init.sql, 009_watch_rules_metric.sql, 014_portfolio_snapshots.sql,
 * 018_multiuser.sql (PK rebuilds to (user_id, ticker) / (user_id, snapshot_date)),
 * src/server/repositories/portfolioSnapshots.js for totals_json shape.
 */
import { pgTable, text, integer, bigserial, numeric, boolean, timestamp, date, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const portfolioPositions = pgTable(
  "portfolio_positions",
  {
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull(),
    companyName: text("company_name"),
    shares: numeric("shares"),
    avgCost: numeric("avg_cost"),
    stopLoss: numeric("stop_loss"),
    takeProfit: numeric("take_profit"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.ticker] }) })
);

export const watchlistPrefs = pgTable(
  "watchlist_prefs",
  {
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull(),
    companyName: text("company_name"),
    mode: text("mode").notNull().default("add"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.ticker] }) })
);

/** watch_rules — price and (F-3) fundamental falsifier rules. `metric` (009) is only
 * populated for kind='fundamental' rules; price rules leave it NULL. */
export const watchRules = pgTable(
  "watch_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull(),
    kind: text("kind").notNull(),
    threshold: numeric("threshold").notNull(),
    metric: text("metric"),
    label: text("label"),
    source: text("source").notNull().default("falsifier"),
    sessionId: text("session_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true })
  },
  (t) => ({
    tickerIdx: index("idx_watch_rules_ticker").on(t.ticker, t.active),
    userIdx: index("idx_watch_rules_user").on(t.userId, t.active, t.ticker)
  })
);

/**
 * portfolio_snapshots — one row per (user, day) net-worth snapshot (M-1).
 * `snapshot_date` -> valid_time (straight rename: it's already exactly the business
 * date this snapshot pertains to). `created_at` -> knowledge_time (straight rename:
 * already "when this snapshot was computed/written").
 * totals_json ({currency, marketValue}[]) is a small fixed-shape list -> structured
 * into a child table (portfolioSnapshotTotals) instead of kept as JSONB, since it's
 * a well-typed per-currency breakdown, not freeform.
 */
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    userId: text("user_id").notNull().default("local").references(() => users.id),
    // renamed from snapshot_date
    validTime: date("valid_time").notNull(),
    totalValueUsd: numeric("total_value_usd"),
    totalCostUsd: numeric("total_cost_usd"),
    totalPnlUsd: numeric("total_pnl_usd"),
    positionCount: integer("position_count").notNull(),
    // renamed from created_at
    knowledgeTime: timestamp("knowledge_time", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.validTime] }) })
);

/** Child table replacing portfolio_snapshots.totals_json (see class doc comment). */
export const portfolioSnapshotTotals = pgTable(
  "portfolio_snapshot_totals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    snapshotValidTime: date("snapshot_valid_time").notNull(),
    currency: text("currency").notNull(),
    marketValue: numeric("market_value").notNull()
  },
  (t) => ({
    snapshotIdx: index("idx_portfolio_snapshot_totals_snapshot").on(t.userId, t.snapshotValidTime),
    // one row per (user, snapshot, currency) — makes ETL re-runs idempotent via
    // ON CONFLICT instead of duplicating a snapshot's per-currency breakdown.
    snapshotCurrencyUnique: uniqueIndex("uq_portfolio_snapshot_totals_snapshot_currency").on(
      t.userId,
      t.snapshotValidTime,
      t.currency
    )
  })
);
