import { desc, eq, sql } from "drizzle-orm";
import { llmAudit } from "../schema/misc.js";
import { numeric, withTenant } from "./context.js";

export async function insertLlmAudit(input: any) {
  const userId = input.userId || "local";
  try {
    await withTenant(userId, (tx) => tx.insert(llmAudit).values({ userId, provider: String(input.provider || "unknown"),
      model: input.model ?? null, kind: input.kind || "chat", status: String(input.status || "error"), latencyMs: input.latencyMs ?? null,
      errorDetail: input.errorDetail ? String(input.errorDetail).slice(0, 500) : null, inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null, estimatedCostUsd: numeric(input.estimatedCostUsd) }));
  } catch { /* audit must never block model calls */ }
}

export async function getProviderCallStats({ days = 7, userId = "local" }: any = {}) {
  const cutoff = new Date(Date.now() - Math.max(1, Math.round(days)) * 86_400_000);
  return withTenant(userId, async (tx) => Array.from(await tx.execute(sql`
    select provider, count(*)::int as attempts,
      count(*) filter (where status = 'ok')::int as successes,
      count(*) filter (where status != 'ok')::int as failures,
      round(avg(latency_ms) filter (where status = 'ok')) as "avgLatencyMs",
      max(created_at) filter (where status = 'ok') as "lastSuccessAt",
      sum(coalesce(input_tokens, 0))::int as "inputTokens", sum(coalesce(output_tokens, 0))::int as "outputTokens",
      round(sum(coalesce(estimated_cost_usd, 0)), 6) as "estimatedCostUsd",
      (array_agg(error_detail order by created_at desc) filter (where status != 'ok'))[1] as "lastFailureDetail",
      max(created_at) filter (where status != 'ok') as "lastFailureAt"
    from llm_audit where user_id = ${userId} and created_at >= ${cutoff} group by provider order by attempts desc
  `)));
}

export async function getUserDailyUsage(userId = "local") {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 3_600_000);
  beijing.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(beijing.getTime() - 8 * 3_600_000);
  return withTenant(userId, async (tx) => {
    const rows = Array.from(await tx.execute(sql`
      select count(*)::int as attempts, count(*) filter (where status = 'ok')::int as "successfulCalls",
        sum(coalesce(input_tokens, 0))::int as "inputTokens", sum(coalesce(output_tokens, 0))::int as "outputTokens",
        round(sum(coalesce(estimated_cost_usd, 0)), 6) as "estimatedCostUsd"
      from llm_audit where user_id = ${userId} and created_at >= ${cutoff}
    `));
    const row: any = rows[0] || {};
    return { attempts: Number(row.attempts || 0), successfulCalls: Number(row.successfulCalls || 0), inputTokens: Number(row.inputTokens || 0),
      outputTokens: Number(row.outputTokens || 0), estimatedCostUsd: Number(row.estimatedCostUsd || 0) };
  });
}

export async function getRecentLlmAudits(limit = 20, userId = "local") {
  return withTenant(userId, (tx) => tx.select().from(llmAudit).where(eq(llmAudit.userId, userId)).orderBy(desc(llmAudit.id))
    .limit(Math.min(200, Math.max(1, limit))));
}
