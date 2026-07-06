// F-5 测试：历史估值分位（近似口径，年度财年末 PE 快照分布）。
// [1] computeHistoricalValuationPercentile：纯函数，百分位/区间/样本不足降级/当前PE缺失降级。
// [2] historicalValuationRepository：落库/读回。
// [3] financialsToMarkdown：historicalValuation 存在且 ok 时事实块出现该段并显式标"近似口径"，
//     否则整体不出现。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { computeHistoricalValuationPercentile } from "../src/server/services/historicalValuation.js";
import { getHistoricalValuationRow, upsertHistoricalValuationSeries } from "../src/server/repositories/historicalValuationRepository.js";
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

const SAMPLE_SERIES = {
  providerStatus: "ok",
  stale: false,
  series: [
    { period: "2025-09-27", value: 33.5574 },
    { period: "2024-09-28", value: 37.5759 },
    { period: "2023-09-30", value: 27.8553 },
    { period: "2022-09-24", value: 24.0854 },
    { period: "2021-09-25", value: 25.3801 },
    { period: "2020-09-26", value: 34.2462 }
  ]
};

console.log("[1] computeHistoricalValuationPercentile");
check("6 年样本 + 当前 PE 落在区间内时正确算出百分位/区间/中位", () => {
  const result = computeHistoricalValuationPercentile(SAMPLE_SERIES, 30);
  assert.equal(result.providerStatus, "ok");
  assert.equal(result.sampleYears, 6);
  assert.equal(result.min, 24.0854);
  assert.equal(result.max, 37.5759);
  assert.equal(result.newestPeriod, "2025-09-27");
  assert.equal(result.oldestPeriod, "2020-09-26");
  // 30 高于 24.0854/25.3801/27.8553，低于 33.5574/34.2462/37.5759 → 3/6 = 50%
  assert.equal(result.percentile, 50);
});

check("当前 PE 高于历史全部样本时百分位为 100", () => {
  const result = computeHistoricalValuationPercentile(SAMPLE_SERIES, 999);
  assert.equal(result.percentile, 100);
});

check("当前 PE 低于历史全部样本时百分位为 0", () => {
  const result = computeHistoricalValuationPercentile(SAMPLE_SERIES, 1);
  assert.equal(result.percentile, 0);
});

check("样本 providerStatus 非 ok（样本不足）时诚实降级为 missing，不硬算百分位", () => {
  const result = computeHistoricalValuationPercentile(
    { providerStatus: "missing", series: [{ period: "2025-09-27", value: 33 }], detail: "历史年度 PE 样本仅 1 年（需要 ≥5 年），暂不生成分位" },
    30
  );
  assert.equal(result.providerStatus, "missing");
  assert.equal(result.percentile, null);
  assert.match(result.detail, /样本仅 1 年/);
});

check("当前 PE 不可用（null/负数/0）时诚实降级，不拿无效值算百分位", () => {
  const nullResult = computeHistoricalValuationPercentile(SAMPLE_SERIES, null);
  assert.equal(nullResult.providerStatus, "missing");
  assert.equal(nullResult.percentile, null);

  const negativeResult = computeHistoricalValuationPercentile(SAMPLE_SERIES, -5);
  assert.equal(negativeResult.providerStatus, "missing");
});

check("港股无 ADR 映射（providerStatus=missing，series 为空）原样透传 detail", () => {
  const result = computeHistoricalValuationPercentile(
    { providerStatus: "missing", series: [], detail: "港股无美股 ADR 映射，Finnhub 免费档无法核到历史估值序列" },
    30
  );
  assert.equal(result.providerStatus, "missing");
  assert.match(result.detail, /ADR 映射/);
});

console.log("\n[2] historicalValuationRepository：落库/读回");
check("upsert + get 往返正确，series_json 正确序列化/反序列化", () => {
  upsertHistoricalValuationSeries({ ticker: "F5TEST", series: SAMPLE_SERIES.series, providerStatus: "ok", detail: null });
  const row = getHistoricalValuationRow("F5TEST");
  assert.equal(row.provider_status, "ok");
  assert.ok(row.series_json.includes("33.5574"));
});

check("重复 upsert 覆盖旧值（不是仅插入一次）", () => {
  upsertHistoricalValuationSeries({ ticker: "F5TEST", series: [], providerStatus: "missing", detail: "样本不足" });
  const row = getHistoricalValuationRow("F5TEST");
  assert.equal(row.provider_status, "missing");
  assert.equal(row.series_json, null);
});

console.log("\n[3] financialsToMarkdown：历史估值分位事实块");
check("historicalValuation 存在且 ok 时，事实块包含该段并显式标'近似口径'", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "Finnhub", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5,
    historicalValuation: {
      providerStatus: "ok", metric: "pe", currentValue: 30, percentile: 50,
      sampleYears: 6, min: 24.0854, max: 37.5759, median: 29.72,
      oldestPeriod: "2020-09-26", newestPeriod: "2025-09-27"
    }
  });
  assert.match(md, /历史估值分位/);
  assert.match(md, /近似口径/);
  assert.match(md, /第 50 百分位/);
});

check("没有 historicalValuation 字段时，事实块不出现该段", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "Finnhub", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5
  });
  assert.ok(!md.includes("历史估值分位"));
});

check("historicalValuation.providerStatus 非 ok 时同样不出现该段", () => {
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "Finnhub", revenue: 1000, revenueGrowth: 10,
    grossProfit: 400, grossMargin: 40, operatingIncome: 200, operatingMargin: 20,
    netIncome: 100, netMargin: 10, profitGrowth: 5, eps: 1.5,
    historicalValuation: { providerStatus: "missing", detail: "样本不足" }
  });
  assert.ok(!md.includes("历史估值分位"));
});

console.log(`\nF-5: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
