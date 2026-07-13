// B-5 测试：港股估值口径——三个真 bug 的回归测试。
// [1] 净现金 falsy 判断 bug：totalDebt===0（无负债）会被当"数据缺失"，DCF 净现金整段清零。
// [2] 腾讯港股字段名 totalShares vs sharesOutstanding 不对齐：EV/Sales 情景永远拿不到股本。
// [3] mergeHkFinancialGaps：第三方（腾讯）成功但只给基础行情时，一手 HKEX 抽取的
//     revenue/净利/现金流应该补进 financialsData，而不是只在第三方"全挂"时才用。
import "./setupTestDb.mjs";
import { computeValuation } from "../src/server/services/valuationEngine.js";
import { mergeHkFinancialGaps } from "../src/server/services/dataSources.js";
import { hkRowToFinancials } from "../apps/worker/src/pipelines/hkFilingsPipeline.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] DCF 净现金 falsy bug：totalDebt=0（无负债）不该被当净现金缺失");
{
  const withZeroDebt = computeValuation(
    { ticker: "TEST", price: 100 },
    { price: 100, pe: 15 },
    {
      providerStatus: "ok", eps: 5, pe: 15, revenueGrowth: 10,
      freeCashFlow: 1000000000, sharesOutstanding: 100000000,
      cashAndEquivalents: 500000000, totalDebt: 0
    }
  );
  const dcf = withZeroDebt.methodDetail?.find((m) => m.name === "DCF");
  check("DCF 方法命中", !!dcf, JSON.stringify(withZeroDebt.methods));
  // 净现金 5 亿、股本 1 亿 → 每股净现金 5，应该被计入 equityValue，而不是被当 0
  const withCash = dcf.base;
  const noCash = computeValuation(
    { ticker: "TEST", price: 100 },
    { price: 100, pe: 15 },
    {
      providerStatus: "ok", eps: 5, pe: 15, revenueGrowth: 10,
      freeCashFlow: 1000000000, sharesOutstanding: 100000000,
      cashAndEquivalents: 0, totalDebt: 0
    }
  ).methodDetail.find((m) => m.name === "DCF").base;
  check("有净现金时 DCF 目标价比无现金时更高（净现金真的计入了）", withCash > noCash, `${withCash} vs ${noCash}`);
}

console.log("[2] 腾讯港股字段名对齐：sharesOutstanding（而非 totalShares）能被 EV/Sales 情景读到");
{
  // 模拟腾讯路径合并后的 financialsData：亏损港股，只有 sharesOutstanding（来自 marketCap/price）
  const v = computeValuation(
    { ticker: "9999.HK", price: 50 },
    { price: 50, marketCap: 50000000000 },
    {
      providerStatus: "ok", eps: -1.2, netMargin: -8, revenueGrowth: 30,
      revenue: 20000000000, sharesOutstanding: 1000000000,
      cashAndEquivalents: 3000000000, netCash: 3000000000
    }
  );
  check("亏损港股走 EV/Sales 情景（不是无法估值）", v.stageAware === true && v.cannotValueReason === null, JSON.stringify(v));
  check("EV/Sales 情景给出了 bear/base/bull", v.bear !== null && v.base !== null && v.bull !== null);
}

console.log("[3] EV/Sales 情景优先用显式 netCash（一手抽取只给净现金，不拆现金/负债两项）");
{
  const v = computeValuation(
    { ticker: "9999.HK", price: 50 },
    { price: 50, marketCap: 50000000000 },
    {
      providerStatus: "ok", eps: -1.2, netMargin: -8, revenueGrowth: 30,
      revenue: 20000000000, sharesOutstanding: 1000000000,
      // 没有 cashAndEquivalents/totalDebt，只有 netCash（一手抽取的真实情况）
      netCash: 3000000000
    }
  );
  check("只给 netCash 也能算出 EV/Sales（不因缺 cash/debt 拆分而放弃）", v.stageAware === true && v.bear !== null, JSON.stringify(v));
}

