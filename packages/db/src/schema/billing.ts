import { pgTable, text, integer, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  monthlyPriceUsd: numeric("monthly_price_usd").notNull(),
  yearlyPriceUsd: numeric("yearly_price_usd"),
  maxDailyCalls: integer("max_daily_calls").notNull(),
  maxDailyCostUsd: numeric("max_daily_cost_usd"),
  maxTeamMembers: integer("max_team_members").notNull().default(1),
  features: text("features").array(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    planId: text("plan_id").notNull().references(() => plans.id),
    status: text("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    userIdx: index("idx_subscriptions_user").on(t.userId, t.status),
    externalIdx: index("idx_subscriptions_external").on(t.externalId)
  })
);
