import { desc, sql } from "drizzle-orm";
import { canaryRuns } from "../schema/misc.js";
import { database } from "./context.js";

export async function insertCanaryResult(input: any) {
  await database().insert(canaryRuns).values({ batchId: input.batchId, source: input.source, ticker: input.ticker,
    status: input.status, detail: input.detail ?? null, latencyMs: input.latencyMs ?? null });
}

export async function getLatestBatchId() {
  return (await database().select({ value: canaryRuns.batchId }).from(canaryRuns).orderBy(desc(canaryRuns.createdAt)).limit(1))[0]?.value || null;
}

export async function getSourceHealthSummary() {
  const result = await database().execute(sql`
    select distinct on (source) source,
      first_value(status) over (partition by source order by created_at desc) as latest_status,
      first_value(detail) over (partition by source order by created_at desc) as latest_detail,
      first_value(created_at) over (partition by source order by created_at desc) as latest_checked_at,
      max(created_at) filter (where status = 'ok') over (partition by source) as last_success_at,
      first_value(detail) over (partition by source order by (status != 'ok') desc, created_at desc) as last_failure_detail,
      max(created_at) filter (where status != 'ok') over (partition by source) as last_failure_at
    from canary_runs order by source, created_at desc
  `);
  return Array.from(result);
}
