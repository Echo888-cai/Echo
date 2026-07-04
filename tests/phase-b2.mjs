// B-2 测试：财报趋势判断（classifyTrend）——从"只看最新一期同比"升级到"多期连续趋势"。
// [1] classifyTrend 纯函数：加速/放缓/拐点/持平/波动各分支 + 数据点不足时诚实返回 null。
// [2] financialsToMarkdown：有趋势数据时把趋势句子喂进模型提示词，没有时不留空行。
// [3] trendFromAnnualSeries：FMP 的 income-statement 端点被 402 挡住时，Finnhub 免费档
//     series.annual.* 是唯一能拿到多期历史的数据源，这个函数把它转成 classifyTrend 能吃的输入。
import "./setupTestDb.mjs";
import { classifyTrend, financialsToMarkdown, trendFromAnnualSeries } from "../src/financialData.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] classifyTrend：多期增速分类");
{
  check("数据点为 0 时返回 null", classifyTrend([]) === null);
  check("只有 1 个数据点时返回 null（判断不了趋势）", classifyTrend([12]) === null);

  const decel = classifyTrend([25, 18, 10, 4]);
  check("连续放缓识别为 decelerating", decel?.direction === "decelerating", JSON.stringify(decel));
  check("放缓的 label 里带具体数字序列", decel?.label.includes("25.0%") && decel?.label.includes("4.0%"));

  const accel = classifyTrend([2, 5, 9, 15]);
  check("连续加速识别为 accelerating", accel?.direction === "accelerating", JSON.stringify(accel));

  const downTurn = classifyTrend([8, 5, 2, -3]);
  check("由正转负识别为下行拐点 inflection_down", downTurn?.direction === "inflection_down", JSON.stringify(downTurn));

  const upTurn = classifyTrend([-5, -2, 3]);
  check("由负转正识别为修复拐点 inflection_up", upTurn?.direction === "inflection_up", JSON.stringify(upTurn));

  const flat = classifyTrend([9.8, 10.1, 9.9, 10.0]);
  check("在均值附近波动识别为 flat（企稳）", flat?.direction === "flat", JSON.stringify(flat));

  const mixed = classifyTrend([5, 15, 3, 20]);
  check("忽上忽下、无单一方向识别为 mixed", mixed?.direction === "mixed", JSON.stringify(mixed));
}

console.log("[2] financialsToMarkdown：趋势句子喂进模型提示词");
{
  const withTrend = financialsToMarkdown({
    providerStatus: "ok", source: "FMP", period: "2026-03-31",
    revenue: 1e11, revenueGrowth: 9.1,
    revenueTrend: { direction: "decelerating", label: "增速连续 3 期放缓（25.0% → 18.0% → 10.0% → 4.0%）", series: [25, 18, 10, 4] },
    grossProfit: 5e10, grossMargin: 50, operatingIncome: 2e10, operatingMargin: 20,
    netIncome: 1.5e10, netMargin: 15, profitGrowth: 5
  });
  check("markdown 里包含收入趋势句", withTrend.includes("增速连续 3 期放缓"));

  const withoutTrend = financialsToMarkdown({
    providerStatus: "ok", source: "FMP", period: "2026-03-31",
    revenue: 1e11, revenueGrowth: 9.1, revenueTrend: null,
    grossProfit: 5e10, grossMargin: 50, operatingIncome: 2e10, operatingMargin: 20,
    netIncome: 1.5e10, netMargin: 15, profitGrowth: 5
  });
  check("没有趋势数据时不强行输出空趋势行", !withoutTrend.includes("收入增速趋势"));
}

console.log("[3] trendFromAnnualSeries：Finnhub series.annual.* → classifyTrend 输入");
{
  // Finnhub 格式：index 0 = 最新一期，往后是更早的年份。
  const series = [
    { period: "2025-09-27", v: 27.7354 },
    { period: "2024-09-28", v: 25.3785 },
    { period: "2023-09-30", v: 24.2393 },
    { period: "2022-09-24", v: 24.1536 }
  ];
  const trend = trendFromAnnualSeries(series);
  check("4 期年报能算出趋势（非 null）", trend !== null, JSON.stringify(trend));
  check("增速全部为正（该样本逐年增长）", trend?.series.every((g) => g > 0), JSON.stringify(trend?.series));

  check("少于 3 期时诚实返回 null（算不出趋势）", trendFromAnnualSeries([{ period: "a", v: 1 }, { period: "b", v: 2 }]) === null);
  check("空数组返回 null", trendFromAnnualSeries([]) === null);
  check("非数组输入返回 null，不抛异常", trendFromAnnualSeries(null) === null && trendFromAnnualSeries(undefined) === null);
}

console.log(`\nB-2: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
