// EA-4（柱2）测试：全标的自动进看盘。
// [1] watchCandidatesFrom：纯函数，无网络——验证主公司/对比对象/其他持仓三路都被收进候选，
//     且"没拉到真实数据的其他持仓"（summary=null）被诚实排除，不会把壳记录也塞进看盘。
// [2] watchlist 仓库：addToWatch 写入后 listWatchAdds 能读回、去重、且会覆盖此前的 hide。
import "./setupTestDb.mjs";
import { watchCandidatesFrom } from "../src/server/services/chatOrchestrator.js";
import { addToWatch, removeFromWatch, listWatchAdds, getHiddenTickers } from "../src/server/repositories/watchlist.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] watchCandidatesFrom：纯函数收集三路候选");
{
  const candidates = watchCandidatesFrom({
    portraitTicker: "0700.HK",
    decisionPanel: { companyName: "腾讯控股" },
    companyName: "腾讯控股",
    compareData: { ticker: "9988.HK", name: "阿里巴巴" },
    otherHoldings: [
      { company: { ticker: "AAPL", nameZh: "苹果" }, summary: { name: "苹果", marketSnapshot: { price: 200 } } },
      { company: { ticker: "SPCX", nameZh: "SpaceX" }, summary: null } // 没拉到真实数据的壳记录
    ]
  });
  const tickers = candidates.map((c) => c.ticker);
  check("主公司在候选里", tickers.includes("0700.HK"));
  check("对比对象在候选里", tickers.includes("9988.HK"));
  check("拉到真实数据的其他持仓在候选里", tickers.includes("AAPL"));
  check("没拉到真实数据的其他持仓被排除（不塞壳记录）", !tickers.includes("SPCX"));
  check("候选数 = 3（主公司+对比对象+1个真实其他持仓）", candidates.length === 3, String(candidates.length));
}
{
  const candidates = watchCandidatesFrom({ portraitTicker: "0700.HK", decisionPanel: null, companyName: "腾讯控股" });
  check("没有 decisionPanel 时主公司不进候选（未完成研究不算）", candidates.length === 0);
}
{
  const candidates = watchCandidatesFrom({});
  check("空输入返回空数组，不抛异常", Array.isArray(candidates) && candidates.length === 0);
}

console.log("[2] watchlist 仓库：写入 / 读回 / 覆盖 hide");
{
  removeFromWatch("TESTX");
  check("移除后 TESTX 在隐藏集合里", getHiddenTickers().has("TESTX"));
  addToWatch("TESTX", "测试标的");
  check("addToWatch 覆盖此前的 hide", !getHiddenTickers().has("TESTX"));
  check("listWatchAdds 能读回 TESTX", listWatchAdds().some((w) => w.ticker === "TESTX"));
  addToWatch("TESTX", "测试标的-改名");
  const dup = listWatchAdds().filter((w) => w.ticker === "TESTX");
  check("重复 addToWatch 去重（PRIMARY KEY 幂等），不产生多条", dup.length === 1, String(dup.length));
}

console.log(`\nEA-4: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
