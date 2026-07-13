// P-CN-2 测试：A 股一手数据管道（巨潮资讯网定期报告解析 + cn_financials 落库）。
// 用真实 A 股定期报告（浏览器实测下载解析）里发现的具体格式坑作为回归夹具：
//   - 贵州茅台（消费/白酒）：标准两栏格式，标签与首个数字之间常只有单个空格（不像
//     港股稳定 ≥2 空格），"单位：元 币种：人民币"词序
//   - 平安银行（银行业）：没有"营业成本"科目（毛利留空不强凑）+ 附注引用列污染
//     EPS（"基本每股收益(人民币元) 48 2.07 2.15"里的 48 是脚注编号不是数据）+
//     "（货币单位：人民币百万元）"词序
//   - 中兴通讯（科技）：同一份文档不同章节切换单位（摘要页百万元、正式合并利润表
//     "人民币千元"且无"单位："字样，直接跟在统计期间后面）
//   - 美的集团（家电）：单位直接写进字段名括号里（"营业收入（千元）"），且合并利润表
//     标题用"(...金额单位为人民币千元)"这第三种词序（"为"不是冒号）
// 全部是纯函数 + DB 层测试，不发真实网络请求（真实抓取由 `npm run cn-coverage` 手动跑，
// 同 hk-coverage 的既有惯例：docs/PLAN.md §4 第 8 条канary 不进 CI 的姊妹约定）。
import "./setupTestDb.mjs";
import {
  parseCninfoSearchResult, parseCnPeriodFromTitle, parseCnResultsText
} from "../apps/worker/src/pipelines/cnFilingsPipeline.js";
import {
  upsertCnFinancials, getCnFinancials, hasCnFinancialsForUrl,
  upsertCnFilingIngestLog, getCnFilingCoverage
} from "../src/server/repositories/cnFinancialsRepository.js";
import { getDb } from "../src/db/index.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] parseCninfoSearchResult：真实 hisAnnouncement/query 响应形状 → 定期报告清单");
{
  const raw = {
    announcements: [
      { announcementTitle: "贵州茅台2026年第一季度报告", announcementTime: 1745539200000, adjunctUrl: "finalpage/2026-04-25/1225187851.PDF" },
      { announcementTitle: "贵州茅台2025年年度报告摘要", announcementTime: 1776355200000, adjunctUrl: "finalpage/2026-04-17/1225114731.PDF" },
      { announcementTitle: "贵州茅台2025年年度报告（英文版）", announcementTime: 1776355200000, adjunctUrl: "finalpage/2026-04-17/1225114733.PDF" },
      { announcementTitle: "无链接的脏行", announcementTime: 1776355200000, adjunctUrl: "" }
    ]
  };
  const rows = parseCninfoSearchResult(raw);
  check("摘要版被排除（NOISE_TITLE）", !rows.some((r) => r.title.includes("摘要")));
  check("英文版被排除（NOISE_TITLE）", !rows.some((r) => r.title.includes("英文版")));
  check("没有 adjunctUrl 的脏行被丢弃", !rows.some((r) => r.title === "无链接的脏行"));
  check("正文报告保留", rows.some((r) => r.title === "贵州茅台2026年第一季度报告"));
  check("URL 补全成绝对地址（static.cninfo.com.cn）", rows[0].url.startsWith("http://static.cninfo.com.cn/"));
}

console.log("[2] parseCnPeriodFromTitle：A 股定期报告标题模板化解析");
{
  check("年度报告", JSON.stringify(parseCnPeriodFromTitle("贵州茅台2025年年度报告")) === JSON.stringify({ periodEnd: "2025-12-31", periodType: "FY", periodLabel: "2025 FY（截至 2025-12-31）" }));
  check("第一季度报告（带'第'字，茅台式）", parseCnPeriodFromTitle("贵州茅台2026年第一季度报告").periodEnd === "2026-03-31");
  check("一季度报告（不带'第'字，平安银行式实测）", parseCnPeriodFromTitle("平安银行2026年一季度报告").periodEnd === "2026-03-31");
  check("第三季度报告", parseCnPeriodFromTitle("贵州茅台2025年第三季度报告").periodEnd === "2025-09-30");
  check("半年度报告", parseCnPeriodFromTitle("某公司2025年半年度报告").periodEnd === "2025-06-30");
  check("中期报告（半年报另一种叫法）", parseCnPeriodFromTitle("某公司2025年中期报告").periodEnd === "2025-06-30");
  check("不认识的标题（临时公告）返回全 null", parseCnPeriodFromTitle("关于召开股东大会的通知").periodEnd === null);
}

