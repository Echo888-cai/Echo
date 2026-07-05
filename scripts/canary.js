/**
 * `npm run canary` — 真实数据 canary（G-1/E1）。
 *
 * 对一小撮真实 ticker（0700.HK / 9988.HK / 9868.HK + AAPL / NVDA）跑一遍真实数据管道
 * 的每一段（行情/财报/新闻/公告/网页证据/港股一手 filing/估值链路），落库到
 * canary_runs，供设置页的数据源健康面板查询。
 *
 * 不进 CI（见 docs/PLAN.md §4 第 8 条）：CI 无 key、不该烧配额，真实探测是本机/scheduler
 * 的职责。退出码恒为 0——canary 是体检报告，不是门禁；哪些源挂了直接看输出/面板。
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { getMarketSnapshot } = await import("../src/marketData.js");
const { getFinancials } = await import("../src/financialData.js");
const { getNewsSnapshot } = await import("../src/newsData.js");
const { getRecentFilings } = await import("../src/filingData.js");
const { researchWebEvidence } = await import("../src/server/services/webEvidenceService.js");
const { computeValuation } = await import("../src/server/services/valuationEngine.js");
const { ingestHkFinancials } = await import("../src/server/services/hkFilingsPipeline.js");
const { getNextEarnings } = await import("../src/server/services/earningsCalendar.js");
const { getComparableCompanies } = await import("../src/server/services/compPeers.js");
const { getCompanyByTicker } = await import("../src/db/index.js");
const { isUS } = await import("../src/market.js");
const { insertCanaryResult } = await import("../src/server/repositories/canaryRepository.js");

const TICKERS = ["0700.HK", "9988.HK", "9868.HK", "AAPL", "NVDA"];
const batchId = new Date().toISOString();

function companyFor(ticker) {
  return getCompanyByTicker(ticker) || { ticker, nameZh: ticker, nameEn: ticker };
}

/** 包一层：记时长、抓异常，统一落库，探测函数互相独立不因一个挂了连锁失败。 */
async function probe(source, ticker, fn) {
  const start = Date.now();
  try {
    const { status, detail } = await fn();
    insertCanaryResult({ batchId, source, ticker, status, detail, latencyMs: Date.now() - start });
    return { source, ticker, status, detail };
  } catch (error) {
    const detail = error?.message || String(error);
    insertCanaryResult({ batchId, source, ticker, status: "error", detail, latencyMs: Date.now() - start });
    return { source, ticker, status: "error", detail };
  }
}

async function probeMarket(ticker) {
  const snap = await getMarketSnapshot(ticker);
  if (snap.providerStatus !== "ok" || !snap.price) return { status: "missing", detail: (snap.errors || []).join("; ") || "无价格" };
  return { status: "ok", detail: `${snap.source}：价 ${snap.price}` };
}

async function probeFinancials(ticker) {
  const fin = await getFinancials(ticker);
  if (fin.providerStatus !== "ok") return { status: "missing", detail: (fin.errors || []).join("; ") || "无数据" };
  return { status: "ok", detail: `营收 ${fin.revenue ?? "缺"}，净利 ${fin.netIncome ?? "缺"}` };
}

async function probeNews(ticker) {
  const news = await getNewsSnapshot(companyFor(ticker));
  if (news.providerStatus !== "ok" || !news.articles?.length) return { status: "missing", detail: (news.errors || []).join("; ") || "无文章" };
  return { status: "ok", detail: `${news.source}：${news.articles.length} 篇` };
}

async function probeFilings(ticker) {
  const fd = await getRecentFilings(ticker);
  if (fd.providerStatus !== "ok" || !fd.filings?.length) return { status: "missing", detail: (fd.errors || []).join("; ") || "无公告" };
  return { status: "ok", detail: `${fd.filings.length} 条公告` };
}

