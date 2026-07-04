// EA-1 测试：分析框架注册表 + 工具层。
// 框架部分只验证"迁移零行为变更"（system 原样来自 prompts.js、appliesTo 有登记）；
// 工具部分只验证 schema/shape 和纯本地路径（resolveCompany），不打网络请求
// （screenStocks/macroRead/webEvidence/researchCompany/compareCompanies 依赖外部数据源，
// 留给端到端/沙箱外验证，这里只保证 run() 的错误路径不抛出、而是返回 status:"error"）。
import { PROMPTS } from "../src/prompts.js";
import { FRAMEWORKS, listFrameworks, getFramework, frameworksFor } from "../src/server/frameworks/index.js";
import { agentTools, listTools, getTool } from "../src/server/services/agentTools.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] 框架注册表：零行为变更迁移");
const promptIds = Object.keys(PROMPTS);
check("注册表条目数与 PROMPTS 一致", listFrameworks().length === promptIds.length, `${listFrameworks().length} vs ${promptIds.length}`);
for (const id of promptIds) {
  check(`${id}.systemPrompt 与 PROMPTS[${id}].system 逐字节一致`, FRAMEWORKS[id]?.systemPrompt === PROMPTS[id].system);
  check(`${id}.rubric 与 PROMPTS[${id}].outputContract 一致`, JSON.stringify(FRAMEWORKS[id]?.rubric) === JSON.stringify(PROMPTS[id].outputContract || []));
  check(`${id}.appliesTo 是数组`, Array.isArray(FRAMEWORKS[id]?.appliesTo));
}
check("getFramework('cio') 命中", getFramework("cio")?.id === "cio");
check("getFramework('不存在') 返回 null", getFramework("不存在") === null);
check("frameworksFor('valuation') 至少命中 valuation 框架自身", frameworksFor("valuation").some((f) => f.id === "valuation"));
check("frameworksFor('macro') 命中 macro 框架", frameworksFor("macro").some((f) => f.id === "macro"));

console.log("[2] 工具层：schema 形状 + 本地路径");
const toolNames = ["resolveCompany", "researchCompany", "screenStocks", "compareCompanies", "macroRead", "webEvidence"];
check("六个工具都注册了", toolNames.every((n) => agentTools[n]), toolNames.filter((n) => !agentTools[n]).join(","));
check("listTools() 数量匹配", listTools().length === toolNames.length);
for (const n of toolNames) {
  const tool = getTool(n);
  check(`${n} 有 name/description/inputSchema/run`, tool && tool.name === n && typeof tool.description === "string" && typeof tool.inputSchema === "object" && typeof tool.run === "function");
}
check("getTool('不存在') 返回 null", getTool("不存在") === null);

console.log("[3] resolveCompany：纯本地解析，无网络");
const known = await agentTools.resolveCompany.run({ query: "腾讯" });
check("resolveCompany('腾讯') 命中已知公司", known.status === "ok" && known.data?.ticker);
const unknown = await agentTools.resolveCompany.run({ query: "这是一个不存在的公司名字xyz123" });
check("resolveCompany 未命中时返回 error 而不是抛出", unknown.status === "error" && typeof unknown.error === "string");

console.log(`\nEA-1: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