console.log("[3] parseCnResultsText：贵州茅台真实季报片段——标签数字间单空格、标准两栏");
{
  // 取自真实 2026 年第一季度报告（浏览器实测下载解析），数字已核对与公开财报一致。
  const text = [
    "单位：元 币种：人民币",
    "营业收入  53,909,252,220.51  50,600,957,885.78  6.54",
    "归属于上市公司股东的净利润 27,242,512,886.45  26,847,474,238.76  1.47",
    "经营活动产生的现金流量净额 26,909,891,269.13  8,809,195,646.38  205.48",
    "基本每股收益（元/股）  21.76  21.38  1.78",
    "货币资金  48,786,691,397.55  51,690,610,946.50",
    "其中：营业成本  5,520,729,200.32  4,061,430,550.43"
  ].join("\n");
  const parsed = parseCnResultsText(text);
  check("营业收入本期/上期都取到", parsed.fields.revenue.current === 53909252220.51 && parsed.fields.revenue.prior === 50600957885.78);
  check("标签与首个数字只隔单空格也能正确取数（归属净利润）", parsed.fields.netIncomeAttributable.current === 27242512886.45);
  check("经营现金流量净额", parsed.fields.operatingCashFlow.current === 26909891269.13);
  check("EPS 保持原始精度，不做单位换算", parsed.fields.eps.current === 21.76);
  check("货币资金", parsed.fields.cashAndEquivalents.current === 48786691397.55);
  check("毛利 = 营业收入 - 营业成本（真实相减，不是编造）", Math.abs(parsed.fields.grossProfit.current - (53909252220.51 - 5520729200.32)) < 0.01);
  check("单位声明识别为元（不缩放）", parsed.unit === 1);
}

console.log("[4] parseCnResultsText：平安银行真实年报片段——无营业成本科目 + 附注引用列污染 EPS");
{
  const text = [
    "（货币单位：人民币百万元）",
    "营业收入  131,442  146,695  (10.4%)",
    "九、每股收益",
    "基本每股收益(人民币元)  48  2.07  2.15",
    "五、净利润（净亏损以“-”号填列）  28,153,831,489.89  27,774,636,011.61"
  ].join("\n");
  const parsed = parseCnResultsText(text);
  check("银行没有营业成本科目，毛利诚实留空（不强凑）", parsed.fields.grossProfit === undefined && parsed.fields.costOfRevenue === undefined);
  check(
    "附注引用列（脚注编号 48）被丢弃，取真实 EPS 2.07/2.15 而不是 48/2.07",
    parsed.fields.eps.current === 2.07 && parsed.fields.eps.prior === 2.15
  );
  check("营业收入按百万元换算成绝对值", parsed.fields.revenue.current === 131442000000);
}

console.log("[5] parseCnResultsText：中兴通讯真实年报片段——同一文档不同章节切换单位（局部状态而非整篇一次性正则）");
{
  const text = [
    "单位：百万元",
    "营业收入  133,895.5  121,298.8",
    "2025年度  人民币千元",
    "营业利润  6,361,809  9,342,181",
    "净利润  5,565,073  8,355,613"
  ].join("\n");
  const parsed = parseCnResultsText(text);
  check("摘要页百万元区域：营业收入按百万元换算", parsed.fields.revenue.current === 133895500000);
  check(
    "正式合并利润表切到人民币千元后，净利润按千元换算（此前 bug：沿用摘要页的百万元，净利润被放大 100 倍到 5.57 万亿）",
    parsed.fields.netIncome.current === 5565073000,
    `实际 ${parsed.fields.netIncome.current}`
  );
  check("营业利润同样按千元换算", parsed.fields.operatingIncome.current === 6361809000);
}

