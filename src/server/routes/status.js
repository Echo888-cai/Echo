import { sendJson } from "../utils/async.js";
import { getProviderStatus } from "../services/modelGateway.js";
import { getSourceHealthSummary, getLatestBatchId } from "../repositories/canaryRepository.js";
import { getHkFilingCoverage } from "../repositories/hkFinancialsRepository.js";
import { getProviderCallStats } from "../repositories/llmAuditRepository.js";
import { getFactGuardStats } from "../repositories/factGuardRepository.js";
import { quotaStatus } from "../services/quota.js";

const fmpKey = () => process.env.FMP_API_KEY;
const finnhubKey = () => process.env.FINNHUB_API_KEY;
const newsApiKey = () => process.env.ALPHAVANTAGE_API_KEY || process.env.TWELVEDATA_API_KEY;
const webSearchKey = () => process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY;

/** canary_runs 里的 source id → 面板展示名，和静态 `sources` 列表对齐方便对照。 */
const CANARY_SOURCE_LABELS = {
  market: "港美股行情", financials: "财务数据", news: "新闻舆情",
  filings: "公告数据", web_evidence: "网页证据层", hk_filing: "港股一手 filing", valuation: "估值链路",
  earnings: "财报日历", comp_peers: "同业可比"
};

export function handleStatusApi(req, res) {
  const userId = req.echoUser?.id || "local";
  const hasFmp = fmpKey();
  const hasNews = finnhubKey() || newsApiKey();
  const hasWebSearch = webSearchKey();
  const aiStatus = getProviderStatus();

  // G-1：真实数据 canary（`npm run canary`）落库的每源健康——不是配置态，是真实探测态。
  // 没跑过 canary 时这些都是空数组，面板会诚实显示"未探测过"而不是假装 ok。
  let canaryHealth = [];
  let canaryBatchId = null;
  let hkFilingCoverage = null;
  try {
    canaryHealth = getSourceHealthSummary().map((row) => ({
      source: row.source,
      label: CANARY_SOURCE_LABELS[row.source] || row.source,
      latestStatus: row.latest_status,
      latestDetail: row.latest_detail,
      latestCheckedAt: row.latest_checked_at,
      lastSuccessAt: row.last_success_at,
      lastFailureDetail: row.last_failure_detail,
      lastFailureAt: row.last_failure_at
    }));
    canaryBatchId = getLatestBatchId();
  } catch { /* canary 表若尚未迁移到（不应发生，但面板不能因此整体挂掉） */ }
  try {
    hkFilingCoverage = getHkFilingCoverage();
  } catch { /* 同上 */ }

  // E4：模型网关调用留痕汇总——谁在接、各自延迟/失败率、最近一次失败原因。
  let llmAudit = [];
  try {
    llmAudit = getProviderCallStats({ days: 7, userId }).map((row) => ({
      provider: row.provider,
      attempts: row.attempts,
      successes: row.successes,
      failures: row.failures,
      avgLatencyMs: row.avgLatencyMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimatedCostUsd: row.estimatedCostUsd,
      lastSuccessAt: row.lastSuccessAt,
      lastFailureDetail: row.lastFailureDetail,
      lastFailureAt: row.lastFailureAt
    }));
  } catch { /* llm_audit 表若尚未迁移到（不应发生，但面板不能因此整体挂掉） */ }

  // F-1：factGuard 命中留痕汇总——升档 shadow→soft→full 的真实依据（不再靠人工翻 console）。
  let factGuard = null;
  try {
    factGuard = { mode: (process.env.FACT_GUARD_MODE || "shadow").toLowerCase(), ...getFactGuardStats({ days: 14 }) };
  } catch { /* fact_guard_audit 表若尚未迁移到（不应发生，但面板不能因此整体挂掉） */ }

  sendJson(res, 200, {
    sources: [
      { id: "market", name: "港美股行情", status: "ok", detail: "港股 Tencent Finance；美股 Finnhub / Alpha Vantage / Yahoo" },
      { id: "financials", name: "财务数据", status: hasFmp ? "ok" : "limited", detail: hasFmp ? "FMP 已配置（注意：免费档不含港股，港股财报仍走腾讯/Yahoo 基础数据；港股完整三表需 FMP 付费档或其它港股数据源）" : "腾讯财经基础数据（PE/PB/市值）；港股完整三表需付费数据源" },
      { id: "news", name: "新闻舆情", status: hasNews ? "ok" : "limited", detail: hasNews ? "Yahoo RSS + Bing + 东方财富" : "Yahoo RSS + Bing + 东方财富（国内可用）" },
      { id: "web_evidence", name: "网页证据层", status: hasWebSearch ? "ok" : "limited", detail: hasWebSearch ? "Tavily / SerpAPI 已配置，证据带正文抓取、来源校验与可信度评分，缓存到 SQLite" : "公开兜底：DuckDuckGo + Yahoo + Bing，已做 404 校验与去垃圾；配 TAVILY_API_KEY（免费 1000/月）可解锁稳定全覆盖" },
      { id: "filings", name: "公告数据", status: "ok", detail: "HKEX 披露易 titleSearchServlet 真实端点（港股）；SEC EDGAR（美股）" },
      { id: "earnings", name: "财报日历", status: hasNews ? "ok" : "limited", detail: hasNews ? "Finnhub /calendar/earnings；港股经 ADR 映射核到，无映射时诚实标缺" : "需配置 FINNHUB_API_KEY" },
      { id: "comp_peers", name: "同业可比", status: hasNews ? "ok" : "limited", detail: hasNews ? "Finnhub /stock/peers 自动匹配；港股经 ADR 映射，无映射/同业不足 2 家时诚实标缺" : "需配置 FINNHUB_API_KEY" }
    ],
    evidenceBacklog: [
      { id: "financial_snapshots", label: "财报三表与估值倍数", priority: "P0", providers: ["FMP", "EODHD", "Finnhub"] },
      { id: "hkex_filings", label: "HKEX 公告与公司 IR PDF", priority: "P0", providers: ["HKEXnews", "Company IR"] },
      { id: "web_evidence", label: "可信 web 搜索证据层", priority: "P1", providers: ["Bing Search", "SerpAPI"] },
      { id: "analyst_estimates", label: "一致预期与目标价", priority: "P1", providers: ["Finnhub", "FMP", "EODHD"] }
    ],
    ai: aiStatus,
    db: { companies: "654+" },
    canary: { batchId: canaryBatchId, sources: canaryHealth },
    hkFilingCoverage,
    llmAudit,
    usage: quotaStatus(userId),
    factGuard,
    updatedAt: new Date().toISOString()
  });
}
