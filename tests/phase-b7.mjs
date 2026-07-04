// B-7 测试：web 证据非沙箱实测——真实调用 Bing/DuckDuckGo/Tavily 等搜索源（不打桩），
// 才抓到 buildEvidenceQueries/buildMacroQueries 里 anchorQueryToDate 的真实 bug：
// "今天苹果怎么样"这类含"今天/最近/最新"的问题会把裸日期（如"2026-07-04"）拼进查询词，
// Bing 会把它当"年份 2026"处理，通用"2026年"内容（世界杯赛程、政府工作报告）挤掉公司
// 相关结果——真实浏览器/API 调用实测确认（非本地/mock 环境能发现，纯单测桩数据发现不了）。
// 修复：buildEvidenceQueries/buildMacroQueries 面向真实搜索引擎的查询不再套 anchorQueryToDate，
// 该护栏仅保留给需要绝对日期语境的场景（如 LLM 提示词）。
import { buildEvidenceQueries } from "../src/server/services/intentClassifier.js";
import { buildMacroQueries } from "../src/server/services/discovery.js";
import { beijingDate } from "../src/server/utils/time.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] buildEvidenceQueries：相对时间问题不再裸日期前缀污染搜索引擎查询");
{
  const qs = buildEvidenceQueries({ company: { ticker: "9868.HK", nameEn: "XPeng", nameZh: "小鹏汽车" }, question: "小鹏汽车最近怎么样" });
  check("查询非空", qs.length >= 4);
  check(
    "无裸日期前缀（Bing 实测会把 YYYY-MM-DD 当年份 token，挤掉公司相关结果）",
    qs.every((q) => !q.startsWith(beijingDate()) && !q.includes(beijingDate()))
  );
  check("公司名/ticker 仍在查询里", qs.some((q) => q.includes("XPeng") || q.includes("9868.HK") || q.includes("小鹏")));
}

console.log("[2] buildMacroQueries：宏观查询同样不裸日期前缀");
{
  const qs = buildMacroQueries("今天美股有什么关键事件");
  check("查询非空", qs.length >= 2);
  check("无裸日期前缀", qs.every((q) => !q.startsWith(beijingDate())));
}

console.log(`\nB-7: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
