// EA-0 统一入口测试：/api/ask 的服务端路由决策 routeAsk。
// 验证公司/筛选/宏观三类正确分派，且"带 company"信号优先级最高（点名公司的问题
// 即使含宏观/筛选词也不被误分流）。纯函数，无网络。
import { routeAsk } from "../src/server/routes/ask.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] 带 company = 权威公司信号（优先级最高）");
check("带 company → company", routeAsk({ question: "随便问", company: { ticker: "AAPL" } }) === "company");
check("带 company + 宏观词 → 仍 company", routeAsk({ question: "美股今晚怎么样", company: { ticker: "AAPL" } }) === "company");
check("带 company + 筛选词 → 仍 company（腾讯 PE<20 吗）", routeAsk({ question: "腾讯 PE 小于 20 吗", company: { ticker: "0700.HK" } }) === "company");

console.log("[2] 无 company：服务端自行分类");
check("筛选句 → screener", routeAsk({ question: "帮我筛美股半导体 PE小于20" }) === "screener");
check("宏观句 → macro", routeAsk({ question: "美股今晚有什么关键事件" }) === "macro");
check("公司问句 → company", routeAsk({ question: "腾讯最近怎么样" }) === "company");
check("口语问句（苹果赚钱吗）→ company", routeAsk({ question: "苹果赚钱吗" }) === "company");
check("空问句 → company 兜底（交给公司管道给未识别提示）", routeAsk({ question: "" }) === "company");

console.log("[3] 尊重前端 kind 提示（前端已先排除点名公司）");
check("kind=screener → screener", routeAsk({ question: "x", kind: "screener" }) === "screener");
check("kind=macro → macro", routeAsk({ question: "x", kind: "macro" }) === "macro");
check("kind=company → company", routeAsk({ question: "x", kind: "company" }) === "company");
check("非法 kind 被忽略、落回分类", routeAsk({ question: "腾讯怎么样", kind: "garbage" }) === "company");

console.log(`\nEA-0: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
