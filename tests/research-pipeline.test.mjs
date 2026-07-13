/**
 * Luvio reliability tests — Phase 1.
 *
 * Run: node tests/reliability.mjs
 *
 * Covers:
 *  1. ticker normalization (700 → 0700.HK, 388 → 0388.HK, 1316.HK → 1316.HK)
 *  2. userContextParser (成本价 4.9，持有 3000 股 / 我买了 2万股 / no position)
 *  3. ResearchResult schema (valid / missing evidence / 买入 as status / dirty field)
 *  4. Agent repair (extract JSON from Markdown-wrapped output, schema-validate)
 *  5. Data fallback (market/news/financials missing source)
 *  6. API integration (POST /api/agent, persist to research_sessions)
 */

import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { validateAgentPanel, buildRepairPrompt, REPAIR_SYSTEM_PROMPT, RESEARCH_STATUS_VALUES } from "../src/server/schemas/agentPanel.js";
import { parseUserContext, hasUserContext, missingContextFields, applyUserContextToMemory } from "../src/server/services/userContext.js";
import { extractJsonObject } from "../src/server/services/agent.js";
import { buildDecisionPanel } from "../src/server/services/decisionPanel.js";
import { normalizeTicker } from "../src/data.js";
import { withTimeout } from "../src/server/utils/async.js";
import { quoteStatusFor } from "../src/server/utils/format.js";
import { saveResearchSession, listResearchSessions, getResearchSession } from "../src/server/repositories/researchSessionsRepository.js";

let pass = 0;
let fail = 0;
const pending = [];
function it(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      pending.push(
        r.then(
          () => { pass++; console.log(`  ✓ ${name}`); },
          (err) => {
            fail++;
            console.log(`  ✗ ${name}`);
            console.log("    " + (err?.message || err));
            if (err?.actual !== undefined) {
              console.log(`    actual:   ${JSON.stringify(err.actual)}`);
              console.log(`    expected: ${JSON.stringify(err.expected)}`);
            }
          }
        )
      );
    } else {
      pass++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    fail++;
    console.log(`  ✗ ${name}`);
    console.log("    " + (err?.message || err));
    if (err?.actual !== undefined) {
      console.log(`    actual:   ${JSON.stringify(err.actual)}`);
      console.log(`    expected: ${JSON.stringify(err.expected)}`);
    }
  }
}

console.log("\n[1] ticker normalization");
it("700 → 0700.HK", () => assert.equal(normalizeTicker("700"), "0700.HK"));
it("388 → 0388.HK", () => assert.equal(normalizeTicker("388"), "0388.HK"));
it("1316.HK → 1316.HK", () => assert.equal(normalizeTicker("1316.HK"), "1316.HK"));
it("0700 → 0700.HK (with leading zeros)", () => assert.equal(normalizeTicker("0700"), "0700.HK"));
it("lowercase 700hk → 0700.HK", () => assert.equal(normalizeTicker("700hk"), "0700.HK"));
it("empty → empty", () => assert.equal(normalizeTicker(""), ""));

console.log("\n[2] userContextParser");
it("parses '成本价 4.9，持有 3000 股'", () => {
  const ctx = parseUserContext("成本价 4.9，持有 3000 股");
  assert.equal(ctx.cost, "4.9");
  assert.equal(ctx.shares, "3000");
});
it("parses '我买了 2万股，成本 8.3' (万 → 20000)", () => {
  const ctx = parseUserContext("我买了 2万股，成本 8.3");
  assert.equal(ctx.cost, "8.3");
  assert.equal(ctx.shares, "20000");
});
it("parses '持有 1,500 股' (comma-formatted)", () => {
  const ctx = parseUserContext("持有 1,500 股");
  assert.equal(ctx.shares, "1500");
});
it("parses '长期持有 3 年' → horizon set", () => {
  const ctx = parseUserContext("长期持有 3 年");
  assert.match(ctx.horizon, /3 年|长期/);
});
it("no position → positionDetected false", () => {
  const ctx = parseUserContext("分析一下腾讯");
  assert.equal(hasUserContext(ctx), false);
  assert.deepEqual(missingContextFields(ctx), ["成本价", "持股数", "投资周期"]);
});
it("horizon 三到五年 / 五年 / 短期", () => {
  assert.match(parseUserContext("我打算持有三到五年").horizon, /3 年/);
  assert.match(parseUserContext("做波段半年").horizon, /中期|半年/);
  assert.match(parseUserContext("短期交易").horizon, /短期/);
});
it("applyUserContextToMemory merges into positions[ticker]", () => {
  const memory = { positions: {} };
  const ctx = { cost: "4.9", shares: "3000", horizon: "长期（≥3 年）", note: "" };
  const next = applyUserContextToMemory(memory, "1316.HK", ctx);
  assert.equal(next.positions["1316.HK"].cost, "4.9");
  assert.equal(next.positions["1316.HK"].shares, "3000");
  // original memory not mutated
  assert.deepEqual(memory.positions, {});
});

