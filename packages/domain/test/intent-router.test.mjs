import assert from "node:assert/strict";
import { RESEARCH_DEPTHS, RESEARCH_INTENTS, routeResearchIntent } from "../src/index.js";

const profit = routeResearchIntent("腾讯赚钱吗？");
assert.equal(profit.intent, RESEARCH_INTENTS.financialQuality);
assert.equal(profit.depth, RESEARCH_DEPTHS.brief);
assert.deepEqual(profit.plan, ["routing", "resolving", "market_financials", "generating", "fact_check"]);

const report = routeResearchIntent("请给我一份腾讯的完整研究报告，覆盖护城河、估值和风险");
assert.equal(report.intent, RESEARCH_INTENTS.deepResearch);
assert.equal(report.depth, RESEARCH_DEPTHS.deep);
assert.ok(report.plan.includes("evidence"));
assert.ok(report.plan.includes("valuation"));

const vague = routeResearchIntent("腾讯最近如何？");
assert.equal(vague.intent, RESEARCH_INTENTS.companyStatus);
assert.equal(vague.depth, RESEARCH_DEPTHS.standard);
assert.ok(vague.confidence < 0.5);

const explicitBrief = routeResearchIntent("苹果估值简单说");
assert.equal(explicitBrief.intent, RESEARCH_INTENTS.valuation);
assert.equal(explicitBrief.depth, RESEARCH_DEPTHS.brief);

console.log("Intent router ✓ depth-aware cascade and real stage plans");
