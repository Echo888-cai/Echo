import { getUserDailyUsage } from "../repositories/llmAuditRepository.js";

function positiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function quotaPolicy(userId = "local") {
  const calls = userId === "local"
    ? positiveNumber("LUVIO_OWNER_DAILY_MODEL_CALLS", positiveNumber("LUVIO_DAILY_MODEL_CALLS", 40))
    : positiveNumber("LUVIO_DAILY_MODEL_CALLS", 40);
  return {
    dailyCalls: calls,
    dailyCostUsd: positiveNumber("LUVIO_DAILY_COST_USD", 0)
  };
}

export function quotaStatus(userId = "local") {
  const usage = getUserDailyUsage(userId);
  const policy = quotaPolicy(userId);
  const callExceeded = policy.dailyCalls > 0 && usage.successfulCalls >= policy.dailyCalls;
  const costExceeded = policy.dailyCostUsd > 0 && usage.estimatedCostUsd >= policy.dailyCostUsd;
  return {
    ...usage,
    ...policy,
    remainingCalls: policy.dailyCalls > 0 ? Math.max(0, policy.dailyCalls - usage.successfulCalls) : null,
    exhausted: callExceeded || costExceeded,
    reason: callExceeded ? "calls" : costExceeded ? "cost" : null
  };
}

export function quotaGuard(userId = "local") {
  const status = quotaStatus(userId);
  if (!status.exhausted) return null;
  return {
    status: 429,
    message: "今日研究额度已用完。额度会在北京时间次日自动恢复；你的历史研究、持仓和看盘仍可正常使用。",
    usage: status
  };
}

export function estimateModelCost(inputTokens, outputTokens) {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const inputRate = positiveNumber("LUVIO_INPUT_USD_PER_M_TOKENS", 0);
  const outputRate = positiveNumber("LUVIO_OUTPUT_USD_PER_M_TOKENS", 0);
  return Number(((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000).toFixed(6));
}
