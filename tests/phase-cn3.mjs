// P-CN-3 测试：估值引擎对 A 股（CNY 计价）数据同样生效——验证"valuationEngine 市场无关"
// 这个假设在真实 CN 数据形状下成立（引擎本身没有 isUS/detectMarket 调用，只要
// financialsData/marketSnapshot 归一化正确，估值数学应该和港股/美股完全一致）。
// 用真实贵州茅台 2026 Q1 数据（cnFilingsPipeline 实测抽出，见 phase-cn2.mjs）做输入。
import "./setupTestDb.mjs";
import { computeValuation, classifyAssetStage } from "../src/server/services/valuationEngine.js";
import { mergeCnFinancialGaps } from "../src/server/services/dataSources.js";
import { cnRowToFinancials } from "../src/server/services/cnFilingsPipeline.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// 真实贵州茅台 2026 Q1 一手数据（cn_financials 行形状，来自巨潮资讯网真实抽取）。
const MOUTAI_CN_ROW = {
  ticker: "600519.SS",
  period_label: "2026 Q1（截至 2026-03-31）",
  period_end: "2026-03-31",
  currency: "CNY",
  revenue: 53909252220.51,
  revenue_prior: 50600957885.78,
  gross_profit: 48388523020.19,
  gross_profit_prior: 46539527335.35,
  net_income: 28153831489.89,
  net_income_prior: 27774636011.61,
  net_income_attributable: 27242512886.45,
  eps: 21.76,
  operating_cash_flow: 26909891269.13,
  cash_and_equivalents: 48786691397.55,
  net_cash: null,
  extracted_at: "2026-07-10 12:00:00",
  source_url: "http://static.cninfo.com.cn/finalpage/2026-04-25/1225187851.PDF"
};

console.log("[1] classifyAssetStage：A 股盈利公司（茅台）正确分到 profitable（估值引擎无市场分支，直接吃归一化数据）");
{
  const financials = cnRowToFinancials(MOUTAI_CN_ROW);
  check("currency 是 CNY（原币种，不需要 HK 那套 FX 换算）", financials.currency === "CNY");
  check("revenueGrowth 正确算出（真实同比 +6.54% 左右）", Math.abs(financials.revenueGrowth - 6.5) < 1, `实际 ${financials.revenueGrowth}`);
  check("grossMargin 正确算出（茅台真实毛利率约 89.8%）", Math.abs(financials.grossMargin - 89.8) < 1, `实际 ${financials.grossMargin}`);
  const stage = classifyAssetStage(financials);
  check("盈利公司分类为 profitable（不是 loss/loss_growth）", stage === "profitable", `实际 ${stage}`);
}

console.log("[2] computeValuation：CNY 计价的 financialsData 能算出完整估值（PE 法为主，价格/EPS 都是 CNY）");
{
  const financials = cnRowToFinancials(MOUTAI_CN_ROW);
  financials.pe = 18.21; // 真实腾讯行情核到的 PE（见 P-CN-2 端到端验证）
  financials.sharesOutstanding = 1250081601; // 茅台真实总股本量级
  const v = computeValuation(
    { ticker: "600519.SS", price: 1204.98 },
    { price: 1204.98, pe: 18.21, currency: "CNY" },
    financials
  );
  check("估值引擎正常出结果（不因 CNY 计价报错/拒绝）", v.cannotValueReason === null && v.methods.length > 0, JSON.stringify(v));
  check("PE 法命中（盈利阶段应优先用 PE，不是 EV/Sales）", v.methodDetail?.some((m) => m.name === "PE"), JSON.stringify(v.methods));
  check("bear/base/bull 三档都有值（辩证框架，同港股/美股口径一致）", v.bear !== null && v.base !== null && v.bull !== null);
}

console.log("[3] mergeCnFinancialGaps：第三方（腾讯）行情成功但只给基础字段时，一手 CNINFO 数据补齐 revenue/净利/现金流");
{
  // 模拟第三方（腾讯 A 股路径）只给到 price/pe/marketCap，financialsData 三表字段全是 null——
  // 同 mergeHkFinancialGaps 要解决的"腾讯成功但只给基础行情"场景，A 股走同一套字段补空逻辑。
  const target = {
    providerStatus: "ok", source: "腾讯财经 · 贵州茅台", currency: "CNY",
    price: 1204.98, pe: 18.21, marketCap: 1506323000000,
    revenue: null, grossProfit: null, netIncome: null, operatingCashFlow: null, cashAndEquivalents: null
  };
  const cnFinancials = cnRowToFinancials(MOUTAI_CN_ROW);
  mergeCnFinancialGaps(target, cnFinancials);
  check("revenue 从一手数据补齐（不需要 FX 换算，CN 本就 CNY 计价）", target.revenue === MOUTAI_CN_ROW.revenue);
  check("netIncome 从一手数据补齐", target.netIncome === MOUTAI_CN_ROW.net_income);
  check("operatingCashFlow 从一手数据补齐", target.operatingCashFlow === MOUTAI_CN_ROW.operating_cash_flow);
  check("firstPartySupplement 标记已设置（前端可以显示一手数据标签）", target.firstPartySupplement === true);
  check("已有的第三方字段（price/pe）不被覆盖", target.price === 1204.98 && target.pe === 18.21);
  check(
    "eps 不在补空字段里（同港股同一条规则：eps 要和第三方给的 pe 配对，避免混用口径把 PE 法算错）",
    target.eps === undefined
  );
}

console.log(`\nP-CN-3: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
