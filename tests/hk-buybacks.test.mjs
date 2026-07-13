// F-4b 测试：股东回报供数（港股）——HKEX 翌日披露报表（FF305）购回报告 + 股本趋势。
// [1] parseBuybackText：真实抽取文本结构（基于真实抓取的 0700.HK 翌日披露报表简化）解析
//     正确——购回报告行（交易日/股数/价格区间/总代价）+ 期末已发行股份总数。
// [2] hkBuybackRepository：落库/读回，source_url 唯一约束防重复摄取。
// [3] hkBuybackToMarkdown / financialsToMarkdown：hkBuybacks 存在时事实块出现该段并显式
//     标注"购回注销有滞后"，否则整体不出现。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { parseBuybackText } from "../apps/worker/src/pipelines/hkFilingsPipeline.js";
import { hasHkBuybackForUrl, upsertHkBuyback, listRecentHkBuybacks } from "../src/server/repositories/hkBuybackRepository.js";
import { financialsToMarkdown, hkBuybackToMarkdown } from "../src/financialData.js";

let pass = 0;
let fail = 0;
function check(description, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

// 基于 2026-07-06 真实抓取的 0700.HK 翌日披露报表（FF305）简化——保留正则依赖的关键行结构。
const SAMPLE_BUYBACK_TEXT = `
===== PAGE 1 =====
FF305
翌日披露報表
公司名稱：  騰訊控股有限公司
A. 已發行股份或庫存股份變動
於下列日期開始時的結存(註1)  2026年7月3日  9,092,234,841  0  9,092,234,841
於下列日期結束時的結存 (註5及6)  2026年7月6日  9,092,370,719  0  9,092,370,719
===== PAGE 5 =====
購回報告
第二章節
A.  購回報告
交易日  購回股份數目  購回方式 (註1)  每股購回價或每股最高購回價 (元)  每股最低購回價 (元)  付出的價格總額 (元)
1).  2026年7月6日  465,000 於本交易所進行  HKD  445.8 HKD  425.8 HKD  204,763,959
合共購回股份總數  465,000  合共付出的價格總額 (元)  HKD  204,763,959
`;

console.log("[1] parseBuybackText");
check("正确解析购回报告行（交易日/股数/价格区间/总代价）", () => {
  const { rows } = parseBuybackText(SAMPLE_BUYBACK_TEXT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tradeDate, "2026-07-06");
  assert.equal(rows[0].sharesRepurchased, 465000);
  assert.equal(rows[0].currency, "HKD");
  assert.equal(rows[0].priceHigh, 445.8);
  assert.equal(rows[0].priceLow, 425.8);
  assert.equal(rows[0].totalConsideration, 204763959);
});

check("正确解析期末已发行股份总数（股本趋势粗线数据）", () => {
  const { sharesIssuedTotal, periodEndDate } = parseBuybackText(SAMPLE_BUYBACK_TEXT);
  assert.equal(sharesIssuedTotal, 9092370719);
  assert.equal(periodEndDate, "2026-07-06");
});

check("没有购回报告行时返回空数组，不报错（如公告只是股份归属变动）", () => {
  const { rows } = parseBuybackText("公司名稱：測試\n沒有購回報告部分");
  assert.equal(rows.length, 0);
});

check("空/畸形文本不抛错", () => {
  assert.doesNotThrow(() => parseBuybackText(""));
  assert.doesNotThrow(() => parseBuybackText(undefined));
});

console.log("\n[2] hkBuybackRepository：落库/读回 + 唯一约束");
check("upsert + get 往返正确", () => {
  upsertHkBuyback({
    ticker: "0700.HK", tradeDate: "2026-07-06", sharesRepurchased: 465000,
    priceHigh: 445.8, priceLow: 425.8, totalConsideration: 204763959, currency: "HKD",
    sharesIssuedTotal: 9092370719, periodEndDate: "2026-07-06",
    sourceTitle: "翌日披露報表", sourceUrl: "https://example.com/f4btest1.pdf", publishedAt: "2026-07-06T17:55:00"
  });
  assert.equal(hasHkBuybackForUrl("https://example.com/f4btest1.pdf"), true);
  const rows = listRecentHkBuybacks("0700.HK", 180);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares_repurchased, 465000);
});

check("同 source_url 重复 upsert 幂等（不重复插入）", () => {
  upsertHkBuyback({
    ticker: "0700.HK", tradeDate: "2026-07-06", sharesRepurchased: 999999,
    priceHigh: 1, priceLow: 1, totalConsideration: 1, currency: "HKD",
    sourceTitle: "重复测试", sourceUrl: "https://example.com/f4btest1.pdf", publishedAt: "2026-07-06T17:55:00"
  });
  const rows = listRecentHkBuybacks("0700.HK", 180);
  assert.equal(rows.length, 1, "同 source_url 不应重复插入");
  assert.equal(rows[0].shares_repurchased, 465000, "首次写入的值不应被覆盖（ON CONFLICT DO NOTHING）");
});

check("listRecentHkBuybacks 按 trade_date 新→旧排序", () => {
  upsertHkBuyback({
    ticker: "0700.HK", tradeDate: "2026-06-30", sharesRepurchased: 1174000,
    priceHigh: 435.2, priceLow: 418.4, totalConsideration: 500600291, currency: "HKD",
    sharesIssuedTotal: 9092234841, periodEndDate: "2026-06-30",
    sourceTitle: "翌日披露報表", sourceUrl: "https://example.com/f4btest2.pdf", publishedAt: "2026-06-30T18:17:00"
  });
  const rows = listRecentHkBuybacks("0700.HK", 180);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].trade_date, "2026-07-06", "最新的排前面");
  assert.equal(rows[1].trade_date, "2026-06-30");
});

console.log("\n[3] hkBuybackToMarkdown / financialsToMarkdown：港股回购事实块");
check("hkBuybackToMarkdown 汇总累计购回股数/总代价，标注股本趋势与滞后限制", () => {
  const rows = listRecentHkBuybacks("0700.HK", 180);
  const md = hkBuybackToMarkdown(rows);
  assert.match(md, /港股回购/);
  assert.match(md, /累计购回 1,639,000 股/);
  assert.match(md, /注销有滞后/);
});

check("空数组时返回空字符串", () => {
  assert.equal(hkBuybackToMarkdown([]), "");
  assert.equal(hkBuybackToMarkdown(null), "");
});

check("financialsToMarkdown：hkBuybacks 存在时事实块出现该段", () => {
  const rows = listRecentHkBuybacks("0700.HK", 180);
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "腾讯", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5,
    hkBuybacks: rows
  });
  assert.match(md, /港股回购/);
});

check("没有 hkBuybacks 字段时，事实块不出现该段", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "腾讯", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5
  });
  assert.ok(!md.includes("港股回购"));
});

console.log(`\nF-4b: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
