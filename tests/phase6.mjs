// P6 发现层测试：意图路由（screener/macro/公司问题互不误伤）+ 筛选条件解析 + 宏观纯函数。
// 全部纯函数，无网络。
import {
  classifyDiscoveryIntent, isScreenerQuestion, isMacroQuestion, classifyResearchIntent
} from "../src/server/services/intentClassifier.js";
import { parseScreenerQuery, pickIndices, buildMacroQueries } from "../src/server/services/discovery.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] 发现层意图路由");
check("筛选：帮我筛美股半导体 PE<20", classifyDiscoveryIntent("帮我筛美股半导体 PE小于20") === "screener");
check("筛选：条件式（市值大于500亿的科技股）", classifyDiscoveryIntent("市值大于500亿的科技股有哪些") === "screener");
check("宏观：美股今晚有什么关键事件", classifyDiscoveryIntent("美股今晚有什么关键事件") === "macro");
check("宏观：美联储议息怎么看", classifyDiscoveryIntent("美联储这次议息怎么看") === "macro");
check("宏观：恒指最近怎么走", classifyDiscoveryIntent("恒指最近走势如何") === "macro");
check("非发现层：腾讯最近怎么样", classifyDiscoveryIntent("腾讯最近怎么样") === null);
check("非发现层：苹果赚钱吗", classifyDiscoveryIntent("苹果赚钱吗") === null);
// 注意：公司估值追问含数字条件时（"腾讯 PE 低于 20 吗"）服务端分类器会命中筛选——
// 分流职责在前端 discoveryKindOf（先排除点名公司），服务端 /api/discover 只接前端已分流的请求。
check("公司估值追问仍归公司意图（classifyResearchIntent）", classifyResearchIntent("腾讯PE低于20吗，贵不贵") === "valuation");

console.log("[2] 筛选条件解析（parseScreenerQuery）");
{
  const f = parseScreenerQuery("帮我筛美股半导体 PE小于20 市值大于500亿");
  check("市场=美股", f.market === "US");
  check("行业映射：半导体 → Semiconductors", f.industry === "Semiconductors");
  check("PE 上限 20", f.peMax === 20 && f.peMin === null);
  check("市值下限 500亿=5e10", f.mcapMin === 5e10);
}
{
  const f = parseScreenerQuery("港股医药里挑几只市值大于1千亿的");
  check("市场=港股", f.market === "HK");
  check("行业映射：医药 → Healthcare（sector）", f.sector === "Healthcare");
  check("千亿单位=1e11", f.mcapMin === 1e11);
}
{
  const f = parseScreenerQuery("筛一下 PE 大于 30 股息率超过3% 的美股");
  check("PE 下限 30", f.peMin === 30);
  check("股息率条件被诚实忽略并注明", f.ignored.some((s) => s.includes("股息率")));
}

console.log("[3] 宏观纯函数");
check("美股问题 → SPX/NDX/DJI", JSON.stringify(pickIndices("美股今晚有什么关键事件")) === JSON.stringify(["SPX", "NDX", "DJI"]));
check("港股问题 → HSI/HSCEI", JSON.stringify(pickIndices("恒指今天大盘怎么样")) === JSON.stringify(["HSI", "HSCEI"]));
check("泛宏观 → 跨市场组", JSON.stringify(pickIndices("全球宏观环境怎么看")) === JSON.stringify(["SPX", "NDX", "HSI"]));
{
  const qs = buildMacroQueries("美股今晚有什么关键事件");
  check("宏观检索词非空且去重", qs.length >= 2 && new Set(qs).size === qs.length);
  check("中英混合", qs.some((q) => /[一-龥]/.test(q)) && qs.some((q) => /[A-Za-z]/.test(q)));
}
{
  const qs = buildMacroQueries("恒指本周怎么看");
  check("港股问题给港股检索词", qs.some((q) => /Hang Seng|恒生/.test(q)));
}

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
