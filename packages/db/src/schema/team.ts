import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: text("team_id").notNull().references(() => teams.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: uniqueIndex("uq_team_membership").on(t.teamId, t.userId),
    userIdx: index("idx_team_memberships_user").on(t.userId)
  })
);
