// 估值同业锚（自动可比公司 + 同业倍数）。
// [1] numOrNull 回归：Number(null)===0 的陷阱——netCash 显式为 null（一手抽取常见口径）
//     不该被当净现金=0，必须落回 cashAndEquivalents-totalDebt 的兜底计算。
// [2] EV/Sales 情景：≥2 家同业时用同业 p25/median/p75 替代静态行业规则默认倍数。
// [3] EV/Sales 情景：同业不足（anchor=null）时保留静态默认倍数兜底，keyAssumptions 说明原因。
// [4] Profitable 阶段：同业 PE 锚点作为独立方法并入多法交叉。
// [5] Profitable 阶段：同业数据不足时 keyAssumptions 说明"使用原兜底方法"，不影响其它方法。
// [6] displayValuation：不论最终走哪条分支，compPeers 原始清单都会挂在结果上（前端"为什么选这些"面板用）。
import { computeValuation, displayValuation } from "../src/index.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] numOrNull 回归：netCash 显式为 null 时不该被当 0（不是 undefined 缺失）");
{
  const withGap = computeValuation(
    { ticker: "9999.HK", price: 50 },
    { price: 50, marketCap: 50000000000 },
    {
      providerStatus: "ok", eps: -1.2, netMargin: -8, revenueGrowth: 10,
      revenue: 20000000000, sharesOutstanding: 1000000000,
      netCash: null, cashAndEquivalents: 5000000000, totalDebt: 1000000000
    }
  );
  const zeroGap = computeValuation(
    { ticker: "9999.HK", price: 50 },
    { price: 50, marketCap: 50000000000 },
    {
      providerStatus: "ok", eps: -1.2, netMargin: -8, revenueGrowth: 10,
      revenue: 20000000000, sharesOutstanding: 1000000000,
      netCash: null, cashAndEquivalents: 0, totalDebt: 0
    }
  );
  check(
    "netCash=null 时落回 cash-debt=40亿（而不是被 numOrNull(null) 误判成 0）",
    parseFloat(withGap.base) > parseFloat(zeroGap.base),
    `withGap.base=${withGap.base} zeroGap.base=${zeroGap.base}`
  );
}

console.log("[2] EV/Sales 情景：≥2 家同业时用同业分位数替代静态默认倍数");
{
  const peerAnchor = { multipleType: "EV/Sales", p25: 2, median: 4, p75: 6, n: 2, tickers: ["PEERA", "PEERB"] };
  const v = computeValuation(
    { ticker: "9868.HK", price: 50 },
    { price: 50, marketCap: 50000000000 },
    {
      providerStatus: "ok", eps: -1.2, netMargin: -8, revenueGrowth: 10,
      revenue: 20000000000, sharesOutstanding: 1000000000, netCash: 3000000000
    },
    { anchor: peerAnchor }
  );
  check("同业锚点生效（usedPeerAnchor）", v.usedPeerAnchor === true, JSON.stringify(v));
  // base = (4x * revenue*1.1 + netCash) / shares
  const expectedBase = (4 * 20000000000 * 1.1 + 3000000000) / 1000000000;
  check("base 用的是同业中位数 4x（不是静态规则表）", Math.abs(parseFloat(v.base) - expectedBase) < 0.01, `${v.base} vs ${expectedBase}`);
  check("keyAssumptions 列出具体同业 ticker（可追溯）", v.keyAssumptions.some((a) => a.includes("PEERA") && a.includes("PEERB")));
}

console.log("[3] EV/Sales 情景：同业不足（<2 家）时保留静态默认倍数兜底");
{
  const v = computeValuation(
    { ticker: "9868.HK", price: 50 },
    { price: 50, marketCap: 50000000000 },
    {
      providerStatus: "ok", eps: -1.2, netMargin: -8, revenueGrowth: 10,
      revenue: 20000000000, sharesOutstanding: 1000000000, netCash: 3000000000
    },
    { anchor: null } // compPeers 拉到了但同业不足，anchor 为 null（compPeers.js 的契约）
  );
  check("不硬凑同业锚点（usedPeerAnchor=false）", v.usedPeerAnchor === false);
  check("keyAssumptions 说明用的是行业规则默认倍数兜底", v.keyAssumptions.some((a) => a.includes("同业数据不足") && a.includes("兜底")));
}

console.log("[4] Profitable 阶段：同业 PE 锚点作为独立方法并入多法交叉");
{
  const peerAnchor = { multipleType: "PE", p25: 10, median: 15, p75: 20, n: 3, tickers: ["PEERA", "PEERB", "PEERC"] };
  const v = computeValuation(
    { ticker: "TEST", price: 100 },
    { price: 100, pe: 25 },
    { providerStatus: "ok", eps: 5, pe: 25, revenueGrowth: 10 },
    { anchor: peerAnchor }
  );
  const peerMethod = v.methodDetail?.find((m) => m.name === "同业倍数 PE");
  check("同业倍数 PE 方法被加入 methods[]", !!peerMethod, JSON.stringify(v.methods));
  check("同业倍数 PE 的 base = 同业中位 PE(15x) × 自身 EPS(5)", peerMethod && Math.abs(peerMethod.base - 75) < 0.01, JSON.stringify(peerMethod));
  check("keyAssumptions 列出具体同业 ticker", v.keyAssumptions.some((a) => a.includes("PEERA") && a.includes("PEERC")));
}

console.log("[5] Profitable 阶段：同业数据不足时不影响其它方法，且说明原因");
{
  const v = computeValuation(
    { ticker: "TEST", price: 100 },
    { price: 100, pe: 25 },
    { providerStatus: "ok", eps: 5, pe: 25, revenueGrowth: 10 },
    { providerStatus: "ok", peers: [], anchor: null, stage: "profitable", detail: "同业数据不足（同阶段可比 <2 家）", partial: false }
  );
  check("没有同业倍数 PE 方法（不硬凑）", !v.methodDetail?.some((m) => m.name === "同业倍数 PE"));
  check("原有 PE 方法仍然正常工作", v.methodDetail?.some((m) => m.name === "PE"));
  check("keyAssumptions 说明同业数据不足", v.keyAssumptions.some((a) => a.includes("同业数据不足") && a.includes("原兜底方法")));
}

console.log("[6] displayValuation：compPeers 原始清单挂在结果上，供前端\"为什么选这些同业\"面板用");
{
  const compPeers = {
    stage: "profitable", providerStatus: "ok", partial: false, detail: "2 家同业计入锚点（PEERA、PEERB）",
    anchor: { multipleType: "PE", p25: 10, median: 15, p75: 20, n: 2, tickers: ["PEERA", "PEERB"] },
    peers: [
      { ticker: "PEERA", stage: "profitable", multiple: 10, multipleType: "PE", providerStatus: "ok", matched: true, reason: null },
      { ticker: "PEERB", stage: "profitable", multiple: 20, multipleType: "PE", providerStatus: "ok", matched: true, reason: null },
      { ticker: "PEERC", stage: "loss", multiple: 3, multipleType: "EV/Sales", providerStatus: "ok", matched: false, reason: "阶段不同（亏损），未计入锚点" }
    ]
  };
  const v = displayValuation(
    { ticker: "TEST", price: 100 },
    { price: 100, pe: 15 },
    { providerStatus: "ok", eps: 5, pe: 15, revenueGrowth: 10 },
    null,
    compPeers
  );
  check("compPeers 原样挂在结果上", v.compPeers === compPeers);
  check("包含未计入锚点的 peer 及原因（可追溯）", v.compPeers.peers.some((p) => p.ticker === "PEERC" && !p.matched && p.reason));
}

console.log(`\nPeer valuation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
