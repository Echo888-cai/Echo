// U-4（E15）：每用户模型用量、token/成本与每日配额。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { insertLlmAudit, getUserDailyUsage, getProviderCallStats } from "../src/server/repositories/llmAuditRepository.js";
import { quotaStatus, quotaGuard, estimateModelCost } from "../src/server/services/quota.js";

process.env.ECHO_DAILY_MODEL_CALLS = "2";
process.env.ECHO_INPUT_USD_PER_M_TOKENS = "1";
process.env.ECHO_OUTPUT_USD_PER_M_TOKENS = "2";

assert.equal(estimateModelCost(1_000_000, 1_000_000), 3);

insertLlmAudit({ provider: "test", model: "m", status: "ok", userId: "user-a", inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.0002 });
insertLlmAudit({ provider: "test", model: "m", status: "ok", userId: "user-a", inputTokens: 200, outputTokens: 75, estimatedCostUsd: 0.00035 });
insertLlmAudit({ provider: "test", model: "m", status: "error", userId: "user-a", errorDetail: "fail" });
insertLlmAudit({ provider: "test", model: "m", status: "ok", userId: "user-b", inputTokens: 999, outputTokens: 999, estimatedCostUsd: 9 });

const a = getUserDailyUsage("user-a");
assert.equal(a.attempts, 3);
assert.equal(a.successfulCalls, 2);
assert.equal(a.inputTokens, 300);
assert.equal(a.outputTokens, 125);
assert.equal(a.estimatedCostUsd, 0.00055);

const b = getUserDailyUsage("user-b");
assert.equal(b.successfulCalls, 1);
assert.equal(b.inputTokens, 999);
assert.equal(getProviderCallStats({ userId: "user-a" })[0].attempts, 3, "provider 汇总必须按用户过滤");

assert.equal(quotaStatus("user-a").exhausted, true);
assert.equal(quotaStatus("user-a").remainingCalls, 0);
assert.equal(quotaGuard("user-a").status, 429);
assert.equal(quotaStatus("user-b").exhausted, false);

delete process.env.ECHO_DAILY_MODEL_CALLS;
delete process.env.ECHO_INPUT_USD_PER_M_TOKENS;
delete process.env.ECHO_OUTPUT_USD_PER_M_TOKENS;

console.log("phase-u4 ✓ 每用户用量 / token / 成本 / 每日配额");
