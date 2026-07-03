// P7 港股一手数据管道测试：HKEX 搜索结果解析 / 标题期间解析 / 三表关键行解析（含 FY 区域限定）
// + hk_financials 落库回读 + 8-K item 抽取。全部纯函数或临时库，无网络。
import "./setupTestDb.mjs";
import {
  parseHkexSearchResult, parsePeriodFromTitle, parseResultsText, lineNumbers, hkRowToFinancials
} from "../src/server/services/hkFilingsPipeline.js";
import { upsertHkFinancials, getHkFinancials, hasHkFinancialsForUrl } from "../src/server/repositories/hkFinancialsRepository.js";
import { parse8KItems, htmlToText } from "../src/secFilings.js";
import { hkFilingsToMarkdown } from "../src/financialData.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] HKEX 搜索结果解析（parseHkexSearchResult）");
{
  const raw = {
    result: JSON.stringify([
      { TITLE: "截至二零二六年三月三十一日止三個月業績公佈", FILE_TYPE: "PDF", FILE_LINK: "/listedco/a.pdf", DATE_TIME: "13/05/2026 16:31", NEWS_ID: "1", LONG_TEXT: "公告及通告" },
      { TITLE: "2025 年報", FILE_TYPE: "PDF", FILE_LINK: "/listedco/b.pdf", DATE_TIME: "09/04/2026 17:21", NEWS_ID: "2", LONG_TEXT: "財務報表" },
      { TITLE: "有關業績公佈之澄清公告", FILE_TYPE: "PDF", FILE_LINK: "/listedco/c.pdf", DATE_TIME: "20/03/2026 08:00", NEWS_ID: "3", LONG_TEXT: "公告及通告" },
      { TITLE: "截至二零二五年十二月三十一日止年度全年業績公佈", FILE_TYPE: "HTM", FILE_LINK: "/listedco/d.htm", DATE_TIME: "18/03/2026 16:30", NEWS_ID: "4", LONG_TEXT: "公告及通告" }
    ])
  };
  const rows = parseHkexSearchResult(raw);
  check("只留业绩公告 PDF（年报/澄清/HTM 被排除）", rows.length === 1, `got ${rows.length}`);
  check("URL 拼上披露易域名", rows[0]?.url === "https://www1.hkexnews.hk/listedco/a.pdf");
  check("日期转 ISO", rows[0]?.publishedAt === "2026-05-13T16:31:00");
}

console.log("[2] 标题期间解析（parsePeriodFromTitle）");
{
  const q1 = parsePeriodFromTitle("截至二零二六年三月三十一日止三個月業績公佈");
  check("Q1 期末日", q1.periodEnd === "2026-03-31");
  check("Q1 期型", q1.periodType === "Q1");
  const fy = parsePeriodFromTitle("截至二零二五年十二月三十一日止年度全年業績公佈");
  check("FY 期末日", fy.periodEnd === "2025-12-31");
  check("FY 期型", fy.periodType === "FY");
  const q3 = parsePeriodFromTitle("截至二零二五年九月三十日止三個月及九個月業績公佈");
  check("三個月及九個月 → 首列为当季 Q3", q3.periodType === "Q3");
  const h1 = parsePeriodFromTitle("截至二零二五年六月三十日止六個月中期業績公告");
  check("六個月 → H1", h1.periodType === "H1");
  const ar = parsePeriodFromTitle("截至2025年12月31日止年度業績公告");
  check("阿拉伯数字日期", ar.periodEnd === "2025-12-31" && ar.periodType === "FY");
}

console.log("[3] 数字行解析（lineNumbers）");
check("忽略 % 列", JSON.stringify(lineNumbers("收入  196,458  180,022  9%  194,371  1%")) === "[196458,180022,194371]");
check("括号=负数", JSON.stringify(lineNumbers("收入成本  (85,193)  (79,529)")) === "[-85193,-79529]");
check("脚注引用列丢弃", JSON.stringify(lineNumbers("收入成本  3  (85,193)  (79,529)")) === "[-85193,-79529]");
check("EPS 小数保留", JSON.stringify(lineNumbers("－基本  6.431  5.252  22%  6.433")) === "[6.431,5.252,6.433]");

console.log("[4] 三表关键行解析（parseResultsText）");
const SAMPLE_Q = [
  "（人民幣百萬元，另有指明者除外）",
  "收入  196,458  180,022  9%",
  "收入成本  3  (85,193)  (79,529)",
  "毛利  111,265  100,493  11%",
  "經營盈利  67,375  57,566  17%",
  "期內盈利  59,392  49,725  19%",
  "本公司權益持有人應佔盈利  58,093  47,821  21%",
  "每股盈利（每股人民幣元）",
  "－基本  6.431  5.252  22%",
  "非國際財務報告準則每股盈利",
  "－基本  7.517  6.735  12%",
  "經營活動所得現金流量淨額  101,351  95,000",
  "現金及現金等價物  217,770  200,000",
  "現金淨額 (c)  146,860  107,145"
].join("\n");
{
  const p = parseResultsText(SAMPLE_Q, { periodType: "Q1" });
  check("币种 CNY + 百万单位", p.currency === "CNY" && p.unit === 1e6);
  check("收入换算绝对值", p.fields.revenue?.current === 196458e6);
  check("收入同比基数", p.fields.revenue?.prior === 180022e6);
  check("毛利", p.fields.grossProfit?.current === 111265e6);
  check("經營盈利", p.fields.operatingIncome?.current === 67375e6);
  check("期內盈利", p.fields.netIncome?.current === 59392e6);
  check("归属股东盈利", p.fields.netIncomeAttributable?.current === 58093e6);
  check("EPS 取 IFRS 基本每股（不乘单位）", p.fields.eps?.current === 6.431);
  check("经营现金流", p.fields.operatingCashFlow?.current === 101351e6);
  check("净现金（带脚注标记）", p.fields.netCash?.current === 146860e6);
}

