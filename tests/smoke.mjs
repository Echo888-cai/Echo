import assert from "node:assert/strict";
import {
  companies,
  companyByTicker,
  findCompany,
  normalizeTicker
} from "../src/data.js";
import { PROMPT_VERSION, PROMPTS, buildPromptContext, promptNames } from "../src/prompts.js";
import { marketSnapshotToMarkdown } from "../src/marketData.js";
import { newsSnapshotToMarkdown } from "../src/newsData.js";

assert.equal(companies.length, 31, "seed data should include 31 HK companies");
assert.equal(PROMPT_VERSION, "luvio-prompts-v0.5");
assert.ok(promptNames().includes("首席研究助手"));
assert.ok(PROMPTS.risk.system.includes("挑战"));

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
