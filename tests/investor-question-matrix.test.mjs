// Cross-layer regression set written in the language real investors use.
// A question is only "supported" when identity, intent and context agree; testing
// those layers in isolation missed the RKLB/86 and English-vs planner regressions.
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { extractHkTicker, extractUsTickerToken } from "@echo/domain/company-identity";
import {
  classifyDiscoveryIntent,
  classifyResearchIntent,
  RESEARCH_INTENTS
} from "../src/server/services/intentClassifier.js";
import { parseUserContext } from "../src/server/services/userContext.js";
import { looksMultiHolding } from "../src/server/services/entityExtractor.js";
import { comparisonCandidates } from "../src/server/services/agentPlanner.js";
import { routeAsk } from "../src/server/routes/ask.js";

const identityCases = [
  ["86块钱的rklb怎么样", "", "RKLB"],
  ["成本 700 元的腾讯怎么办", "", ""],
  ["持有 700 股腾讯，风险大吗", "", ""],
  ["PE 小于 40 的港股有哪些", "", ""],
  ["市值 500 亿以下的公司", "", ""],
  ["2026 年业绩怎么样", "", ""],
  ["分析一下 1316.HK", "1316.HK", ""],
  ["港股 700 怎么样", "0700.HK", ""],
  ["what about rklb", "", "RKLB"],
  ["OPEN AI 上市了吗", "", ""],
  ["我有 2 万股 AAPL", "", "AAPL"],
  ["止损 80 美元的 RKLB", "", "RKLB"]
];

for (const [question, hk, us] of identityCases) {
  assert.equal(extractHkTicker(question), hk, `HK identity: ${question}`);
  assert.equal(extractUsTickerToken(question), us, `US identity: ${question}`);
}

const researchCases = [
  ["RKLB 靠什么赚钱", RESEARCH_INTENTS.businessModel],
  ["它的护城河是真的吗", RESEARCH_INTENTS.moat],
  ["自由现金流为什么一直是负的", RESEARCH_INTENTS.financialQuality],
  ["86 美元到底贵不贵", RESEARCH_INTENTS.valuation],
  ["昨天为什么暴跌", RESEARCH_INTENTS.riskEvent],
  ["什么情况会推翻 Neutron 的投资逻辑", RESEARCH_INTENTS.falsify],
  ["给我一份完整研究报告", RESEARCH_INTENTS.deepResearch]
];

for (const [question, intent] of researchCases) {
  assert.equal(classifyResearchIntent(question), intent, `research intent: ${question}`);
}

const discoveryCases = [
  ["帮我筛美股里 PE 小于 20、现金流为正的公司", "screener"],
  ["市值 500 亿以下的港股有哪些", "screener"],
  ["美联储下次议息对成长股有什么影响", "macro"],
  ["恒指今天为什么跌", "macro"]
];

for (const [question, intent] of discoveryCases) {
  assert.equal(classifyDiscoveryIntent(question), intent, `discovery intent: ${question}`);
  assert.equal(routeAsk({ question }), intent, `ask route: ${question}`);
}

const position = parseUserContext("我 86 美元买了 120 股 RKLB，止损 70，打算持有三年");
assert.equal(position.cost, "86");
assert.equal(position.shares, "120");
assert.equal(position.stopLoss, "70");
assert.equal(position.horizon, "3 年");

assert.deepEqual(
  comparisonCandidates("RKLB vs ASTS 哪个赔率更好"),
  ["RKLB", "ASTS"]
);
assert.equal(looksMultiHolding("我持有 120 股 RKLB 和 80 股 ASTS"), true);
assert.equal(routeAsk({ question: "腾讯 PE 小于 20 吗", company: { ticker: "0700.HK" } }), "company");

console.log(`Investor question matrix ✓ ${identityCases.length + researchCases.length + discoveryCases.length + 7} checks`);
