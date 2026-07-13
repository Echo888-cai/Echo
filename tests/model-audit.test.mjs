// E4 测试：模型网关调用留痕（llm_audit，纯仓库层 + modelGateway 集成，无网络请求）。
// [1] insertLlmAudit / getProviderCallStats：聚合成功率、平均延迟、最近失败原因。
// [2] insertLlmAudit 永不抛错（DB 写入失败不该影响模型调用主路径）。
// [3] getRecentLlmAudits：原始 feed 按最新优先。
// [4] callModel 无 key 配置时：不落任何审计行（configuredProviders 为空提前返回）。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { insertLlmAudit, getProviderCallStats, getRecentLlmAudits } from "../src/server/repositories/llmAuditRepository.js";
import { callModel } from "../src/server/services/modelGateway.js";

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
async function checkAsync(description, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

console.log("[1] insertLlmAudit / getProviderCallStats");
check("成功+失败混合：成功率/平均延迟/最近失败原因聚合正确", () => {
  insertLlmAudit({ provider: "test-glm", model: "glm-4-plus", kind: "chat", status: "ok", latencyMs: 1000 });
  insertLlmAudit({ provider: "test-glm", model: "glm-4-plus", kind: "chat", status: "ok", latencyMs: 2000 });
  insertLlmAudit({ provider: "test-glm", model: "glm-4-plus", kind: "chat", status: "error", latencyMs: 500, errorDetail: "500 rate limited" });
  const stats = getProviderCallStats({ days: 7 });
  const row = stats.find((r) => r.provider === "test-glm");
  assert.ok(row, "应聚合出 test-glm 一行");
  assert.equal(row.attempts, 3);
  assert.equal(row.successes, 2);
  assert.equal(row.failures, 1);
  assert.equal(row.avgLatencyMs, 1500); // 只算成功那两次的平均延迟
  assert.ok(row.lastFailureDetail.includes("rate limited"));
});

check("days 窗口参数生效：更宽的窗口不会丢掉刚插入的记录", () => {
  const stats = getProviderCallStats({ days: 30 });
  const row = stats.find((r) => r.provider === "test-glm");
  assert.ok(row, "30 天窗口应包含刚插入的记录");
  assert.equal(row.attempts, 3);
});

console.log("\n[2] insertLlmAudit 永不抛错");
check("provider/status 缺失时不抛错，仍落一行带兜底值", () => {
  assert.doesNotThrow(() => insertLlmAudit({ status: "ok", latencyMs: 100 }));
  const stats = getProviderCallStats({ days: 7 });
  assert.ok(stats.some((r) => r.provider === "unknown"));
});

console.log("\n[3] getRecentLlmAudits：原始 feed 按最新优先");
check("最新插入的排在最前", () => {
  insertLlmAudit({ provider: "test-order", status: "ok", latencyMs: 10 });
  insertLlmAudit({ provider: "test-order", status: "ok", latencyMs: 20 });
  const recent = getRecentLlmAudits(5);
  const idx = recent.findIndex((r) => r.provider === "test-order");
  assert.ok(idx >= 0);
  assert.equal(recent[idx].latency_ms, 20); // 后插入的延迟值应排在前面
});

console.log("\n[4] callModel 无 key 配置时不落审计行");
await checkAsync("configuredProviders 为空提前返回 null，不写 llm_audit", async () => {
  const origKeys = {};
  for (const k of ["GLM_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "MODEL_API_KEY", "MODEL_BASE_URL"]) {
    origKeys[k] = process.env[k];
    delete process.env[k];
  }
  try {
    const before = getRecentLlmAudits(1)[0]?.id || 0;
    const result = await callModel({ system: "t", user: "t" });
    assert.equal(result, null);
    const after = getRecentLlmAudits(1)[0]?.id || 0;
    assert.equal(before, after, "无 provider 配置时不该产生任何审计写入");
  } finally {
    for (const [k, v] of Object.entries(origKeys)) { if (v !== undefined) process.env[k] = v; }
  }
});

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