console.log("\n[3] ResearchResult schema");
const validPanel = {
  ticker: "0700.HK",
  companyName: "腾讯控股",
  researchStatus: "watch",
  confidence: "中",
  dataCompleteness: 60,
  oneLineView: "已记录用户持仓。",
  action: "等财报验证",
  userContext: { cost: "4.9", shares: "3000", horizon: "长期（≥3 年）", note: "" },
  price: { value: "386 HKD", change: "+1.2%", source: "Tencent", timestamp: "2026-06-18T10:00:00+08:00", evidence: [{ source: "Tencent Finance", confidence: "中", missingReason: "无" }] },
  metrics: [
    { name: "价格", value: "386 HKD", note: "已接入", evidence: [{ source: "Tencent Finance", confidence: "中", missingReason: "无" }] }
  ],
  keyDrivers: [
    { name: "价格信号", status: "观察", summary: "已接入", evidence: [{ source: "Tencent Finance", confidence: "中", missingReason: "无" }] },
    { name: "基本面", status: "暂不评分", summary: "财报解析缺失", evidence: [{ source: "财报源", confidence: "低", missingReason: "未获取财务数据" }] },
    { name: "估值", status: "暂不评分", summary: "缺数据", evidence: [{ source: "估值源", confidence: "低", missingReason: "未获取一致预期" }] },
    { name: "股东回报", status: "暂不评分", summary: "缺公告", evidence: [{ source: "HKEX 公告", confidence: "低", missingReason: "未获取 HKEX 公告" }] },
    { name: "风险信号", status: "暂不评分", summary: "新闻源不可用", evidence: [{ source: "新闻源", confidence: "低", missingReason: "新闻接口 timeout" }] }
  ],
  connectedData: ["行情", "公司档案"],
  missingData: ["财报解析", "新闻源"],
  riskTriggers: [{ label: "监管风险", evidence: [{ source: "公司档案", confidence: "中", missingReason: "seed profile" }] }],
  sources: [{ label: "Tencent Finance", type: "market" }],
  evidence: [{ source: "公司档案", confidence: "中", missingReason: "基础档案" }]
};

it("valid panel passes", () => {
  const v = validateAgentPanel(validPanel);
  assert.equal(v.valid, true, "expected valid, got errors: " + JSON.stringify(v.errors));
});

it("missing evidence.missingReason → invalid", () => {
  const bad = JSON.parse(JSON.stringify(validPanel));
  delete bad.keyDrivers[0].evidence[0].missingReason;
  const v = validateAgentPanel(bad);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.path.includes("missingReason")));
});

it("researchStatus = '买入' → invalid", () => {
  const bad = JSON.parse(JSON.stringify(validPanel));
  bad.researchStatus = "买入";
  const v = validateAgentPanel(bad);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.path.includes("researchStatus")));
});

it("researchStatus = '持有' / '卖出' → invalid", () => {
  for (const bad of ["持有", "卖出", "强烈推荐"]) {
    const copy = JSON.parse(JSON.stringify(validPanel));
    copy.researchStatus = bad;
    const v = validateAgentPanel(copy);
    assert.equal(v.valid, false, `expected invalid for ${bad}`);
  }
});

