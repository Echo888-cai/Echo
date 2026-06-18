import assert from "node:assert/strict";
import {
  companies,
  companyByTicker,
  computeValuation,
  findCompany,
  generateMemoTemplate,
  generateResearchReport,
  normalizeTicker
} from "../src/data.js";
import { PROMPT_VERSION, PROMPTS, buildPromptContext, promptNames } from "../src/prompts.js";
import { BENCHMARK_INSIGHTS, LUVIO_DIFFERENTIATORS, WORKSPACE_TABS } from "../src/productStrategy.js";
import { marketSnapshotToMarkdown } from "../src/marketData.js";
import { newsSnapshotToMarkdown } from "../src/newsData.js";

assert.equal(companies.length, 31, "seed data should include 31 HK companies");
assert.equal(PROMPT_VERSION, "luvio-prompts-v0.5");
assert.ok(promptNames().includes("首席研究助手"));
assert.ok(PROMPTS.risk.system.includes("挑战"));
assert.ok(WORKSPACE_TABS.map((tab) => tab.id).includes("coverage"));
assert.ok(BENCHMARK_INSIGHTS.length >= 5);
assert.ok(LUVIO_DIFFERENTIATORS.some((item) => item.includes("中文港股")));
assert.equal(normalizeTicker("1316"), "1316.HK");
assert.equal(normalizeTicker("388"), "0388.HK");
assert.equal(findCompany("耐世特").ticker, "1316.HK");
assert.equal(findCompany("腾讯").ticker, "0700.HK");
assert.equal(findCompany("分析一下 1316.HK 耐世特").ticker, "1316.HK");
assert.equal(findCompany("腾讯现在贵不贵？").ticker, "0700.HK");
assert.equal(findCompany("地平线还有没有转机？").ticker, "9660.HK");
assert.equal(findCompany("联想怎么样？").ticker, "0992.HK");
assert.equal(findCompany("帮我对比比亚迪和吉利").ticker, "1211.HK");
assert.equal(companyByTicker("700")?.ticker, "0700.HK");

const nexteer = companyByTicker("1316.HK");
assert.match(buildPromptContext(nexteer, "分析耐世特", []), /1316.HK/);
const report = generateResearchReport(nexteer, [
  {
    title: "Annual Report 2024",
    filingType: "annual_report",
    publishedAt: "2025-04-30",
    sourceUrl: "https://example.com/report.pdf",
    rawText: "Revenue increased while margin remained under pressure.",
    parsedStatus: "parsed"
  }
]);

assert.match(report, /【结论卡片】/);
assert.match(report, /【核心理由】/);
assert.match(report, /## 来源审计/);
assert.match(report, /不构成买卖建议|不提供投资顾问服务/i);
assert.match(report, /Annual Report 2024/);

const memo = generateMemoTemplate(nexteer, report);
assert.match(memo, /# 投资备忘录/);
assert.match(memo, /1316.HK/);

const valuation = computeValuation({
  price: "4.9",
  eps: "0.38",
  fcf: "0.42",
  dividend: "0.06",
  peBear: "8",
  peBase: "12",
  peBull: "16",
  fcfYield: "0.08"
});

assert.equal(valuation.peValues.base.toFixed(2), "4.56");
assert.equal(valuation.fcfValue.toFixed(2), "5.25");
assert.ok(valuation.sensitivity.length >= 3);
assert.match(
  marketSnapshotToMarkdown({
    providerStatus: "ok",
    source: "Test",
    asOf: "2026-06-12T10:00:00+08:00",
    price: 10,
    currency: "HKD",
    change: 0.2,
    changePercent: 2,
    volume: 1000
  }),
  /实时行情来源：Test/
);
assert.match(marketSnapshotToMarkdown({ providerStatus: "missing" }), /尚未接入/);
assert.match(
  newsSnapshotToMarkdown({
    providerStatus: "ok",
    source: "Test News",
    asOf: "2026-06-12T10:00:00+08:00",
    sentiment: { label: "中性偏观察", positiveCount: 1, negativeCount: 1, neutralCount: 0 },
    articles: [{ title: "Alibaba tests new retail push", description: "Market watches execution risk.", publishedAt: "2026-06-12" }]
  }),
  /新闻与舆论来源：Test News/
);

console.log("Smoke tests passed.");
