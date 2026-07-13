import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { computeFinancialQuality } from "../src/server/services/financialQuality.js";
import { computeValuation } from "../src/server/services/valuationEngine.js";
import { buildRiskRadar } from "../src/server/services/riskEngine.js";
import { callModel, getProviderStatus } from "../src/server/services/modelGateway.js";
import { classifyResearchIntent, buildEvidenceQueries, RESEARCH_INTENTS } from "../src/server/services/intentClassifier.js";
import { webEvidenceToPrompt } from "../src/server/services/webEvidenceService.js";
import { saveWebEvidence, listWebEvidence } from "../src/server/repositories/webEvidenceRepository.js";

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

console.log("\n[1] Financial quality engine");
check("null data returns empty metrics", () => {
  const r = computeFinancialQuality(null);
  assert.equal(r.metrics.length, 0);
  assert.ok(r.missing.length > 3);
  assert.equal(r.quality.qualityScore, null);
});

check("valid data returns quality score", () => {
  const data = {
    providerStatus: "ok", source: "FMP", asOf: "2026-06-18T00:00:00Z",
    revenueGrowth: 12.5, grossMargin: 45.2, operatingMargin: 22.1,
    netMargin: 15.3, freeCashFlow: 50000000000, debtToEquity: 35,
    returnOnEquity: 18.5, eps: 12.5, repurchaseOfStock: 10000000000, dividendPaid: 5000000000
  };
  const r = computeFinancialQuality(data);
  assert.equal(r.quality.qualityScore > 0, true);
  assert.ok(r.metrics.length > 3);
  assert.equal(r.missing.length, 0);
  assert.ok(r.summary.includes("质量评分"));
});

check("partial data lists missing fields", () => {
  const r = computeFinancialQuality({ providerStatus: "ok", source: "FMP", asOf: "", revenueGrowth: 5 });
  assert.ok(r.missing.includes("毛利率"));
  assert.ok(r.missing.some(m => m.includes("FCF") || m.includes("自由现金流")));
});

console.log("\n[2] Valuation engine");
check("company + price = simple PE valuation", () => {
  const v = computeValuation({ ticker: "0700.HK", price: 386, sector: "科技互联网", pe: "约 18x" }, { price: 386, pe: 18 }, null);
  assert.equal(v.cannotValueReason, null);
  assert.ok(v.base > 0);
  assert.ok(v.method);
});

check("with financials = multi-method valuation", () => {
  const v = computeValuation({ ticker: "0700.HK", price: 386, sector: "科技互联网" }, { price: 386, pe: 18 }, { providerStatus: "ok", freeCashFlow: 200000000000, eps: 20, revenueGrowth: 10, cashAndEquivalents: 400000000000, totalDebt: 100000000000, sharesOutstanding: 9300000000 });
  assert.ok(v.methods.length >= 1);
  assert.ok(v.base > 0);
  assert.ok(v.upside !== null);
});

check("no price = cannotValue", () => {
  const v = computeValuation({ ticker: "0700.HK", price: 386 }, { price: null }, null);
  assert.ok(v.cannotValueReason);
});

check("null everything = cannotValue", () => {
  const v = computeValuation(null, null, null);
  assert.ok(v.cannotValueReason);
});

console.log("\n[3] Risk radar engine");
check("profile risks converted to radar with triggers", () => {
  const r = buildRiskRadar({ ticker: "0700.HK", sector: "科技互联网", risks: ["监管变化", "广告周期波动"] }, {});
  assert.ok(r.risks.length > 0);
  assert.ok(r.totalIdentified > 0);
  for (const risk of r.risks) {
    assert.ok(risk.trigger, `risk "${risk.label}" should have a trigger`);
    assert.ok(["高","中","低"].includes(risk.severity));
  }
});

