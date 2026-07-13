import assert from "node:assert/strict";
import { extractHkTicker, extractUsTickerToken } from "../src/companyIdentity.js";

const investorQuestions = [
  ["86块钱的rklb怎么样", "", "RKLB"],
  ["我 86 美元买的 RKLB 现在怎么看", "", "RKLB"],
  ["成本 700 元的腾讯怎么办", "", ""],
  ["持有 700 股腾讯，风险大吗", "", ""],
  ["PE 小于 40 的公司有哪些", "", ""],
  ["分析一下 1316.HK", "1316.HK", ""],
  ["港股 700 怎么样", "0700.HK", ""],
  ["700怎么样", "0700.HK", ""],
  ["$rklb 的现金流如何", "", "RKLB"],
  ["rklb", "", "RKLB"],
  ["what about rklb", "", "RKLB"],
  ["OPEN AI 上市了吗", "", ""],
  ["Rocket Lab怎么样", "", ""]
];

for (const [question, hk, us] of investorQuestions) {
  assert.equal(extractHkTicker(question), hk, `HK identity mismatch: ${question}`);
  assert.equal(extractUsTickerToken(question), us, `US identity mismatch: ${question}`);
}

console.log(`Company identity matrix ✓ ${investorQuestions.length} investor questions`);
