import { count, desc, gt, gte, sql } from "drizzle-orm";
import { factGuardAudit } from "../schema/misc.js";
import { database } from "./context.js";

export async function insertFactGuardAudit({ ticker, mode, summary }: any) {
  try {
    await database().insert(factGuardAudit).values({
      ticker: ticker ? String(ticker) : null, mode: String(mode || "shadow"), total: Number(summary?.total) || 0,
      passCount: Number(summary?.pass) || 0, softCount: Number(summary?.soft) || 0, hardCount: Number(summary?.hard) || 0,
      hardDetails: summary?.hardDetails?.length ? summary.hardDetails : null
    });
  } catch { /* audit must never block research */ }
}

export async function getFactGuardStats({ days = 14 }: { days?: number } = {}) {
  const cutoff = new Date(Date.now() - Math.max(1, Math.round(days)) * 86_400_000);
  const [row] = await database().select({
    runs: count(), totalChecks: sql<number>`coalesce(sum(${factGuardAudit.total}), 0)`,
    totalSoft: sql<number>`coalesce(sum(${factGuardAudit.softCount}), 0)`, totalHard: sql<number>`coalesce(sum(${factGuardAudit.hardCount}), 0)`,
    runsWithHard: sql<number>`coalesce(sum(case when ${factGuardAudit.hardCount} > 0 then 1 else 0 end), 0)`,
    firstAt: sql<Date | null>`min(${factGuardAudit.createdAt})`, lastAt: sql<Date | null>`max(${factGuardAudit.createdAt})`
  }).from(factGuardAudit).where(gte(factGuardAudit.createdAt, cutoff));
  const totalChecks = Number(row?.totalChecks || 0);
  return { runs: Number(row?.runs || 0), totalChecks,
    hardRate: totalChecks ? Math.round((Number(row.totalHard || 0) / totalChecks) * 1000) / 10 : null,
    softRate: totalChecks ? Math.round((Number(row.totalSoft || 0) / totalChecks) * 1000) / 10 : null,
    runsWithHard: Number(row?.runsWithHard || 0), firstAt: row?.firstAt?.toISOString() || null, lastAt: row?.lastAt?.toISOString() || null };
}

export async function getRecentHardFails(limit = 20) {
  return database().select().from(factGuardAudit).where(gt(factGuardAudit.hardCount, 0)).orderBy(desc(factGuardAudit.id))
    .limit(Math.min(200, Math.max(1, limit)));
}
