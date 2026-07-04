// EA-2 测试：受控规划器 planCompare（"两标的对比"句式）。
// 只用本地已知公司（腾讯/阿里巴巴等）验证，避免打网络（未命中时才会走 FMP/Finnhub/LLM）。
import { looksLikeCompareQuestion, planCompare } from "../src/server/services/agentPlanner.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] looksLikeCompareQuestion：纯文本判定，无网络");
check("比较句式命中", looksLikeCompareQuestion("腾讯和阿里巴巴谁赔率好"));
check("普通单公司问句不命中", !looksLikeCompareQuestion("腾讯最近怎么样"));
check("持仓记账句不命中（不是比较句式）", !looksLikeCompareQuestion("我持有22股思科和7股spacex成本分别是118.3和151"));
check("空问句不命中", !looksLikeCompareQuestion(""));

console.log("[2] planCompare：无 primaryCompany，从句子里拆两个本地已知公司");
const both = await planCompare("腾讯和阿里巴巴谁赔率好");
check("命中两个不同标的", both && both.primary?.ticker && both.secondary?.ticker && both.primary.ticker !== both.secondary.ticker, JSON.stringify(both));
check("primary 是腾讯（句中第一个）", both?.primary?.ticker === "0700.HK", both?.primary?.ticker);
check("secondary 是阿里巴巴", both?.secondary?.ticker === "9988.HK", both?.secondary?.ticker);
check("plan 步骤数 ≤3 次 resolveCompany + 1 次 compareCompanies", Array.isArray(both?.plan) && both.plan.filter((s) => s.tool === "resolveCompany").length <= 3);
check("plan 末尾是 compareCompanies", both?.plan?.[both.plan.length - 1]?.tool === "compareCompanies");

console.log("[3] planCompare：已有 primaryCompany（前端/会话已解析），只需解出 secondary");
const withPrimary = await planCompare("阿里巴巴谁更好", { primaryCompany: { ticker: "0700.HK", nameZh: "腾讯控股" } });
check("primary 保持传入的会话公司", withPrimary?.primary?.ticker === "0700.HK", JSON.stringify(withPrimary));
check("secondary 解出阿里巴巴", withPrimary?.secondary?.ticker === "9988.HK", withPrimary?.secondary?.ticker);

console.log("[4] 非比较句式 / 单标的：返回 null，调用方原样落回既有路由");
check("普通问句返回 null", await planCompare("腾讯最近怎么样") === null);
check("只提到一个标的的比较句返回 null", await planCompare("腾讯谁更好") === null);
check("同一标的重复出现返回 null（不算两标的）", await planCompare("腾讯和腾讯谁更好") === null);

console.log(`\nEA-2: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
