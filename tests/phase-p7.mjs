// P7 测试：研究历史全文检索（SQLite FTS5，tokenize='trigram'）。
// [1] searchResearchSessions：命中标题/问题/报告正文；查询串<3字符诚实返回空数组
//     （trigram 索引的固有限制）；插入后无需额外步骤即可搜到（触发器自动同步）；
//     更新/删除后索引跟着同步（不会搜到已删除会话，也不会搜到更新前的旧内容）。
// [2] snippet 高亮：命中片段带 / 占位符（非字面 <b> 标签），交给前端转义后
//     再替换成真正的高亮标签。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { getDb } from "../src/db/index.js";
import { saveResearchSession, searchResearchSessions, deleteResearchSession } from "../src/server/repositories/researchSessions.js";

let pass = 0;
let fail = 0;
function check(description, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

console.log("[1] searchResearchSessions：基本命中 + 触发器自动同步");

check("插入会话后立即可搜到（AFTER INSERT 触发器同步索引）", () => {
  saveResearchSession({
    id: "p7_s1", ticker: "0700.HK", title: "腾讯回购怎么看",
    question: "腾讯液冷服务器业务怎么样", reportMarkdown: "液冷散热是数据中心的新趋势"
  });
  const results = searchResearchSessions("液冷服务器");
  assert.ok(results.some((r) => r.id === "p7_s1"));
});

check("查询串短于3个字符诚实返回空数组，不报错（trigram 索引的固有限制）", () => {
  assert.deepEqual(searchResearchSessions("腾讯"), []);
  assert.deepEqual(searchResearchSessions(""), []);
  assert.deepEqual(searchResearchSessions("a"), []);
});

check("命中报告正文也能搜到（不止标题/问题）", () => {
  const results = searchResearchSessions("数据中心");
  assert.ok(results.some((r) => r.id === "p7_s1"));
});

check("不相关关键词搜不到", () => {
  const results = searchResearchSessions("完全不相关的关键词组合");
  assert.ok(!results.some((r) => r.id === "p7_s1"));
});

check("更新会话后索引跟着更新（AFTER UPDATE 触发器）：旧内容搜不到，新内容能搜到", () => {
  saveResearchSession({ id: "p7_s1", ticker: "0700.HK", reportMarkdown: "已经改成完全不同的正文内容" });
  assert.ok(!searchResearchSessions("液冷散热").some((r) => r.id === "p7_s1"));
  assert.ok(searchResearchSessions("完全不同的正文").some((r) => r.id === "p7_s1"));
});

check("删除会话后索引跟着删除（AFTER DELETE 触发器）：搜不到已删除的会话", () => {
  deleteResearchSession("p7_s1");
  assert.ok(!searchResearchSessions("完全不同的正文").some((r) => r.id === "p7_s1"));
});

console.log("\n[2] snippet 高亮定界符");
check("命中片段带占位符（不是字面 <b> 标签），避免命中内容里的 HTML 字符被误当标签", () => {
  saveResearchSession({
    id: "p7_s2", ticker: "AAPL", title: "苹果估值",
    question: "苹果现在贵不贵", reportMarkdown: "苹果近期估值处于合理区间偏高位置"
  });
  const results = searchResearchSessions("估值处于合理");
  const hit = results.find((r) => r.id === "p7_s2");
  assert.ok(hit);
  assert.ok(hit.snippet_report.includes("\u0001") || hit.snippet_question.includes("\u0001"));
  assert.ok(!hit.snippet_report.includes("<b>"), "不应直接含字面 <b> 标签（转义交给前端）");
});

console.log("\n[3] 触发器不影响 research_sessions 主表的既有行为");
check("同一 id 重复 saveResearchSession（ON CONFLICT DO UPDATE）不产生重复索引行", () => {
  saveResearchSession({ id: "p7_s3", ticker: "AAPL", question: "重复写入测试关键词" });
  saveResearchSession({ id: "p7_s3", ticker: "AAPL", question: "重复写入测试关键词" });
  const count = getDb().prepare("SELECT COUNT(*) AS n FROM research_sessions_fts").get().n;
  const mainCount = getDb().prepare("SELECT COUNT(*) AS n FROM research_sessions").get().n;
  assert.equal(count, mainCount, "fts 索引行数应与主表行数一致（无重复/无遗漏）");
});

console.log(`\nP7: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
