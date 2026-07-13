// F-4a 测试：股东回报供数（美股先行）——SEC Form 4 内部人净买卖。
// [1] parseForm4Xml：真实 Form 4 XML 结构（基于真实抓取的 AAPL 样例简化）解析正确，
//     跳过衍生品表（期权/RSU），跳过缺 shares 的畸形块。
// [2] aggregateInsiderTransactions：只统计 P/S 真实市场买卖，跳过 M/F/A/G 薪酬性交易；
//     净买卖方向、金额、去重内部人数、最近交易日正确。
// [3] insiderActivityRepository：落库/读回。
// [4] insiderActivity 服务：港股快速返回 missing（不碰网络）；TTL 缓存命中读本地不发请求。
// [5] financialsToMarkdown：insiderActivity 存在且 ok 时事实块出现该段，否则整体不出现
//     （不写"未核到"占位行，避免暗示港股本该有这项数据）。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { parseForm4Xml, aggregateInsiderTransactions } from "../src/secFilings.js";
import { getInsiderActivityRow, upsertInsiderActivity } from "../src/server/repositories/insiderActivityRepository.js";
import { getInsiderActivity } from "../src/server/services/insiderActivity.js";
import { financialsToMarkdown } from "../src/financialData.js";

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
async function checkAsync(description, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

// 简化版真实 Form 4 XML 结构（基于 2026-06-17 真实抓取的 AAPL CIK0000320193 备案简化，
// 保留 schema 形状：transactionCode 不包 <value>，其余字段包 <value>）。
const SAMPLE_FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000320193</issuerCik>
    <issuerName>Apple Inc.</issuerName>
    <issuerTradingSymbol>AAPL</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001214156</rptOwnerCik>
      <rptOwnerName>Cook Timothy D</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isOfficer>1</isOfficer>
      <isDirector>1</isDirector>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-15</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>S</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>50000</value></transactionShares>
        <transactionPricePerShare><value>210.5</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-15</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>F</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>16238</value></transactionShares>
        <transactionPricePerShare><value>296.42</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-15</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>M</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>30104</value></transactionShares>
        <transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <transactionDate><value>2026-06-15</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>M</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>30104</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </derivativeTransaction>
  </derivativeTable>
</ownershipDocument>`;

console.log("[1] parseForm4Xml");
check("正确解析 ownerName / isOfficer / isDirector", () => {
  const result = parseForm4Xml(SAMPLE_FORM4_XML);
  assert.equal(result.ownerName, "Cook Timothy D");
  assert.equal(result.isOfficer, true);
  assert.equal(result.isDirector, true);
});

check("非衍生品表提取 3 笔交易（衍生品表的 M 交易不计入）", () => {
  const { transactions } = parseForm4Xml(SAMPLE_FORM4_XML);
  assert.equal(transactions.length, 3);
});

check("字段解析正确（code/shares/price/acquiredDisposed）", () => {
  const { transactions } = parseForm4Xml(SAMPLE_FORM4_XML);
  const sale = transactions.find((t) => t.code === "S");
  assert.equal(sale.shares, 50000);
  assert.equal(sale.pricePerShare, 210.5);
  assert.equal(sale.acquiredDisposed, "D");
  assert.equal(sale.date, "2026-06-15");
});

check("价格只有 footnoteId（无 <value>）时 pricePerShare 诚实为 null，不误判成 0", () => {
  const { transactions } = parseForm4Xml(SAMPLE_FORM4_XML);
  const exercise = transactions.find((t) => t.code === "M");
  assert.equal(exercise.pricePerShare, null);
});

check("空/畸形 XML 不抛错，返回空交易列表", () => {
  assert.doesNotThrow(() => parseForm4Xml(""));
  assert.doesNotThrow(() => parseForm4Xml("<not valid xml"));
  assert.equal(parseForm4Xml("").transactions.length, 0);
});

console.log("\n[2] aggregateInsiderTransactions：只统计 P/S 真实市场买卖");
check("跳过 M/F 等薪酬性交易，只统计 S", () => {
  const parsed = parseForm4Xml(SAMPLE_FORM4_XML);
  const summary = aggregateInsiderTransactions([parsed]);
  assert.equal(summary.buyCount, 0);
  assert.equal(summary.sellCount, 1, "只有 1 笔 S（卖出），M/F 不计入");
  assert.equal(summary.netShares, -50000);
  assert.equal(summary.netValueUsd, Math.round(-50000 * 210.5));
});

check("净买入：多份 filing 汇总，方向正确叠加", () => {
  const sellFiling = { ownerName: "Cook Timothy D", transactions: [{ date: "2026-06-15", code: "S", shares: 50000, pricePerShare: 210.5, acquiredDisposed: "D" }] };
  const buyFiling = { ownerName: "Newstead Jennifer", transactions: [{ date: "2026-06-16", code: "P", shares: 1000, pricePerShare: 200, acquiredDisposed: "A" }] };
  const summary = aggregateInsiderTransactions([sellFiling, buyFiling]);
  assert.equal(summary.buyCount, 1);
  assert.equal(summary.sellCount, 1);
  assert.equal(summary.distinctInsiders, 2);
  assert.equal(summary.netShares, 1000 - 50000);
});

check("distinctInsiders 去重同一人多份 filing", () => {
  const parsed = parseForm4Xml(SAMPLE_FORM4_XML);
  const summary = aggregateInsiderTransactions([parsed, parsed]);
  assert.equal(summary.distinctInsiders, 1);
  assert.equal(summary.sellCount, 2, "同一人两份 filing 各一笔卖出，累加计数");
});

check("lastTransactionAt 取最晚日期", () => {
  const parsed = parseForm4Xml(SAMPLE_FORM4_XML);
  const summary = aggregateInsiderTransactions([parsed]);
  assert.equal(summary.lastTransactionAt, "2026-06-15");
});

check("空输入返回诚实的零值汇总，不报错", () => {
  const summary = aggregateInsiderTransactions([]);
  assert.equal(summary.netShares, 0);
  assert.equal(summary.distinctInsiders, 0);
  assert.equal(summary.lastTransactionAt, null);
});

console.log("\n[3] insiderActivityRepository：落库/读回");
check("upsert + get 往返正确，transactions_json 正确序列化/反序列化", () => {
  upsertInsiderActivity({
    ticker: "F4TEST", providerStatus: "ok", netShares: -50000, netValueUsd: -10525000,
    buyCount: 0, sellCount: 1, distinctInsiders: 1, lastTransactionAt: "2026-06-15",
    transactions: [{ ownerName: "Cook Timothy D", date: "2026-06-15", code: "S", shares: 50000, pricePerShare: 210.5, acquiredDisposed: "D" }]
  });
  const row = getInsiderActivityRow("F4TEST");
  assert.equal(row.net_shares, -50000);
  assert.equal(row.distinct_insiders, 1);
  assert.ok(row.transactions_json.includes("Cook Timothy D"));
});

check("重复 upsert 覆盖旧值（不是仅插入一次）", () => {
  upsertInsiderActivity({ ticker: "F4TEST", providerStatus: "ok", netShares: 1000, buyCount: 1, sellCount: 0, distinctInsiders: 1, lastTransactionAt: "2026-07-01", transactions: [] });
  const row = getInsiderActivityRow("F4TEST");
  assert.equal(row.net_shares, 1000);
});

console.log("\n[4] insiderActivity 服务：港股快速 missing（无网络）+ TTL 缓存命中");
await checkAsync("港股 ticker 立即返回 missing，不查缓存/不发网络请求", async () => {
  const result = await getInsiderActivity("0700.HK");
  assert.equal(result.providerStatus, "missing");
  assert.match(result.detail, /HKEX/);
});

await checkAsync("命中 24h TTL 缓存：直接返回缓存数据，不发真实网络请求", async () => {
  upsertInsiderActivity({
    ticker: "FCACHE", providerStatus: "ok", netShares: 2000, netValueUsd: 420000,
    buyCount: 1, sellCount: 0, distinctInsiders: 1, lastTransactionAt: "2026-07-01", transactions: []
  });
  const result = await getInsiderActivity("FCACHE");
  assert.equal(result.providerStatus, "ok");
  assert.equal(result.netShares, 2000);
  assert.equal(result.stale, false);
});

console.log("\n[5] financialsToMarkdown：内部人净买卖事实块");
check("insiderActivity 存在且 ok 时，事实块包含该段", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "Finnhub", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5,
    insiderActivity: { providerStatus: "ok", netShares: -50000, netValueUsd: -10525000, buyCount: 0, sellCount: 1, distinctInsiders: 1, lastTransactionAt: "2026-06-15" }
  });
  assert.match(md, /内部人净买卖/);
  assert.match(md, /净卖出 50,000 股/);
  assert.match(md, /1 位内部人/);
});

check("没有 insiderActivity 字段时，事实块不出现该段（不写'未核到'占位）", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "Finnhub", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5
  });
  assert.ok(!md.includes("内部人净买卖"));
});

check("insiderActivity.providerStatus 非 ok 时同样不出现该段", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "Finnhub", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5,
    insiderActivity: { providerStatus: "missing", detail: "港股无 SEC 备案" }
  });
  assert.ok(!md.includes("内部人净买卖"));
});

console.log(`\nF-4: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
