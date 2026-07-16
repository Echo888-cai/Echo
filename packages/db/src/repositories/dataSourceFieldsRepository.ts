import { eq } from "drizzle-orm";
import { dataSourceFields } from "../schema/data_sources.js";
import { database } from "./context.js";

export async function upsertField(entry: {
  source: string;
  field: string;
  description?: string;
  licenseTier?: string;
  commercialUseAllowed?: boolean;
  coverage?: string;
  notes?: string;
}) {
  const [row] = await database()
    .insert(dataSourceFields)
    .values({
      source: entry.source,
      field: entry.field,
      description: entry.description ?? null,
      licenseTier: entry.licenseTier ?? "unlicensed_free_tier",
      commercialUseAllowed: entry.commercialUseAllowed ?? false,
      coverage: entry.coverage ?? null,
      notes: entry.notes ?? null
    })
    .onConflictDoUpdate({
      target: [dataSourceFields.source, dataSourceFields.field],
      set: {
        description: entry.description ?? undefined,
        licenseTier: entry.licenseTier ?? undefined,
        commercialUseAllowed: entry.commercialUseAllowed ?? undefined,
        coverage: entry.coverage ?? undefined,
        notes: entry.notes ?? undefined,
        updatedAt: new Date()
      }
    })
    .returning();
  return row;
}

export async function listFieldsBySource(source: string) {
  return database().select().from(dataSourceFields).where(eq(dataSourceFields.source, source));
}

export async function getCommercialFields() {
  return database()
    .select()
    .from(dataSourceFields)
    .where(eq(dataSourceFields.commercialUseAllowed, true));
}
