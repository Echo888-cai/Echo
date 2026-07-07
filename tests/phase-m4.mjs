// M-4（P13+E10，替代 PWA）测试：
// [1] insertLlmAudit + getProviderCallStats：token 用量落库/聚合正确。
// [2] 成本估算：未配置价格环境变量时 estimatedCostUsd 诚实为 null；配置后按 USD/1M tokens 正确折算。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { insertLlmAudit, getProviderCallStats } from "../src/server/repositories/llmAuditRepository.js";

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

console.log("[1] insertLlmAudit + getProviderCallStats：token 用量落库/聚合");

check("单次调用的 prompt/completion tokens 正确落库并可读回", () => {
  insertLlmAudit({ provider: "m4test-a", model: "test-model", kind: "chat", status: "ok", latencyMs: 100, promptTokens: 500, completionTokens: 200 });
  const stats = getProviderCallStats({ days: 1 }).find((r) => r.provider === "m4test-a");
  assert.ok(stats, "应能查到刚写入的 provider 汇总");
  assert.equal(stats.promptTokens, 500);
  assert.equal(stats.completionTokens, 200);
});

check("同一 provider 多次调用的 token 用量正确累加", () => {
  insertLlmAudit({ provider: "m4test-b", model: "test-model", kind: "chat", status: "ok", latencyMs: 100, promptTokens: 300, completionTokens: 100 });
  insertLlmAudit({ provider: "m4test-b", model: "test-model", kind: "chat", status: "ok", latencyMs: 100, promptTokens: 400, completionTokens: 150 });
  const stats = getProviderCallStats({ days: 1 }).find((r) => r.provider === "m4test-b");
  assert.equal(stats.attempts, 2);
  assert.equal(stats.promptTokens, 700);
  assert.equal(stats.completionTokens, 250);
});

check("未提供 token 参数时不报错，汇总时按 0 处理（不是 null 污染 SUM）", () => {
  insertLlmAudit({ provider: "m4test-c", model: "test-model", kind: "chat", status: "error", latencyMs: 50, errorDetail: "timeout" });
  const stats = getProviderCallStats({ days: 1 }).find((r) => r.provider === "m4test-c");
  assert.ok(stats);
  assert.equal(stats.promptTokens, 0);
  assert.equal(stats.completionTokens, 0);
});

console.log("\n[2] 成本估算：未配置价格诚实为 null，配置后按 USD/1M tokens 正确折算");

check("未配置 LLM_PRICE_<PROVIDER>_INPUT/OUTPUT 时，estimatedCostUsd 为 null（不猜价格）", () => {
  delete process.env.LLM_PRICE_M4TESTD_INPUT;
  delete process.env.LLM_PRICE_M4TESTD_OUTPUT;
  insertLlmAudit({ provider: "m4test-d", model: "test-model", kind: "chat", status: "ok", latencyMs: 100, promptTokens: 1_000_000, completionTokens: 500_000 });
  const stats = getProviderCallStats({ days: 1 }).find((r) => r.provider === "m4test-d");
  assert.equal(stats.estimatedCostUsd, null);
});

check("配置价格后按 USD/1M tokens 正确折算（输入 $1/1M + 输出 $2/1M，100万输入+50万输出 = $1 + $1 = $2）", () => {
  process.env.LLM_PRICE_M4TESTE_INPUT = "1";
  process.env.LLM_PRICE_M4TESTE_OUTPUT = "2";
  insertLlmAudit({ provider: "m4teste", model: "test-model", kind: "chat", status: "ok", latencyMs: 100, promptTokens: 1_000_000, completionTokens: 500_000 });
  const stats = getProviderCallStats({ days: 1 }).find((r) => r.provider === "m4teste");
  assert.ok(stats.estimatedCostUsd != null);
  assert.equal(Math.round(stats.estimatedCostUsd * 100) / 100, 2);
  delete process.env.LLM_PRICE_M4TESTE_INPUT;
  delete process.env.LLM_PRICE_M4TESTE_OUTPUT;
});

check("只配置了一半价格（只有 INPUT 没有 OUTPUT）时仍诚实为 null（不半算）", () => {
  process.env.LLM_PRICE_M4TESTF_INPUT = "1";
  insertLlmAudit({ provider: "m4test-f", model: "test-model", kind: "chat", status: "ok", latencyMs: 100, promptTokens: 1000, completionTokens: 500 });
  const stats = getProviderCallStats({ days: 1 }).find((r) => r.provider === "m4test-f");
  assert.equal(stats.estimatedCostUsd, null);
  delete process.env.LLM_PRICE_M4TESTF_INPUT;
});

console.log(`\nM-4 (P13+E10): ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
