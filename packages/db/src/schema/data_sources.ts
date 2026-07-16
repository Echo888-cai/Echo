import { pgTable, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const dataSourceFields = pgTable(
  "data_source_fields",
  {
    source: text("source").notNull(),
    field: text("field").notNull(),
    description: text("description"),
    licenseTier: text("license_tier").notNull().default("unlicensed_free_tier"),
    commercialUseAllowed: boolean("commercial_use_allowed").notNull().default(false),
    coverage: text("coverage"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: uniqueIndex("uq_data_source_field").on(t.source, t.field),
    sourceIdx: index("idx_data_source_fields_source").on(t.source)
  })
);