console.log("[5] FY 区域限定（年度公告先放 Q4 摘要的坑）");
const SAMPLE_FY = [
  "（人民幣百萬元，另有指明者除外）",
  "截至下列日期止三個月",
  "收入  194,371  172,446  13%",
  "期內盈利  59,089  51,000  16%",
  "截至十二月三十一日止年度",
  "收入  751,766  660,257  14%",
  "毛利  422,593  349,000  21%",
  "期內盈利  229,801  196,000  17%",
  "每股盈利（每股人民幣元）",
  "－基本  24.749  21.000  18%"
].join("\n");
{
  const fy = parseResultsText(SAMPLE_FY, { periodType: "FY" });
  check("FY 公告取全年列而非 Q4 列", fy.fields.revenue?.current === 751766e6, `got ${fy.fields.revenue?.current}`);
  check("FY 净利取全年", fy.fields.netIncome?.current === 229801e6);
  check("FY EPS 取全年区", fy.fields.eps?.current === 24.749);
  const q = parseResultsText(SAMPLE_FY, { periodType: "Q4" });
  check("非 FY 期型不启用限定（取首个匹配）", q.fields.revenue?.current === 194371e6);
}

console.log("[6] hk_financials 落库回读（临时库）");
{
  upsertHkFinancials({
    ticker: "0700.HK", periodLabel: "2026 Q1（截至 2026-03-31）", periodEnd: "2026-03-31", periodType: "Q1",
    currency: "CNY", unitLabel: "人民幣百萬元",
    revenue: 196458e6, revenuePrior: 180022e6, netIncome: 59392e6, netIncomePrior: 49725e6,
    eps: 6.431, sourceTitle: "業績公佈", sourceUrl: "https://example.com/q1.pdf", publishedAt: "2026-05-13T16:31:00"
  });
  upsertHkFinancials({
    ticker: "0700.HK", periodLabel: "2025 FY（截至 2025-12-31）", periodEnd: "2025-12-31", periodType: "FY",
    currency: "CNY", unitLabel: "人民幣百萬元",
    revenue: 751766e6, netIncome: 229801e6, eps: 24.749,
    sourceTitle: "全年業績公佈", sourceUrl: "https://example.com/fy.pdf", publishedAt: "2026-03-18T16:30:00"
  });
  // 同 URL 重复摄取 → 更新而非新增
  upsertHkFinancials({
    ticker: "0700.HK", periodLabel: "2026 Q1（截至 2026-03-31）", periodEnd: "2026-03-31", periodType: "Q1",
    currency: "CNY", revenue: 196458e6, revenuePrior: 180022e6, netIncome: 59392e6, netIncomePrior: 49725e6, eps: 6.431,
    sourceTitle: "業績公佈（重跑）", sourceUrl: "https://example.com/q1.pdf", publishedAt: "2026-05-13T16:31:00"
  });
  const rows = getHkFinancials("0700.HK", 5);
  check("两期两行（upsert 幂等）", rows.length === 2, `got ${rows.length}`);
  check("按期末日期倒序", rows[0].period_type === "Q1" && rows[1].period_type === "FY");
  check("重跑覆盖 source_title", rows[0].source_title === "業績公佈（重跑）");
  check("hasHkFinancialsForUrl", hasHkFinancialsForUrl("https://example.com/fy.pdf") && !hasHkFinancialsForUrl("https://example.com/none.pdf"));

  const promoted = hkRowToFinancials(rows[0]);
  check("提升为主财务对象：来源标一手", promoted.source.includes("HKEX") && promoted.providerStatus === "ok");
  check("提升对象带增速（1 位小数）", promoted.revenueGrowth === 9.1, `got ${promoted.revenueGrowth}`);

  const md = hkFilingsToMarkdown(rows);
  check("事实块含两期与来源链接", md.includes("2026 Q1") && md.includes("2025 FY") && md.includes("https://example.com/q1.pdf"));
  check("人民币列报提示", md.includes("人民币列报"));
}

console.log("[7] 8-K item 抽取（parse8KItems / htmlToText）");
{
  const html = `<html><body>
    <p>Item 2.02. Results of Operations and Financial Condition</p>
    <p>On July 1, 2026, the Company issued a press release announcing its financial results for the quarter ended May 31, 2026.</p>
    <p>Item 9.01. Financial Statements and Exhibits</p>
    <p>(d) Exhibits: 99.1 Press release dated July 1, 2026.</p>
  </body></html>`;
  const items = parse8KItems(htmlToText(html));
  check("抽出两个 item", items.length === 2, `got ${items.length}`);
  check("2.02 带中文名", items[0]?.code === "2.02" && items[0]?.name.includes("业绩"));
  check("正文摘录", items[0]?.excerpt.includes("press release"));
  const dedup = parse8KItems("Item 2.02 Item 5.02 (toc refs) ...\nItem 2.02. Results of Operations. Full body text goes here with enough length to count.");
  check("目录裸引用去重取正文", dedup.length >= 1 && dedup.find((i) => i.code === "2.02")?.excerpt.includes("Full body"));
}

console.log(`\nP7: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