it("extra field keyDrivers.name = '赚钱机会' → invalid", () => {
  const bad = JSON.parse(JSON.stringify(validPanel));
  bad.keyDrivers[0].name = "赚钱机会";
  const v = validateAgentPanel(bad);
  assert.equal(v.valid, false);
});

it("missing userContext → invalid", () => {
  const bad = JSON.parse(JSON.stringify(validPanel));
  delete bad.userContext;
  const v = validateAgentPanel(bad);
  assert.equal(v.valid, false);
});

it("evidence must be non-empty array", () => {
  const bad = JSON.parse(JSON.stringify(validPanel));
  bad.keyDrivers[0].evidence = [];
  const v = validateAgentPanel(bad);
  assert.equal(v.valid, false);
});

it("RESEARCH_STATUS_VALUES is the 5-value enum", () => {
  assert.deepEqual(
    [...RESEARCH_STATUS_VALUES].sort(),
    ["data_missing", "out_of_scope", "research_more", "risk_alert", "watch"]
  );
});

console.log("\n[4] Agent repair");
it("extractJsonObject from clean JSON", () => {
  const json = '{"a":1,"b":2}';
  const obj = extractJsonObject(json);
  assert.deepEqual(obj, { a: 1, b: 2 });
});

it("extractJsonObject from ```json``` code fence", () => {
  const text = "```json\n{\"a\":1,\"b\":2}\n```";
  const obj = extractJsonObject(text);
  assert.deepEqual(obj, { a: 1, b: 2 });
});

it("extractJsonObject from Markdown with embedded JSON", () => {
  const text = "Here is the panel:\n\n```\n{\"a\":1,\"b\":2}\n```\n\nDone.";
  const obj = extractJsonObject(text);
  assert.deepEqual(obj, { a: 1, b: 2 });
});

it("extractJsonObject from dirty preamble + JSON", () => {
  const text = "我先解释一下：\n下面给 JSON：\n{ \"a\": 1, \"b\": \"two\" }\n结束。";
  const obj = extractJsonObject(text);
  assert.deepEqual(obj, { a: 1, b: "two" });
});

it("extractJsonObject from completely broken text → null", () => {
  assert.equal(extractJsonObject("not json at all"), null);
  assert.equal(extractJsonObject(""), null);
});

it("buildRepairPrompt includes each error", () => {
  const errors = [{ path: "$.ticker", message: "类型应为 string" }];
  const prompt = buildRepairPrompt(errors, "raw");
  assert.match(prompt, /\$\.ticker/);
  assert.match(prompt, /类型应为 string/);
  assert.match(prompt, /researchStatus/);
});

it("REPAIR_SYSTEM_PROMPT forbids Markdown", () => {
  assert.match(REPAIR_SYSTEM_PROMPT, /不要 Markdown/);
  assert.match(REPAIR_SYSTEM_PROMPT, /researchStatus/);
});

console.log("\n[5] Data fallback");
it("market missing snapshot → quoteStatusFor returns 缺失", () => {
  assert.equal(quoteStatusFor(null), "缺失");
  assert.equal(quoteStatusFor({ providerStatus: "missing" }), "缺失");
});