check("financial danger flags produce high severity", () => {
  const r = buildRiskRadar({ ticker: "0700.HK", sector: "科技互联网", risks: [] }, { financialsData: { providerStatus: "ok", debtToEquity: 250, freeCashFlow: -100000000, revenueGrowth: -15, grossMargin: 12 } });
  const high = r.risks.filter(x => x.severity === "高");
  assert.ok(high.length > 0, "should have high-severity risks for debt + revenue decline");
});

check("null company returns safe fallback", () => {
  const r = buildRiskRadar(null, {});
  assert.equal(r.risks.length, 1);
  assert.equal(r.sourceHealth.market, "missing");
});

check("missing news adds news-gap risk", () => {
  const r = buildRiskRadar({ ticker: "0700.HK", sector: "科技互联网", risks: [] }, { newsSnapshot: { providerStatus: "missing", articles: [] } });
  // B-4：字段从 risk 改名为 label（与 decisionPanel.js 的 riskTriggers 形状对齐），evidence
  // 也从占位字符串数组换成真实的 evidence 对象数组。
  assert.ok(r.risks.some(x => x.label.includes("新闻源缺失")));
});

console.log("\n[4] Model gateway");
check("getProviderStatus returns config status", () => {
  const s = getProviderStatus();
  assert.equal(typeof s.configured, "boolean");
  assert.ok(Array.isArray(s.providers));
  // Legacy compat
  assert.ok("provider" in s);
});

// The actual callModel test only works in CI without keys
check("callModel returns null when no keys configured", async () => {
  // Save state
  const origKeys = {};
  for (const k of ["GLM_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "MODEL_API_KEY", "MODEL_BASE_URL"]) {
    origKeys[k] = process.env[k];
    delete process.env[k];
  }
  try {
    const result = await callModel({ system: "t", user: "t" });
    assert.equal(result, null);
  } finally {
    // Restore
    for (const [k, v] of Object.entries(origKeys)) {
      if (v) process.env[k] = v;
    }
  }
});

console.log("\n[5] Web evidence layer");
check("intent classifier detects competitor questions", () => {
  assert.equal(classifyResearchIntent("联想竞争对手有哪些？"), RESEARCH_INTENTS.competitors);
  assert.equal(classifyResearchIntent("阿里靠什么赚钱？"), RESEARCH_INTENTS.businessModel);
  assert.equal(classifyResearchIntent("腾讯为什么跌？"), RESEARCH_INTENTS.riskEvent);
});

check("buildEvidenceQueries returns focused search queries", () => {
  const queries = buildEvidenceQueries({
    company: { ticker: "0992.HK", nameZh: "联想集团", nameEn: "Lenovo Group Limited" },
    question: "竞争对手有哪些？",
    intent: RESEARCH_INTENTS.competitors
  });
  assert.ok(queries.length >= 4);
  assert.ok(queries.some((query) => /competitors|竞争对手/i.test(query)));
});

check("web evidence repository saves and reads cached evidence", () => {
  const id = `test_web_${Date.now()}`;
  saveWebEvidence([{
    id,
    ticker: "0992.HK",
    intent: RESEARCH_INTENTS.competitors,
    query: "Lenovo competitors",
    title: "Lenovo PC market share",
    url: `https://example.com/${id}`,
    source: "Example",
    sourceType: "industry_research",
    snippet: "Lenovo competes with HP and Dell.",
    fetchedAt: new Date().toISOString(),
    relevanceScore: 0.8,
    credibilityScore: 0.7
  }]);
  const rows = listWebEvidence({ ticker: "0992.HK", intent: RESEARCH_INTENTS.competitors, limit: 20, maxAgeHours: 1 });
  assert.ok(rows.some((row) => row.id === id));
});

check("webEvidenceToPrompt includes source links", () => {
  const prompt = webEvidenceToPrompt({
    provider: "test",
    summary: "保留 1 条证据",
    evidence: [{ title: "Lenovo results", source: "IR", url: "https://investor.lenovo.com/", snippet: "Revenue and margin." }]
  });
  assert.match(prompt, /Web Evidence/);
  assert.match(prompt, /https:\/\/investor\.lenovo\.com/);
});

// Output
console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
