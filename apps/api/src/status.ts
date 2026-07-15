import { getLatestBatchId, getSourceHealthSummary } from "@echo/db/repositories/canaryRepository.js";
import { getFactGuardStats } from "@echo/db/repositories/factGuardRepository.js";
import { getHkFilingCoverage } from "@echo/db/repositories/hkFinancialsRepository.js";
import { getProviderCallStats, getUserDailyUsage } from "@echo/db/repositories/llmAuditRepository.js";

const sourceLabels: Record<string, string> = {
  market: "港美股行情", financials: "财务数据", news: "新闻舆情", filings: "公告数据",
  web_evidence: "网页证据层", hk_filing: "港股一手 filing", valuation: "估值链路",
  earnings: "财报日历", comp_peers: "同业可比",
  "market:yahoo-chart": "行情 · Yahoo", "market:finnhub": "行情 · Finnhub",
  "market:twelvedata": "行情 · Twelve Data", "market:alphavantage": "行情 · Alpha Vantage",
  "financials:fmp": "财务 · FMP", "earnings:finnhub": "财报日历 · Finnhub",
  "earnings:hk-adr-finnhub": "财报日历 · Finnhub（港股 ADR 映射）",
  "comp_peers:finnhub": "同业可比 · Finnhub"
};

/** Capability prefixes packages/data-plane/src/canary.ts actually writes today,
 *  as `${capability}:${adapter.id}`. canary_runs still holds bare-capability rows
 *  ("news", "web_evidence", "comp_peers", "market"…) written by a retired canary
 *  implementation that no longer exists: nothing will ever refresh them, so the
 *  settings panel rendered a permanent ✓ 最近成功 for 网页证据层 and 同业可比 —
 *  capabilities with no adapter at all — under a header promising 状态来自真实数据
 *  调用. Drop them from the health view rather than present them as live truth. */
const PROBE_CAPABILITIES = ["market", "financials", "earnings", "comp_peers"];

function isLiveProbeSource(source: string) {
  return PROBE_CAPABILITIES.some((capability) => source.startsWith(`${capability}:`));
}

/** getSourceHealthSummary() runs raw SQL whose window-function columns come back
 *  as postgres' own text rendering ("2026-07-15 10:02:37.254059+08") instead of
 *  Date objects. The web's notifWhen() feeds that to Date.parse, which rejects a
 *  space separator and a 2-digit UTC offset (`+08`, not `+08:00`) — it returned
 *  NaN for every row, so every "最近成功 {time}" rendered with the time silently
 *  missing. Normalize at this boundary (where the non-ISO strings originate)
 *  rather than loosening the shared formatter for everyone. */
function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const normalized = String(value).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function usageStatus(userId: string) {
  const usage = await getUserDailyUsage(userId);
  const dailyCalls = userId === "local"
    ? positiveNumber("ECHO_OWNER_DAILY_MODEL_CALLS", positiveNumber("ECHO_DAILY_MODEL_CALLS", 40))
    : positiveNumber("ECHO_DAILY_MODEL_CALLS", 40);
  const dailyCostUsd = positiveNumber("ECHO_DAILY_COST_USD", 0);
  const callExceeded = dailyCalls > 0 && usage.successfulCalls >= dailyCalls;
  const costExceeded = dailyCostUsd > 0 && usage.estimatedCostUsd >= dailyCostUsd;
  return { ...usage, dailyCalls, dailyCostUsd, remainingCalls: dailyCalls > 0 ? Math.max(0, dailyCalls - usage.successfulCalls) : null,
    exhausted: callExceeded || costExceeded, reason: callExceeded ? "calls" : costExceeded ? "cost" : null };
}

