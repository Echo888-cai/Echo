/**
 * misc.ts — scheduler_state / documents / user_preferences / feedback / llm_audit /
 * fact_guard_audit / canary_runs.
 *
 * Operational/audit/UI-preference tables, not financial facts, so none get the
 * valid_time/knowledge_time bitemporal pair — plain created_at/checked_at
 * timestamps are kept.
 */
import { pgTable, text, integer, serial, bigserial, numeric, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { companies } from "./core.js";

export const schedulerState = pgTable("scheduler_state", {
  jobId: text("job_id").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastDetail: text("last_detail")
});

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    ticker: text("ticker").references(() => companies.ticker),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    size: integer("size"),
    parser: text("parser"),
    text: text("text"),
    summary: text("summary"),
    sourceType: text("source_type").notNull().default("upload"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    userIdx: index("idx_documents_user").on(t.userId, t.createdAt)
  })
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  notifyDigest: boolean("notify_digest").notNull().default(true),
  notifyPositions: boolean("notify_positions").notNull().default(true),
  notifyFalsify: boolean("notify_falsify").notNull().default(true),
  notifyReview: boolean("notify_review").notNull().default(true),
  notifyEarnings: boolean("notify_earnings").notNull().default(true),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/** context_json is an arbitrary snapshot of app/UI state attached to a feedback
 * message — freeform by design -> JSONB. */
export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    message: text("message").notNull(),
    context: jsonb("context_json"),
    status: text("status").notNull().default("new"),
    category: text("category").default("general"),
    ticker: text("ticker"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (t) => ({
    userIdx: index("idx_feedback_user_time").on(t.userId, t.createdAt)
  })
);

/** llm_audit — every provider hop in the GLM->DeepSeek->OpenAI failover chain, not
 * just the final success. Not a "fact" warehouse table; created_at is plain. */
export const llmAudit = pgTable(
  "llm_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull().default("local").references(() => users.id),
    provider: text("provider").notNull(),
    model: text("model"),
    kind: text("kind").notNull().default("chat"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    errorDetail: text("error_detail"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    providerIdx: index("idx_llm_audit_provider").on(t.provider, t.createdAt),
    userTimeIdx: index("idx_llm_audit_user_time").on(t.userId, t.createdAt)
  })
);

/** hard_details is a short list of hard-fail descriptions whose shape varies by
 * check type (numeric mismatch vs missing citation, etc.) -> kept as JSONB. */
export const factGuardAudit = pgTable(
  "fact_guard_audit",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker"),
    mode: text("mode").notNull(),
    total: integer("total").notNull().default(0),
    passCount: integer("pass_count").notNull().default(0),
    softCount: integer("soft_count").notNull().default(0),
    hardCount: integer("hard_count").notNull().default(0),
    hardDetails: jsonb("hard_details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    createdIdx: index("idx_fact_guard_audit_created").on(t.createdAt)
  })
);

/** rate_limit_buckets backs the shared rate limiter for abuse-prone heavy endpoints
 * (ask/report-generate/parse-document) — a plain Postgres row instead of Redis, since
 * multiple API replicas need one shared counter and this stays inside the single
 * approved architecture. Low-cardinality, low-frequency by design; see http.ts. */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull()
});

export const canaryRuns = pgTable(
  "canary_runs",
  {
    id: serial("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    source: text("source").notNull(),
    ticker: text("ticker").notNull(),
    status: text("status").notNull(),
    detail: text("detail"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    batchIdx: index("idx_canary_batch").on(t.batchId),
    sourceIdx: index("idx_canary_source").on(t.source, t.createdAt)
  })
);
