// B-4 测试：风险识别去占位符化——riskEngine.js 原本是没被接进主链路的死代码，真正显示
// 的风险只是 profile.risks 原样回显 + 一个万能占位 evidence。
// [1] buildRiskRadar：evidence 不再是无意义的字符串 ID，而是指向真实来源/数字的对象；
//     新增财报趋势（B-2）驱动的风险识别（连续放缓/拐点），比单期阈值更早预警。
// [2] buildDecisionPanel 集成：riskTriggers 真的用上了 buildRiskRadar，不再是 profile.risks 空转。
import "./setupTestDb.mjs";
import { buildRiskRadar } from "@echo/domain";
import { buildDecisionPanel } from "../src/server/services/decisionPanel.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] buildRiskRadar：evidence 是真实对象，不是占位字符串 ID");
{
  const radar = buildRiskRadar(
    { ticker: "TEST.HK", risks: ["行业监管趋严"], monitors: [] },
    {
      financialsData: { providerStatus: "ok", source: "FMP", asOf: "2026-06-30T00:00:00Z", debtToEquity: 250, freeCashFlow: -100, grossMargin: 50, revenueGrowth: -15, revenueTrend: null, profitTrend: null },
      marketSnapshot: { providerStatus: "ok", price: 10, changePercent: 2, source: "Tencent", asOf: "2026-06-30T00:00:00Z" },
      newsSnapshot: { providerStatus: "ok", articles: [{ title: "x" }], sentiment: { negativeCount: 1 }, source: "Yahoo", asOf: "2026-06-30T00:00:00Z" },
      filingsData: { providerStatus: "missing" }
    }
  );
  const debtRisk = radar.risks.find((r) => r.label === "高负债率");
  check("高负债率风险命中", Boolean(debtRisk));
  check("evidence 是对象数组，不是字符串", Array.isArray(debtRisk.evidence) && typeof debtRisk.evidence[0] === "object");
  check("evidence 指向真实来源（FMP），不是占位符", debtRisk.evidence[0].source === "FMP");
  check("evidence 的 quote 里带具体数字（250%）", debtRisk.evidence[0].quote.includes("250"));
  check("evidence 带 asOf 时间戳（可追溯）", debtRisk.evidence[0].asOf === "2026-06-30T00:00:00Z");

  const fcfRisk = radar.risks.find((r) => r.label === "自由现金流为负");
  check("负 FCF 风险的 evidence 也是真实对象", fcfRisk?.evidence[0].source === "FMP");
}

console.log("[2] 财报趋势（B-2）驱动的风险识别——比单期阈值更早预警");
{
  // 收入增速 -15%（低于 -10% 阈值）本会命中"收入快速下滑"，但这次有趋势数据（拐点），
  // 应该优先用更具体的趋势风险，而不是笼统的单期阈值判断。
  const radarWithTrend = buildRiskRadar(
    { ticker: "TEST2.HK", risks: [], monitors: [] },
    {
      financialsData: {
        providerStatus: "ok", source: "FMP", asOf: "2026-06-30T00:00:00Z",
        debtToEquity: 50, freeCashFlow: 100, grossMargin: 50, revenueGrowth: -15,
        revenueTrend: { direction: "inflection_down", label: "增速由正转负（8.0% → 2.0% → -15.0%），出现下行拐点", series: [8, 2, -15] },
        profitTrend: null
      },
      marketSnapshot: { providerStatus: "missing" },
      newsSnapshot: { providerStatus: "missing", articles: [] },
      filingsData: { providerStatus: "missing" }
    }
  );
  const trendRisk = radarWithTrend.risks.find((r) => r.label === "收入增速转负（拐点）");
  check("有趋势数据时优先用拐点风险，而不是笼统的单期阈值风险", Boolean(trendRisk));
  check("没有同时出现笼统的'收入快速下滑'（避免重复报同一个风险）", !radarWithTrend.risks.some((r) => r.label === "收入快速下滑"));
  check("拐点风险严重度为高", trendRisk.severity === "高");
  check("trigger 直接引用趋势 label（可追溯到具体序列）", trendRisk.trigger.includes("下行拐点"));

  // 利润趋势连续放缓 → 独立于收入趋势也能识别（即使收入还在增长）。
  const radarProfitDecel = buildRiskRadar(
    { ticker: "TEST3.HK", risks: [], monitors: [] },
    {
      financialsData: {
        providerStatus: "ok", source: "FMP", asOf: "2026-06-30T00:00:00Z",
        debtToEquity: 50, freeCashFlow: 100, grossMargin: 50, revenueGrowth: 8,
        revenueTrend: null,
        profitTrend: { direction: "decelerating", label: "增速连续 2 期放缓（25.0% → 10.0% → 3.0%）", series: [25, 10, 3] }
      },
      marketSnapshot: { providerStatus: "missing" },
      newsSnapshot: { providerStatus: "missing", articles: [] },
      filingsData: { providerStatus: "missing" }
    }
  );
  const profitRisk = radarProfitDecel.risks.find((r) => r.label === "利润增速连续放缓");
  check("收入正常增长时也能独立识别利润增速放缓的风险", Boolean(profitRisk));
  check("放缓（非拐点）严重度为中", profitRisk.severity === "中");

  // 没有趋势数据时退回原来的单期阈值检查（零回归）。
  const radarNoTrend = buildRiskRadar(
    { ticker: "TEST4.HK", risks: [], monitors: [] },
    {
      financialsData: { providerStatus: "ok", source: "FMP", asOf: "2026-06-30T00:00:00Z", debtToEquity: 50, freeCashFlow: 100, grossMargin: 50, revenueGrowth: -15, revenueTrend: null, profitTrend: null },
      marketSnapshot: { providerStatus: "missing" },
      newsSnapshot: { providerStatus: "missing", articles: [] },
      filingsData: { providerStatus: "missing" }
    }
  );
  check("没有趋势数据时退回单期阈值检查（零回归）", radarNoTrend.risks.some((r) => r.label === "收入快速下滑"));
}