async function probeWebEvidence(ticker) {
  const company = companyFor(ticker);
  const result = await researchWebEvidence({ company, question: "最新业绩与股价驱动因素" });
  const items = result?.evidence || [];
  if (!items.length) return { status: "missing", detail: "网页证据检索为空（无 key 时走公开兜底，覆盖率本就差）" };
  return { status: "ok", detail: `${items.length} 条证据` };
}

async function probeHkFiling(ticker) {
  const result = await ingestHkFinancials(ticker, { limit: 1, force: false });
  if (result.ingested.length || result.skipped.length) return { status: "ok", detail: result.ingested[0]?.period || "已有一手数据" };
  return { status: "missing", detail: result.errors[0] || "HKEX 未搜到业绩公告" };
}

async function probeEarnings(ticker) {
  const result = await getNextEarnings(ticker);
  if (result.providerStatus === "error") return { status: "error", detail: result.detail };
  if (result.providerStatus === "missing") return { status: "missing", detail: result.detail || "无未来财报日" };
  return { status: "ok", detail: `${result.source}：下一业绩日 ${result.nextDate}${result.stale ? "（缓存）" : ""}` };
}

async function probeCompPeers(ticker) {
  const result = await getComparableCompanies(ticker);
  if (result.providerStatus === "error") return { status: "error", detail: result.detail };
  if (result.providerStatus === "missing") return { status: "missing", detail: result.detail || "未核到同业" };
  const partialTag = result.partial ? "（部分 peer 超时/不可用）" : "";
  const anchorTag = result.anchor ? `锚点 ${result.anchor.multipleType} ${result.anchor.n} 家` : "无锚点（同业不足 2 家）";
  return { status: result.partial ? "partial" : "ok", detail: `${result.peers.length} 家同业，${anchorTag}${partialTag}` };
}

async function probeValuation(ticker, market, financials) {
  const company = companyFor(ticker);
  const val = computeValuation(company, market, financials);
  if (val.cannotValueReason) return { status: "missing", detail: val.cannotValueReason };
  return { status: "ok", detail: `${val.method}：base ${val.base ?? "?"}` };
}

console.log(`\nEcho Research canary — batch ${batchId}\n`);

const rows = [];
for (const ticker of TICKERS) {
  const market = await probe("market", ticker, () => probeMarket(ticker));
  const financials = await probe("financials", ticker, () => probeFinancials(ticker));
  const news = await probe("news", ticker, () => probeNews(ticker));
  const filings = await probe("filings", ticker, () => probeFilings(ticker));
  const earnings = await probe("earnings", ticker, () => probeEarnings(ticker));
  const compPeers = await probe("comp_peers", ticker, () => probeCompPeers(ticker));
  const webEvidence = await probe("web_evidence", ticker, () => probeWebEvidence(ticker));
  const valuation = await probe("valuation", ticker, async () => {
    // 复用上面已经拉到的真实 snapshot，不重复请求；估值链路本身是本地计算，
    // 这里验证的是"有真实数据喂进去，estimate 引擎跑不跑得通"。
    const marketSnap = await getMarketSnapshot(ticker);
    const fin = await getFinancials(ticker);
    return probeValuation(ticker, marketSnap, fin);
  });
  const results = [market, financials, news, filings, earnings, compPeers, webEvidence, valuation];
  if (!isUS(ticker)) results.push(await probe("hk_filing", ticker, () => probeHkFiling(ticker)));
  rows.push(...results);

  console.log(`${ticker}`);
  for (const r of results) {
    const mark = r.status === "ok" ? "✓" : r.status === "partial" ? "◐" : r.status === "missing" ? "△" : "✗";
    console.log(`  ${mark} ${r.source.padEnd(12)} ${r.detail}`);
  }
}

const bad = rows.filter((r) => r.status !== "ok").length;
console.log(`\n结论：${rows.length} 项探测，${bad} 项非 ok（详情见上 / 设置页数据健康面板）。\n`);
