// G-1 测试：数据可信度底座（canary 落库 / hk_filing_ingest_log 覆盖率 / 状态路由）。
// 全部是 DB 层 + 纯函数测试，不发真实网络请求——真实探测本身由 `npm run canary` /
// `npm run hk-coverage` 手动跑（见 docs/PLAN.md §4 第 8 条：canary 不进 CI）。
import "./setupTestDb.mjs";
import { getDb } from "../src/db/index.js";
import { insertCanaryResult, getSourceHealthSummary, getLatestBatchId, getLatestBatchResults } from "../src/server/repositories/canaryRepository.js";
import { upsertHkFilingIngestLog, getHkFilingCoverage } from "../src/server/repositories/hkFinancialsRepository.js";
import { classifyIngestStatus, parseGeneralAnnouncements } from "../apps/worker/src/pipelines/hkFilingsPipeline.js";
import { handleStatusApi } from "../src/server/routes/status.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] classifyIngestStatus：纯函数分类（不发网络）");
{
  check("有 ingested → ok", classifyIngestStatus([{ url: "a" }], { ingested: [{ title: "x" }], skipped: [], errors: [] }) === "ok");
  check("只有 skipped（已是最新）→ ok", classifyIngestStatus([{ url: "a" }], { ingested: [], skipped: ["已入库"], errors: [] }) === "ok");
  check("HKEX 没有公告 → no_announcements", classifyIngestStatus([], { ingested: [], skipped: [], errors: [] }) === "no_announcements");
  check("有公告但全解析失败 → parse_failed", classifyIngestStatus([{ url: "a" }], { ingested: [], skipped: [], errors: ["解析失败"] }) === "parse_failed");
}

