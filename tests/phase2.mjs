/**
 * Phase-2 tests: company routes, watchlist, document persistence, report composer.
 *
 * Run: node tests/phase2.mjs
 */

import assert from "node:assert/strict";
import { searchCompanies, getCompanyByTickerComplete, getLatestMarketSnapshot } from "../src/server/repositories/companyRepository.js";
import { addWatchlistItem, listWatchlist, getWatchlistItem, updateWatchlistItem, deleteWatchlistItem, getWatchlistSummary } from "../src/server/repositories/watchlistRepository.js";
import { addDocument, getDocuments, getDocument, deleteDocument } from "../src/server/repositories/documentRepository.js";
import { composeReport, reportPreview } from "../src/server/services/reportComposer.js";
import { saveResearchSession, getResearchSession } from "../src/server/repositories/researchSessions.js";

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      r.then(
        () => { pass++; console.log(`  ✓ ${name}`); },
        (err) => { fail++; console.log(`  ✗ ${name}: ${err.message}`); }
      );
    } else {
      pass++;
      console.log(`  ✓ ${name}`);
    }
  } catch (err) {
    fail++;
    console.log(`  ✗ ${name}: ${err.message}`);
    if (err.actual !== undefined) console.log(`    actual: ${JSON.stringify(err.actual)} expected: ${JSON.stringify(err.expected)}`);
  }
}

console.log("\n[1] Company repository (SQLite 654+)");
it("searchCompanies returns results for '腾讯'", () => {
  const results = searchCompanies("腾讯");
  assert.ok(results.length > 0);
  assert.ok(results.some(r => r.ticker === "0700.HK"));
});

it("searchCompanies returns camelCase + hasPortrait boolean", () => {
  const results = searchCompanies("腾讯");
  const item = results.find(r => r.ticker === "0700.HK");
  assert.ok(item);
  assert.equal(typeof item.hasPortrait, "boolean");
  assert.equal(typeof item.nameZh, "string");
  assert.equal(typeof item.nameEn, "string");
  assert.equal(typeof item.ticker, "string");
});

it("searchCompanies returns empty for nonexistent ticker", () => {
  const results = searchCompanies("ZZZ999");
  assert.equal(results.length, 0);
});

it("searchCompanies works with numeric ticker", () => {
  const results = searchCompanies("0700");
  assert.ok(results.some(r => r.ticker === "0700.HK"));
});

it("getCompanyByTickerComplete returns rich object with hasPortrait", () => {
  const c = getCompanyByTickerComplete("0700.HK");
  assert.ok(c);
  assert.equal(c.ticker, "0700.HK");
  assert.equal(c.nameZh, "腾讯控股");
  // Should have hasPortrait when company_details exists
  assert.ok(c.hasPortrait !== undefined);
});

it("getCompanyByTickerComplete returns null for unknown ticker", () => {
  const c = getCompanyByTickerComplete("ZZZ.HK");
  assert.equal(c, null);
});

console.log("\n[2] Watchlist repository");
const testWL = [];

it("addWatchlistItem creates item", () => {
  const item = addWatchlistItem({ ticker: "0700.HK", reason: "test", costBasis: 380, shares: 1000 });
  assert.ok(item.id);
  assert.equal(item.ticker, "0700.HK");
  assert.equal(item.cost_basis, 380);
  assert.equal(item.shares, 1000);
  testWL.push(item.id);
});

it("listWatchlist returns items with company_name", () => {
  const items = listWatchlist();
  assert.ok(items.length > 0);
  const item = items.find(i => i.ticker === "0700.HK");
  assert.ok(item);
  assert.equal(typeof item.company_name, "string");
});

it("getWatchlistItem returns item by id", () => {
  const item = getWatchlistItem(testWL[0]);
  assert.ok(item);
  assert.equal(item.ticker, "0700.HK");
});

it("updateWatchlistItem updates fields", () => {
  const item = updateWatchlistItem(testWL[0], { notes: "定期复盘" });
  assert.equal(item.notes, "定期复盘");
  assert.equal(item.reason, "test"); // unchanged
});

it("getWatchlistSummary returns discipline stats", () => {
  const summary = getWatchlistSummary();
  assert.ok(typeof summary.total === "number");
  assert.ok(typeof summary.sectorExposure === "object");
});

it("deleteWatchlistItem removes item", () => {
  addWatchlistItem({ ticker: "1316.HK", reason: "temp" }).id;
  // Delete the 0700.HK test item
  deleteWatchlistItem(testWL[0]);
  const gone = getWatchlistItem(testWL[0]);
  assert.equal(gone, null);
});

console.log("\n[3] Document repository");
let testDocId = null;