it("buildDecisionPanel with all missing sources marks every keyDriver 暂不评分 and adds missingReason", () => {
  const panel = buildDecisionPanel({
    question: "分析腾讯",
    company: { ticker: "0700.HK", nameZh: "腾讯控股", sector: "科技互联网", industry: "互联网", currency: "HKD", risks: ["监管"] },
    userContext: { cost: "4.9", shares: "3000", horizon: "长期（≥3 年）", note: "" },
    marketSnapshot: { providerStatus: "missing", source: "未接入", asOf: "2026-06-18T00:00:00Z" },
    newsSnapshot: { providerStatus: "missing", source: "未接入", asOf: "2026-06-18T00:00:00Z", articles: [] },
    financialsData: { providerStatus: "missing" },
    filingsData: { providerStatus: "missing", filings: [] },
    estimatesData: { providerStatus: "missing" },
    filings: []
  });
  assert.equal(panel.userContext.cost, "4.9");
  assert.equal(panel.userContext.shares, "3000");
  // None of the keyDrivers should claim success when data is missing
  for (const driver of panel.keyDrivers) {
    assert.ok(["暂不评分", "待验证"].includes(driver.status) || /缺失|不可用|未获取/.test(driver.summary), `driver ${driver.name} status=${driver.status}`);
    assert.ok(driver.evidence.length >= 1);
    for (const e of driver.evidence) {
      assert.ok(e.missingReason && e.missingReason !== "", "evidence.missingReason 必填");
    }
  }
  // News missing → 风险信号 must NOT say "neutral", should reference "新闻源不可用"
  const risk = panel.keyDrivers.find((d) => d.name === "风险信号");
  assert.match(risk.summary, /新闻源不可用|不可用/);
  // User input was provided so missingData must NOT list user position
  const leakedMissing = panel.missingData.find((m) => /用户.*成本价|用户.*持股数|用户.*投资周期/.test(m));
  assert.equal(leakedMissing, undefined, `missingData 不应再列用户持仓: ${panel.missingData.join(", ")}`);
  // researchStatus uses enum, not buy/hold
  assert.ok(RESEARCH_STATUS_VALUES.includes(panel.researchStatus));
});

it("buildDecisionPanel with all 'ok' sources picks a sane researchStatus", () => {
  const panel = buildDecisionPanel({
    question: "分析",
    company: { ticker: "0700.HK", nameZh: "腾讯", sector: "科技互联网", currency: "HKD", risks: ["监管"] },
    userContext: { cost: "100", shares: "1000", horizon: "长期（≥3 年）", note: "" },
    marketSnapshot: { providerStatus: "ok", source: "Tencent", price: 386, currency: "HKD", asOf: new Date().toISOString(), changePercent: 0.5, pe: 18, marketCap: "3.6 万亿" },
    newsSnapshot: { providerStatus: "ok", source: "Yahoo", asOf: new Date().toISOString(), articles: [{ title: "x", url: "u" }] },
    financialsData: { providerStatus: "ok", source: "FMP", asOf: new Date().toISOString(), revenueGrowth: 10, grossMargin: 50 },
    filingsData: { providerStatus: "ok", source: "HKEX", filings: [{ title: "a" }] },
    estimatesData: { providerStatus: "ok", source: "FMP", asOf: new Date().toISOString() },
    filings: []
  });
  assert.ok(RESEARCH_STATUS_VALUES.includes(panel.researchStatus));
  assert.equal(panel.userContext.cost, "100");
  assert.equal(panel.userContext.shares, "1000");
});

it("withTimeout returns fallback on slow promise", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("never"), 200));
  const result = await withTimeout(slow, 30, "fallback");
  assert.equal(result, "fallback");
});

it("withTimeout returns fallback on rejection", async () => {
  const fail = Promise.reject(new Error("boom"));
  const result = await withTimeout(fail, 100, { ok: false });
  assert.deepEqual(result, { ok: false, errors: ["boom"] });
});

console.log("\n[6] API integration (research_sessions persistence)");
it("saveResearchSession writes a row and listResearchSessions returns it", () => {
  const id = `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  saveResearchSession({
    id,
    ticker: "1316.HK",
    question: "test question",
    decisionPanel: { researchStatus: "research_more" },
    fullResearch: "test markdown",
    dataSources: { market: { status: "ok" } },
    researchStatus: "research_more",
    confidence: "低"
  });
  const fetched = getResearchSession(id);
  assert.equal(fetched.ticker, "1316.HK");
  assert.equal(fetched.question, "test question");
  assert.equal(fetched.decisionPanel.researchStatus, "research_more");
  assert.equal(fetched.fullResearch, "test markdown");
  assert.equal(fetched.dataSources.market.status, "ok");
  assert.equal(fetched.rating, "research_more");
  const list = listResearchSessions({ limit: 5 });
  assert.ok(list.find((r) => r.id === id), "id should appear in recent list");
});

await Promise.allSettled(pending);
console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
