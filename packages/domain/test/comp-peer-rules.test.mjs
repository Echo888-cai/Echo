// 同业可比领域规则：阶段分桶 + 锚点分位数 + 倍数可比上限。
// 用例全部来自真实 Finnhub 回测数据（2026-07-15），不是构造的理想输入。
import { buildCompPeers, bucketOf } from "../src/index.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const profitableSubject = { providerStatus: "ok", eps: 24.98, netMargin: 30.4, revenueGrowth: -1.06 };

console.log("[1] bucketOf：阶段 → 倍数桶");
{
  check("profitable → pe", bucketOf("profitable") === "pe");
  check("loss → ev_sales", bucketOf("loss") === "ev_sales");
  check("loss_growth → ev_sales", bucketOf("loss_growth") === "ev_sales");
  check("unknown → unknown", bucketOf("unknown") === "unknown");
}

console.log("[2] 锚点分位数（真实 AAPL 同业回测数据）");
{
  const peers = [
    { ticker: "DELL", epsTtm: 12.59, netMargin: 6.28, revenueGrowth: 8, pe: 35.0036, evRevenue: 2.3427 },
    { ticker: "WDC", epsTtm: 5, netMargin: 10, revenueGrowth: 5, pe: 26.5, evRevenue: 3 },
    { ticker: "NTAP", epsTtm: 5, netMargin: 10, revenueGrowth: 5, pe: 26.0745, evRevenue: 4.6461 }
  ];
  const r = buildCompPeers(profitableSubject, peers);
  check("盈利主体 → PE 锚点", r.anchor?.multipleType === "PE", JSON.stringify(r.anchor));
  check("锚点计入 3 家", r.anchor?.n === 3, JSON.stringify(r.anchor));
  check("中位数取中间值", Math.abs(r.anchor.median - 26.5) < 0.01, JSON.stringify(r.anchor));
  check("detail 点名计入的同业", r.detail.includes("DELL"), r.detail);
}

console.log("[3] 倍数可比上限：分母趋零的失真倍数不进锚点");
{
  // 真实回测：查腾讯（经 TCEHY）的同业里 BIDU peTTM=698.7x（百度 TTM 盈利几乎归零）。
  // 与 BILI(34.9x) 一起入锚点会算出 median 366.8x，进而让估值带给腾讯套 366 倍 PE。
  const peers = [
    { ticker: "BIDU", epsTtm: 0.2, netMargin: 0.5, revenueGrowth: 1, pe: 698.7, evRevenue: 2 },
    { ticker: "BILI", epsTtm: 3, netMargin: 8, revenueGrowth: 12, pe: 34.9, evRevenue: 3 }
  ];
  const r = buildCompPeers(profitableSubject, peers);
  const bidu = r.peers.find((p) => p.ticker === "BIDU");
  check("失真倍数的 peer 不计入锚点", bidu.matched === false, JSON.stringify(bidu));
  check("但仍然列出并说明原因", /超出可比上限/.test(bidu.reason || ""), bidu.reason);
  check("剩下 <2 家时不硬凑锚点", r.anchor === null, JSON.stringify(r.anchor));
  check("detail 说明沿用原估值方法", /同业数据不足/.test(r.detail), r.detail);
}

console.log("[4] 阶段不同的 peer 列出但不计入锚点");
{
  const peers = [
    { ticker: "LOSSCO", epsTtm: -2, netMargin: -15, revenueGrowth: 40, pe: null, evRevenue: 8 },
    { ticker: "DELL", epsTtm: 12.59, netMargin: 6.28, revenueGrowth: 8, pe: 35.0036, evRevenue: 2.3427 },
    { ticker: "NTAP", epsTtm: 5, netMargin: 10, revenueGrowth: 5, pe: 26.0745, evRevenue: 4.6461 }
  ];
  const r = buildCompPeers(profitableSubject, peers);
  const loss = r.peers.find((p) => p.ticker === "LOSSCO");
  check("亏损 peer 用 EV/Sales 口径", loss.multipleType === "EV/Sales", JSON.stringify(loss));
  check("亏损 peer 不与盈利主体同桶", loss.matched === false, JSON.stringify(loss));
  check("原因写明阶段不同", /阶段不同/.test(loss.reason || ""), loss.reason);
  check("锚点只用同桶的 2 家", r.anchor?.n === 2, JSON.stringify(r.anchor));
}

console.log("[5] 主体阶段判不出来时不建锚点");
{
  const r = buildCompPeers({ providerStatus: "missing" }, [
    { ticker: "DELL", epsTtm: 12.59, netMargin: 6.28, revenueGrowth: 8, pe: 35, evRevenue: 2.3 }
  ]);
  check("主体财务缺失 → providerStatus missing", r.providerStatus === "missing", JSON.stringify(r));
  check("不生成锚点", r.anchor === null);
  check("detail 说明原因", /无法判断估值阶段/.test(r.detail), r.detail);
}

console.log(`\nComp peer rules: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
