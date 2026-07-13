import { getLatestBatchId, getSourceHealthSummary } from "@echo/db/repositories/canaryRepository.js";
import { getFactGuardStats } from "@echo/db/repositories/factGuardRepository.js";
import { getHkFilingCoverage } from "@echo/db/repositories/hkFinancialsRepository.js";
import { getProviderCallStats, getUserDailyUsage } from "@echo/db/repositories/llmAuditRepository.js";

const sourceLabels: Record<string, string> = {
  market: "港美股行情", financials: "财务数据", news: "新闻舆情", filings: "公告数据",
  web_evidence: "网页证据层", hk_filing: "港股一手 filing", valuation: "估值链路",
  earnings: "财报日历", comp_peers: "同业可比"
};

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
  const hasFmp = Boolean(process.env.FMP_API_KEY);
  const hasNews = Boolean(process.env.FINNHUB_API_KEY || process.env.ALPHAVANTAGE_API_KEY || process.env.TWELVEDATA_API_KEY);
  const hasWebSearch = Boolean(process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY);
  let canaryHealth: Record<string, unknown>[] = [];
  let canaryBatchId: string | number | null = null;
  let hkFilingCoverage: unknown = null;
  let llmAudit: Record<string, unknown>[] = [];
  let factGuard: Record<string, unknown> | null = null;
  let usage: Record<string, unknown> = {};
  try {
    canaryHealth = (await getSourceHealthSummary()).map((row: any) => ({
      source: row.source, label: sourceLabels[row.source] || row.source, latestStatus: row.latest_status,
      latestDetail: row.latest_detail, latestCheckedAt: row.latest_checked_at, lastSuccessAt: row.last_success_at,
      lastFailureDetail: row.last_failure_detail, lastFailureAt: row.last_failure_at
    }));
    canaryBatchId = await getLatestBatchId();
  } catch { /* empty or unavailable diagnostics degrade honestly */ }
  try { hkFilingCoverage = await getHkFilingCoverage(); } catch { /* same */ }
  try { llmAudit = await getProviderCallStats({ days: 7, userId }) as Record<string, unknown>[]; } catch { /* same */ }
  try { factGuard = { mode: (process.env.FACT_GUARD_MODE || "full").toLowerCase(), ...await getFactGuardStats({ days: 14 }) }; } catch { /* same */ }
  try { usage = await usageStatus(userId); } catch { /* same */ }
  const ai = {
    configured: Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.MODEL_API_KEY),
    providers: ["deepseek", "openai", "anthropic", "generic"].filter((id) => Boolean(process.env[`${id.toUpperCase()}_API_KEY`]))
  };
  return {
    sources: [
      { id: "market", name: "港美股行情", status: "ok" as const, detail: process.env.MASSIVE_API_KEY ? "美股 Massive；港股授权行情" : "受授权路由约束的研究行情" },
      { id: "financials", name: "财务数据", status: hasFmp ? "ok" as const : "limited" as const, detail: hasFmp ? "FMP 已配置；一手 filing 交叉验证" : "一手 filing 为主，标准化三表覆盖有限" },
      { id: "news", name: "新闻舆情", status: hasNews ? "ok" as const : "limited" as const, detail: hasNews ? "新闻供应商已配置" : "公开新闻源有限" },
      { id: "web_evidence", name: "网页证据层", status: hasWebSearch ? "ok" as const : "limited" as const, detail: hasWebSearch ? "可信搜索证据已配置" : "公开证据检索有限" },
      { id: "filings", name: "公告数据", status: "ok" as const, detail: "HKEX、CNINFO、SEC 一手公告管道" },
      { id: "earnings", name: "财报日历", status: hasNews ? "ok" as const : "limited" as const, detail: hasNews ? "财报日历已配置" : "未配置日历供应商" },
      { id: "comp_peers", name: "同业可比", status: hasNews ? "ok" as const : "limited" as const, detail: hasNews ? "同业数据已配置" : "同业自动匹配有限" }
    ],
    evidenceBacklog: [
      { id: "financial_snapshots", label: "财报三表与估值倍数", priority: "P0", providers: ["FMP", "Intrinio"] },
      { id: "hkex_filings", label: "HKEX 公告与公司 IR PDF", priority: "P0", providers: ["HKEXnews", "Company IR"] },
      { id: "web_evidence", label: "可信 web 搜索证据层", priority: "P1", providers: ["Tavily", "SerpAPI"] },
      { id: "analyst_estimates", label: "一致预期与目标价", priority: "P1", providers: ["Finnhub", "FMP"] }
    ],
    ai, db: { companies: "PostgreSQL" }, canary: { batchId: canaryBatchId, sources: canaryHealth }, hkFilingCoverage,
    llmAudit, usage, factGuard, updatedAt: new Date().toISOString()
  };
}