console.log("[6] parseCnResultsText：美的集团真实年报片段——单位写进字段名括号里 + 三大报表标题下方\"为\"字词序");
{
  const text = [
    "营业收入（千元）  456,451,731  407,149,600  12.11%  372,037,280",
    "(除特别注明外，金额单位为人民币千元)",
    "二、营业利润  52,978,773  46,393,752  29,166,472  28,720,667",
    "四、净利润  44,520,196  38,757,214  29,415,131  28,517,064"
  ].join("\n");
  const parsed = parseCnResultsText(text);
  check(
    "内联单位标注（营业收入（千元））被就地识别，不受尚未更新的 ambient unit 影响",
    parsed.fields.revenue.current === 456451731000
  );
  check(
    "'金额单位为'词序（无冒号）能被识别，净利润不再是营业收入的 10 倍以上（此前 bug）",
    parsed.fields.netIncome.current === 44520196000 && parsed.fields.netIncome.current < parsed.fields.revenue.current
  );
  check("营业利润同样受益于'为'字词序识别", parsed.fields.operatingIncome.current === 52978773000);
}

console.log("[7] cnFinancialsRepository：upsert 幂等 + 覆盖率统计");
{
  const db = getDb();
  db.prepare(`INSERT INTO companies (ticker, name_zh, exchange, currency) VALUES (?, ?, 'SSE', 'CNY')`).run("600519.SS", "贵州茅台");
  db.prepare(`INSERT INTO companies (ticker, name_zh, exchange, currency) VALUES (?, ?, 'SZSE', 'CNY')`).run("000001.SZ", "平安银行");
  db.prepare(`INSERT INTO companies (ticker, name_zh, exchange, currency) VALUES (?, ?, 'SZSE', 'CNY')`).run("000002.SZ", "万科A");

  upsertCnFinancials({ ticker: "600519.SS", periodLabel: "2026 Q1", periodEnd: "2026-03-31", currency: "CNY", revenue: 53909252220.51, sourceUrl: "https://static.cninfo.com.cn/a.pdf" });
  check("落库后能读回", getCnFinancials("600519.SS", 4).length === 1);
  check("hasCnFinancialsForUrl 命中已入库的 URL", hasCnFinancialsForUrl("https://static.cninfo.com.cn/a.pdf"));
  check("未入库的 URL 不命中", !hasCnFinancialsForUrl("https://static.cninfo.com.cn/not-exist.pdf"));

  // 重复摄取同一 URL 应该 upsert 覆盖，不是插入第二行
  upsertCnFinancials({ ticker: "600519.SS", periodLabel: "2026 Q1（更正）", periodEnd: "2026-03-31", currency: "CNY", revenue: 53909252220.51, sourceUrl: "https://static.cninfo.com.cn/a.pdf" });
  const rows = getCnFinancials("600519.SS", 4);
  check("同 source_url 重复 upsert 不产生重复行", rows.length === 1, `实际 ${rows.length}`);
  check("upsert 覆盖了旧值（period_label 更新）", rows[0].period_label === "2026 Q1（更正）");

  upsertCnFilingIngestLog({ ticker: "600519.SS", status: "ok", announcementsFound: 8, ingestedCount: 4 });
  upsertCnFilingIngestLog({ ticker: "000001.SZ", status: "ok", announcementsFound: 6, ingestedCount: 4 });
  upsertCnFilingIngestLog({ ticker: "000002.SZ", status: "parse_failed", detail: "解析不到营业收入行", announcementsFound: 2, ingestedCount: 0 });

  const cov = getCnFilingCoverage();
  check("totalCn 只数 .SS/.SZ 结尾的公司", cov.totalCn === 3, `实际 ${cov.totalCn}`);
  check("withFirstParty 数 cn_financials 里有数据的 ticker 数", cov.withFirstParty === 1, `实际 ${cov.withFirstParty}`);
  check("checked 数已留痕的 ticker 数", cov.checked === 3, `实际 ${cov.checked}`);
  check("failed 只含非 ok 状态且带公司名", cov.failed.length === 1 && cov.failed[0].company_name === "万科A");
}

console.log(`\nP-CN-2: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