console.log("[3] buildDecisionPanel 集成：riskTriggers 真的用上了 buildRiskRadar");
{
  const panel = buildDecisionPanel({
    question: "分析",
    company: { ticker: "TEST5.HK", nameZh: "测试公司", currency: "HKD", risks: [], monitors: [] },
    marketSnapshot: { providerStatus: "missing" },
    newsSnapshot: { providerStatus: "missing", articles: [] },
    financialsData: { providerStatus: "ok", source: "FMP", asOf: "2026-06-30T00:00:00Z", debtToEquity: 300, freeCashFlow: 100, grossMargin: 50, revenueGrowth: 5, revenueTrend: null, profitTrend: null },
    filingsData: { providerStatus: "missing", filings: [] },
    estimatesData: { providerStatus: "missing" }
  });
  const debtTrigger = panel.riskTriggers.find((t) => t.label === "高负债率");
  check("面板的 riskTriggers 里出现了 buildRiskRadar 识别到的真实财务风险", Boolean(debtTrigger));
  check("面板里的 evidence 也是真实对象（不是空占位符）", debtTrigger?.evidence[0]?.source === "FMP");
}

console.log("[4] 回归发现：'没踩线'和'数据不够'不能共用同一句话");
{
  // 浏览器实测 AAPL 抓到的真实场景：行情/财报/新闻全部 ok，但财务健康、没有一项触发
  // 阈值——这时候应该说"没识别到风险信号"（积极结果），而不是误导性的"数据不足"。
  const radarHealthy = buildRiskRadar(
    { ticker: "TEST6", risks: [], monitors: [] },
    {
      financialsData: { providerStatus: "ok", source: "Finnhub", asOf: "2026-07-04T00:00:00Z", debtToEquity: 50, freeCashFlow: 1e9, grossMargin: 47, revenueGrowth: 12, revenueTrend: null, profitTrend: null },
      marketSnapshot: { providerStatus: "ok", price: 300, changePercent: 1, source: "Twelve Data", asOf: "2026-07-04T00:00:00Z" },
      newsSnapshot: { providerStatus: "ok", articles: [{ title: "x" }], sentiment: { negativeCount: 0 }, source: "Finnhub", asOf: "2026-07-04T00:00:00Z" },
      filingsData: { providerStatus: "missing" }
    }
  );
  check("数据充分但没踩线时不再误说'缺乏足够数据'", !radarHealthy.risks.some((r) => r.label.includes("缺乏足够数据")));
  check("而是给出'未识别到风险信号'这类积极结果的措辞", radarHealthy.risks.some((r) => r.label === "未识别到需要警惕的风险信号"));

  // 真正数据缺失时仍然老实说数据不足（零回归）。
  const radarMissing = buildRiskRadar({ ticker: "TEST7", risks: [], monitors: [] }, {
    financialsData: { providerStatus: "missing" },
    marketSnapshot: { providerStatus: "missing" },
    newsSnapshot: { providerStatus: "ok", articles: [{ title: "x" }], sentiment: { negativeCount: 0 } },
    filingsData: { providerStatus: "missing" }
  });
  check("数据真的不够时仍然老实说数据不足", radarMissing.risks.some((r) => r.label.includes("缺乏足够数据")));
}

console.log(`\nB-4: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
