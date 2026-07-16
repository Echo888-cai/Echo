import { pgTable, text, bigserial, boolean, timestamp, date, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { companies } from "./core.js";

export const researchFacts = pgTable(
  "research_facts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull().references(() => companies.ticker),
    fact: text("fact").notNull(),
    source: text("source"),
    confidence: text("confidence").default("confirmed"),
    sessionId: text("session_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    supersededBy: bigserial("superseded_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    userTickerIdx: index("idx_research_facts_user_ticker").on(t.userId, t.ticker)
  })
);

export const researchQuestions = pgTable(
  "research_questions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull().references(() => companies.ticker),
    question: text("question").notNull(),
    status: text("status").notNull().default("open"),
    answer: text("answer"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (t) => ({
    userTickerIdx: index("idx_research_questions_user_ticker").on(t.userId, t.ticker)
  })
);

export const reviewDates = pgTable(
  "review_dates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").notNull().references(() => companies.ticker),
    reviewDate: date("review_date").notNull(),
    reason: text("reason"),
    completed: boolean("completed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    userIdx: index("idx_review_dates_user").on(t.userId, t.reviewDate)
  })
);