export async function buildStatusSnapshot(userId = "local") {
  // These gate *which cards can have probe rows at all* (registry.ts only
  // registers an adapter when its key is set, so an unset key means no probe
  // ever ran — distinct from "probed and failed"). They never decide "ok".
  const hasFmp = Boolean(process.env.FMP_API_KEY);
  const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY);
  const hasWebSearch = Boolean(process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY);
  let canaryHealth: Record<string, unknown>[] = [];
  let canaryBatchId: string | number | null = null;
  let hkFilingCoverage: unknown = null;
  let llmAudit: Record<string, unknown>[] = [];
  let factGuard: Record<string, unknown> | null = null;
  let usage: Record<string, unknown> = {};
  try {
    canaryHealth = (await getSourceHealthSummary())
      .filter((row: any) => isLiveProbeSource(String(row.source)))
      .map((row: any) => ({
        source: row.source, label: sourceLabels[row.source] || row.source, latestStatus: row.latest_status,
        latestDetail: row.latest_detail, latestCheckedAt: toIsoTimestamp(row.latest_checked_at),
        lastSuccessAt: toIsoTimestamp(row.last_success_at),
        lastFailureDetail: row.last_failure_detail, lastFailureAt: toIsoTimestamp(row.last_failure_at)
      }));
    canaryBatchId = await getLatestBatchId();
  } catch { /* empty or unavailable diagnostics degrade honestly */ }
  try { hkFilingCoverage = await getHkFilingCoverage(); } catch { /* same */ }
  try { llmAudit = await getProviderCallStats({ days: 7, userId }) as Record<string, unknown>[]; } catch { /* same */ }
  // Default "shadow": matches packages/application/src/research.ts's actual behavior
  // when unset. "full" implies intercept+regenerate, which isn't built yet — don't
  // claim it by default.
  try { factGuard = { mode: (process.env.FACT_GUARD_MODE || "shadow").toLowerCase(), ...await getFactGuardStats({ days: 14 }) }; } catch { /* same */ }
  try { usage = await usageStatus(userId); } catch { /* same */ }
  const ai = {
    configured: Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.MODEL_API_KEY),
    providers: ["deepseek", "openai", "anthropic", "generic"].filter((id) => Boolean(process.env[`${id.toUpperCase()}_API_KEY`]))
  };
  // Every card below is derived from real canary probes
  // (packages/data-plane/src/canary.ts calls each registered external adapter
  // against a real ticker), never from `Boolean(process.env.X_API_KEY)` —
  // "configured but the probe fails" must be visible, not silently reported as
  // "ok". A capability with no adapter at all
  // says so rather than borrowing a sibling's env key as proof of life.
  const capabilityStatus = (capability: string, noun: string) => {
    const rows = canaryHealth.filter((row) => String(row.source).startsWith(`${capability}:`));
    if (!rows.length) return { status: "limited" as const, detail: "尚未跑过 canary 探测（npm run canary）" };
    const okRows = rows.filter((row) => row.latestStatus === "ok");
    const failed = rows.filter((row) => row.latestStatus !== "ok").map((row) => sourceLabels[String(row.source)] || String(row.source));
    return {
      status: okRows.length > 0 ? "ok" as const : "limited" as const,
      detail: `${okRows.length}/${rows.length} ${noun}探测成功${failed.length ? `；未通过：${failed.join("、")}` : ""}`
    };
  };
  return {
    sources: [
      { id: "market", name: "港美股行情", ...capabilityStatus("market", "行情源") },
      {
        id: "financials", name: "财务数据",
        ...(hasFmp
          ? capabilityStatus("financials", "财务源")
          : { status: "limited" as const, detail: "未配置 FMP_API_KEY；港股由一手 filing 覆盖，美股标准化三表缺失" })
      },
      // No news adapter exists anywhere in the repo. The old card read the
      // FINNHUB/ALPHAVANTAGE/TWELVEDATA keys — which are registered for *quotes*
      // only — and reported 新闻舆情 as "ok": exactly the 配置剧场 red line 2 forbids.
      { id: "news", name: "新闻舆情", status: "limited" as const, detail: "未接通：仓库内无新闻适配器（P3 待办）" },
      { id: "web_evidence", name: "网页证据层",
        ...(hasWebSearch
          ? { status: "ok" as const, detail: "Tavily 搜索适配器已接通，研究链路自动调用" }
          : { status: "limited" as const, detail: "未接通：未配置 TAVILY_API_KEY" }) },
      { id: "filings", name: "公告数据", status: "ok" as const, detail: "HKEX 一手公告管道" },
      {
        id: "earnings", name: "财报日历",
        ...(hasFinnhub
          ? capabilityStatus("earnings", "日历源")
          : { status: "limited" as const, detail: "未配置 FINNHUB_API_KEY；仅剩无写入方的 postgres 缓存" })
      },
      {
        id: "comp_peers", name: "同业可比",
        ...(hasFinnhub
          ? capabilityStatus("comp_peers", "同业源")
          : { status: "limited" as const, detail: "未配置 FINNHUB_API_KEY；同业发现与倍数均不可用" })
      }
    ],
    evidenceBacklog: [
      { id: "financial_snapshots", label: "财报三表与估值倍数", priority: "P0", providers: ["FMP", "Intrinio"] },
      { id: "hkex_filings", label: "HKEX 公告与公司 IR PDF", priority: "P0", providers: ["HKEXnews", "Company IR"] },
      { id: "web_evidence", label: "可信 web 搜索证据层", priority: "P3", providers: ["Tavily", "SerpAPI"] },
      { id: "analyst_estimates", label: "一致预期与目标价", priority: "P3", providers: ["Finnhub", "FMP"] }
    ],
    ai, db: { companies: "PostgreSQL" }, canary: { batchId: canaryBatchId, sources: canaryHealth }, hkFilingCoverage,
    llmAudit, usage, factGuard, updatedAt: new Date().toISOString()
  };
}