it("addDocument creates a document", () => {
  const id = addDocument({ name: "test.pdf", mimeType: "application/pdf", size: 1000, parser: "pdf-lite", text: "test content", summary: "test", ticker: "0700.HK" });
  assert.ok(id);
  testDocId = id;
});

it("getDocuments returns list, filterable by ticker", () => {
  const all = getDocuments({ limit: 10 });
  assert.ok(all.length > 0);
  const filtered = getDocuments({ ticker: "0700.HK" });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every(d => d.ticker === "0700.HK"));
});

it("getDocument returns single doc", () => {
  const doc = getDocument(testDocId);
  assert.ok(doc);
  assert.equal(doc.name, "test.pdf");
});

it("deleteDocument removes doc", () => {
  deleteDocument(testDocId);
  const gone = getDocument(testDocId);
  assert.equal(gone, null);
});

console.log("\n[4] Report composer");
it("composeReport produces markdown with sections", () => {
  const panel = {
    ticker: "0700.HK",
    companyName: "腾讯控股",
    researchStatus: "watch",
    confidence: "中",
    dataCompleteness: 65,
    oneLineView: "基本面稳定，等待财报验证。",
    action: "等待财报",
    userContext: { cost: null, shares: null, horizon: null, note: "" },
    price: { value: "386 HKD", change: "+1.2%", source: "Tencent Finance", timestamp: "2026-06-18T10:00:00Z" },
    keyDrivers: [
      { name: "价格信号", status: "观察", summary: "价格已接入", evidence: [{ source: "Tencent", confidence: "中", missingReason: "无" }] },
      { name: "基本面", status: "暂不评分", summary: "财报未接入", evidence: [{ source: "财报源", confidence: "低", missingReason: "未获取" }] },
      { name: "估值", status: "暂不评分", summary: "缺数据", evidence: [{ source: "估值源", confidence: "低", missingReason: "未获取" }] },
      { name: "股东回报", status: "暂不评分", summary: "缺公告", evidence: [{ source: "HKEX", confidence: "低", missingReason: "未获取" }] },
      { name: "风险信号", status: "暂不评分", summary: "新闻源不可用", evidence: [{ source: "新闻源", confidence: "低", missingReason: "timeout" }] }
    ],
    connectedData: ["行情", "公司档案"],
    missingData: ["财报解析", "新闻源", "回购公告"],
    riskTriggers: [{ label: "监管", evidence: [{ source: "档案", confidence: "中", missingReason: "无" }] }],
    sources: [{ label: "Tencent Finance", type: "market", timestamp: "2026-06-18T10:00:00Z" }],
    evidence: [{ source: "公司档案", confidence: "中", missingReason: "基础档案" }],
    details: {
      overview: ["腾讯行情已接入，财报待配置。"],
      financials: ["财务数据缺失"],
      valuation: ["估值数据不足"],
      risks: ["监管"],
      sources: []
    },
    fullResearch: "## 详细研究\n\n这是完整的研究内容。"
  };
  const report = composeReport(panel);
  assert.ok(report.markdown);
  assert.ok(report.sections.length >= 8);
  // Should have disclaimer
  assert.ok(report.markdown.includes("免责声明"));
  // Should not have 买入/卖出/持有
  assert.ok(!report.markdown.includes("买入"));
  assert.ok(!report.markdown.includes("卖出"));
  // Should have sections
  assert.ok(report.markdown.includes("结论摘要"));
  assert.ok(report.markdown.includes("数据源状态"));
  assert.ok(report.markdown.includes("风险雷达"));
  assert.ok(report.markdown.includes("来源审计"));
});

it("reportPreview extracts first 200 chars of oneLineView", () => {
  const preview = reportPreview({ oneLineView: "基本面稳定" });
  assert.ok(preview.length > 0);
  assert.ok(preview.includes("基本面"));
});

it("reportPreview handles null gracefully", () => {
  assert.equal(reportPreview(null), "");
  assert.equal(reportPreview({}), "");
});

console.log("\n[5] Research session with decision_panel");
it("saveResearchSession with full decision_panel persists and retrieves", () => {
  const id = `test_dp_${Date.now()}`;
  saveResearchSession({
    id,
    ticker: "0700.HK",
    question: "full panel test",
    decisionPanel: { researchStatus: "watch", confidence: "中", keyDrivers: [] },
    fullResearch: "full markdown",
    dataSources: { market: { status: "ok" }, news: { status: "missing" } },
    researchStatus: "watch",
    confidence: "中"
  });
  const fetched = getResearchSession(id);
  assert.equal(fetched.ticker, "0700.HK");
  assert.deepEqual(fetched.decisionPanel, { researchStatus: "watch", confidence: "中", keyDrivers: [] });
  assert.equal(fetched.fullResearch, "full markdown");
  assert.deepEqual(fetched.dataSources, { market: { status: "ok" }, news: { status: "missing" } });
});

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