console.log("[4] mergeHkFinancialGaps：腾讯成功但只给行情时，一手抽取补空真实财务字段");
{
  // 腾讯路径成功：有 price/pe/eps/marketCap，但 revenue/netIncome/cashAndEquivalents 全是 null
  const tencentLike = {
    source: "腾讯财经 · 测试", providerStatus: "ok", currency: "HKD",
    price: 50, pe: 12, eps: 4.2, marketCap: 50000000000,
    revenue: null, grossProfit: null, operatingIncome: null, netIncome: null,
    cashAndEquivalents: null, netCash: null, operatingCashFlow: null,
    revenueGrowth: null, grossMargin: null, operatingMargin: null, netMargin: null, profitGrowth: null
  };
  const hkRow = hkRowToFinancials({
    ticker: "9999.HK", period_label: "2026 FY", currency: "HKD",
    revenue: 20000000000, revenue_prior: 18000000000,
    net_income: 2000000000, net_income_prior: 1500000000,
    gross_profit: 8000000000, operating_income: 3000000000,
    eps: 4.5, operating_cash_flow: 2500000000,
    cash_and_equivalents: 3000000000, net_cash: 2800000000,
    source_url: "https://example.com/fy.pdf", extracted_at: new Date().toISOString()
  });
  mergeHkFinancialGaps(tencentLike, hkRow);
  check("revenue 从一手抽取补上", tencentLike.revenue === 20000000000, `got ${tencentLike.revenue}`);
  check("netIncome 从一手抽取补上", tencentLike.netIncome === 2000000000);
  check("netCash 从一手抽取补上", tencentLike.netCash === 2800000000);
  check("腾讯自带的 eps 不被一手数据覆盖（避免币种/口径混用拼出假自洽 PE）", tencentLike.eps === 4.2);
  check("腾讯自带的 price/pe 保持不变", tencentLike.price === 50 && tencentLike.pe === 12);
}

console.log("[5] mergeHkFinancialGaps：人民币列报按近似汇率折算成港元再补空");
{
  const tencentLike = {
    providerStatus: "ok", currency: "HKD", price: 50, pe: 12, eps: 4.2,
    revenue: null, netIncome: null, cashAndEquivalents: null, netCash: null,
    grossProfit: null, operatingIncome: null, operatingCashFlow: null,
    revenueGrowth: null, grossMargin: null, operatingMargin: null, netMargin: null, profitGrowth: null
  };
  const hkRowCny = hkRowToFinancials({
    ticker: "9999.HK", period_label: "2026 FY", currency: "CNY",
    revenue: 1000000000, net_income: 100000000, net_cash: 200000000,
    source_url: "https://example.com/fy2.pdf", extracted_at: new Date().toISOString()
  });
  mergeHkFinancialGaps(tencentLike, hkRowCny);
  check("人民币收入按 1.08 折算成港元", Math.abs(tencentLike.revenue - 1000000000 * 1.08) < 1, `got ${tencentLike.revenue}`);
}

console.log("[6] 回归（浏览器/真实数据实测抓到）：单一近零经营利润率噪音不该覆盖清晰为正的净利润");
{
  // 阿里巴巴 26Q1 真实数据复现：经营利润率 -0.05%（一次性费用噪音），净利率 +9.7%，EPS +15.07。
  // 修复前的 classifyAssetStage 对 eps/netMargin/opMargin 三者做 OR，opMargin 告负就整体判亏损，
  // 把巨头误判成"亏损高成长"、套 EV/Sales 情景算出远低于合理区间的估值带。
  const v = computeValuation(
    { ticker: "9988.HK", price: 94.1 },
    { price: 94.1, pe: 15.4 },
    {
      providerStatus: "ok", eps: 15.07, netMargin: 9.66, operatingMargin: -0.05,
      revenueGrowth: 2.9, revenue: 262850400000, sharesOutstanding: 19206311690
    }
  );
  check("净利润清晰为正时不被单独告负的经营利润率误判为亏损情景", v.stageAware !== true, JSON.stringify(v.method));
}

console.log(`\nB-5: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
