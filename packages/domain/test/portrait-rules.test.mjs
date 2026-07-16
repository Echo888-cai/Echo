import assert from "node:assert/strict";
import {
  distillPortraitView,
  extractFalsifiersFromAnswer,
  extractThesisFromAnswer,
  isDataFragmentThesis,
  portraitJudgmentChanged
} from "../src/index.js";

const answer = `## 我的判断\n公司的核心利润池仍在扩张。下一句不应进入主线。\n\n## 证伪条件\n- 股价跌破 80 元触发复核\n- 毛利率低于 20% 触发复核`;
assert.equal(extractThesisFromAnswer(answer), "公司的核心利润池仍在扩张。");
assert.deepEqual(extractFalsifiersFromAnswer(answer), ["股价跌破 80 元触发复核", "毛利率低于 20% 触发复核"]);
assert.equal(isDataFragmentThesis("收入增速 -1.10%，毛利率 55.71%"), true);

const view = distillPortraitView(
  { ticker: "RKLB", companyName: "Rocket Lab", researchStatus: "watch", confidence: "medium", riskTriggers: ["发射延期"] },
  { summary: ["商业发射与卫星系统形成双利润池"], bull: ["订单增长"], bear: ["现金消耗"] },
  { method: "EV/Sales", bear: 40, base: 60, bull: 90, currentPrice: 55 }
);
assert.equal(view.thesis, "商业发射与卫星系统形成双利润池");
assert.equal(view.valuation.base, 60);
assert.equal(portraitJudgmentChanged({ thesis: "旧判断" }, view), true);

console.log("Portrait rules ✓ framework-free canonical implementations");