console.log("[2] canaryRepository：insertCanaryResult + 按 source 聚合健康汇总");
{
  const db = getDb();
  // 直接写入不同 created_at，模拟"这个源以前失败过，最近一次成功了"的真实场景
  // （insertCanaryResult 走表默认 datetime('now')，同一测试进程里时间戳几乎相同，
  // 聚合逻辑本身的正确性需要人为制造时间差来验证）。
  db.prepare(`INSERT INTO canary_runs (batch_id, source, ticker, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("batch-1", "market", "0700.HK", "error", "行情超时", "2026-01-01 00:00:00");
  db.prepare(`INSERT INTO canary_runs (batch_id, source, ticker, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("batch-2", "market", "0700.HK", "ok", "价 431.2", "2026-01-02 00:00:00");
  insertCanaryResult({ batchId: "batch-2", source: "news", ticker: "AAPL", status: "ok", detail: "3 篇", latencyMs: 120 });

  const summary = getSourceHealthSummary();
  const market = summary.find((s) => s.source === "market");
  check("market 最新状态是最近一批的 ok（不是更早那批的 error）", market.latest_status === "ok");
  check("market 记住了历史失败原因（供面板显示 lastFailureDetail 用）", market.last_failure_detail === "行情超时");
  check("market 记住了成功时间", !!market.last_success_at);
  check("news 源也在汇总里（insertCanaryResult 走的是真实插入路径）", summary.some((s) => s.source === "news"));

  check("getLatestBatchId 拿到时间上最新的一批", getLatestBatchId() === "batch-2");
  const latest = getLatestBatchResults();
  check("getLatestBatchResults 只返回最新一批的行", latest.results.every((r) => r.batch_id === "batch-2"));
}

console.log("[3] hk_filing_ingest_log：upsert 幂等 + 覆盖率统计");
{
  const db = getDb();
  db.prepare(`INSERT INTO companies (ticker, name_zh) VALUES (?, ?)`).run("0700.HK", "腾讯控股");
  db.prepare(`INSERT INTO companies (ticker, name_zh) VALUES (?, ?)`).run("9988.HK", "阿里巴巴-W");
  db.prepare(`INSERT INTO companies (ticker, name_zh) VALUES (?, ?)`).run("0002.HK", "中电控股");
  db.prepare(`INSERT INTO hk_financials (ticker, source_url) VALUES (?, ?)`).run("0700.HK", "https://example.com/0700.pdf");

  upsertHkFilingIngestLog({ ticker: "0700.HK", status: "ok", announcementsFound: 10, ingestedCount: 1 });
  upsertHkFilingIngestLog({ ticker: "9988.HK", status: "ok", announcementsFound: 8, ingestedCount: 0 });
  upsertHkFilingIngestLog({ ticker: "0002.HK", status: "parse_failed", detail: "解析不到收入行", announcementsFound: 3, ingestedCount: 0 });
  // 重复摄取同一 ticker（比如下次研究再触发后台补摄取）应该更新而不是新增一行
  upsertHkFilingIngestLog({ ticker: "0002.HK", status: "parse_failed", detail: "解析不到收入行（复查仍失败）", announcementsFound: 3, ingestedCount: 0 });

  const logCount = db.prepare("SELECT COUNT(*) n FROM hk_filing_ingest_log").get().n;
  check("同一 ticker 重复摄取 upsert 不产生重复行", logCount === 3, `实际 ${logCount}`);

  const cov = getHkFilingCoverage();
  check("totalHk 只数 .HK 结尾的公司", cov.totalHk === 3, `实际 ${cov.totalHk}`);
  check("withFirstParty 数 hk_financials 里有数据的 ticker 数", cov.withFirstParty === 1, `实际 ${cov.withFirstParty}`);
  check("checked 数已留痕的 ticker 数", cov.checked === 3, `实际 ${cov.checked}`);
  check("uncheckedCount = total - checked", cov.uncheckedCount === 0, `实际 ${cov.uncheckedCount}`);
  check("failed 只含非 ok 状态", cov.failed.length === 1 && cov.failed[0].ticker === "0002.HK");
  check("failed 带上公司名（JOIN companies）", cov.failed[0].company_name === "中电控股");
  check("failed 的 detail 是最新一次 upsert 的内容", cov.failed[0].detail === "解析不到收入行（复查仍失败）");
}

console.log("[4] parseGeneralAnnouncements（G-1.5）：真实 titleSearchServlet 响应形状 → 全类型公告，不限 PDF/不限业绩标题");
{
  // 取自真实 HKEX 响应（0700.HK）——翌日披露报表是 PDF 之外还会混着非 PDF 附件的
  // 典型全类型公告，parseHkexSearchResult（业绩专用）会把它们全部过滤掉。
  const raw = {
    result: JSON.stringify([
      { TITLE: "翌日披露報表", LONG_TEXT: "翌日披露報表 - [股份購回]", FILE_TYPE: "PDF", DATE_TIME: "03/07/2026 17:49", FILE_LINK: "/listedco/listconews/sehk/2026/0703/x.pdf" },
      { TITLE: "股東週年大會通告", LONG_TEXT: "股東週年大會通告", FILE_TYPE: "PDF", DATE_TIME: "01/06/2026 09:00", FILE_LINK: "/listedco/listconews/sehk/2026/0601/y.pdf" },
      { TITLE: "无链接的脏行", LONG_TEXT: "", FILE_TYPE: "PDF", DATE_TIME: "01/01/2026 00:00", FILE_LINK: "" }
    ])
  };
  const rows = parseGeneralAnnouncements(raw);
  check("不限业绩标题也能解析出来（翌日披露报表不含'業績'）", rows.some((r) => r.title === "翌日披露報表"));
  check("通函类公告也保留（不像 parseHkexSearchResult 那样按 NOISE_TITLE 排除）", rows.some((r) => r.title === "股東週年大會通告"));
  check("没有 FILE_LINK 的脏行被丢弃", !rows.some((r) => r.title === "无链接的脏行"));
  check("按时间倒序排列", rows[0].title === "翌日披露報表");
  check("URL 补全成绝对地址", rows[0].url.startsWith("https://www1.hkexnews.hk/"));
}

console.log("[5] /api/status：canary + hkFilingCoverage 字段存在，不因空数据抛错");
{
  let body = null;
  const res = { writeHead() {}, end(payload) { body = JSON.parse(payload); } };
  handleStatusApi({}, res);
  check("响应里有 canary 字段", body && "canary" in body);
  check("canary.sources 是数组", Array.isArray(body?.canary?.sources));
  check("响应里有 hkFilingCoverage 字段", body && "hkFilingCoverage" in body);
  check("hkFilingCoverage.totalHk 是数字", typeof body?.hkFilingCoverage?.totalHk === "number");
}

console.log(`\nG-1: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
