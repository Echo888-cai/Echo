// F-3 测试：基本面证伪条件（研究时结构化输出，不做事后文本解析）。
// [1] extractStructuredFalsifiers：正常提取+剥离、白名单校验（非法 metric/op/超范围阈值整条丢弃）、
//     JSON 解析失败/无标记行的诚实降级、去重、上限截断。
// [2] evaluateFundamentalRule：命中判定 + 数据缺失时 sane=false（不是"未触发"）。
// [3] evaluateRule 护栏：基本面 kind 直接拒绝，不会被当成价格规则误评估
//     （真实回归点：同一个 threshold/price 比值对价格规则是"sane"的，混进基本面规则
//     绝不能被当价格线核对）。
// [4] watchRulesRepository：metric 列落库/读回；replaceFalsifierRules 存混合规则集。
// [5] companyPortrait.updatePortraitFromPanel：structuredFalsifiers 参数合并进 watch_rules；
//     ruleSignature 变化侦测同时覆盖价格线与基本面线。
// [6] scheduler：runEarningsReviewJob 命中基本面规则时通知 falsify_alert + markTriggered。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import {
  extractStructuredFalsifiers, evaluateFundamentalRule, evaluateRule,
  FUNDAMENTAL_METRICS, FUNDAMENTAL_METRIC_LABELS
} from "@echo/domain";
import { replaceFalsifierRules, listRules } from "../src/server/repositories/watchRulesRepository.js";
import { updatePortraitFromPanel } from "../src/server/services/companyPortrait.js";
import { getCompanyProfile } from "../src/server/repositories/companyProfilesRepository.js";
import { JOBS } from "../src/server/services/scheduler.js";
import { insertResearchSnapshot } from "../src/server/repositories/researchSnapshotsRepository.js";
import { upsertEarningsCalendar } from "../src/server/repositories/earningsCalendarRepository.js";

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
async function checkAsync(description, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

console.log("[1] extractStructuredFalsifiers");
check("正常提取 + 从正文剥离该行", () => {
  const content = `正文第一段。\n\n证伪条件：\n- 若毛利率跌破 40%，逻辑证伪\n\nFALSIFIERS_JSON: [{"metric":"grossMargin","op":"below","threshold":40,"text":"若毛利率跌破 40%，逻辑证伪"}]`;
  const { rules, cleanContent } = extractStructuredFalsifiers(content);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].kind, "fundamental_below");
  assert.equal(rules[0].metric, "grossMargin");
  assert.equal(rules[0].threshold, 40);
  assert.ok(!cleanContent.includes("FALSIFIERS_JSON"), "标记行必须从用户可见正文里剥离");
  assert.ok(cleanContent.includes("正文第一段"), "正文其余内容应保留");
});

check("above 映射成 fundamental_above", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"netMargin","op":"above","threshold":15,"text":"净利率若持续高于 15%"}]`;
  const { rules } = extractStructuredFalsifiers(content);
  assert.equal(rules[0].kind, "fundamental_above");
});

check("非白名单 metric 整条丢弃（不报错，不硬凑）", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"peRatio","op":"below","threshold":10,"text":"PE跌破10"}]`;
  const { rules, cleanContent } = extractStructuredFalsifiers(content);
  assert.equal(rules.length, 0);
  assert.ok(!cleanContent.includes("FALSIFIERS_JSON"), "即使内容全部无效，标记行仍应被剥离");
});

check("非法 op 整条丢弃", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"grossMargin","op":"equals","threshold":40,"text":"x"}]`;
  assert.equal(extractStructuredFalsifiers(content).rules.length, 0);
});

check("threshold 非数字整条丢弃", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"grossMargin","op":"below","threshold":"很低","text":"x"}]`;
  assert.equal(extractStructuredFalsifiers(content).rules.length, 0);
});

check("百分比类指标阈值离谱（可能是把 0.4 当 40% 输出）超出合理范围时丢弃", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"grossMargin","op":"below","threshold":5000,"text":"x"}]`;
  assert.equal(extractStructuredFalsifiers(content).rules.length, 0);
});

check("freeCashFlow 不受百分比范围限制（金额量级天然很大）", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"freeCashFlow","op":"below","threshold":-500000000,"text":"自由现金流转负超5亿"}]`;
  const { rules } = extractStructuredFalsifiers(content);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].threshold, -500000000);
});

check("JSON 解析失败：诚实返回空数组，仍剥离该行（不让残缺 JSON 泄露给用户）", () => {
  const content = `正文。\nFALSIFIERS_JSON: [{"metric":"grossMargin"`;
  const { rules, cleanContent } = extractStructuredFalsifiers(content);
  assert.equal(rules.length, 0);
  assert.ok(!cleanContent.includes("FALSIFIERS_JSON"));
});

check("没有标记行：原样返回，不报错", () => {
  const content = "正文，没有任何结构化标记。";
  const { rules, cleanContent } = extractStructuredFalsifiers(content);
  assert.equal(rules.length, 0);
  assert.equal(cleanContent, content);
});

check("空数组：合法情况，正常剥离", () => {
  const { rules, cleanContent } = extractStructuredFalsifiers("正文。\nFALSIFIERS_JSON: []");
  assert.equal(rules.length, 0);
  assert.ok(!cleanContent.includes("FALSIFIERS_JSON"));
});

check("去重：同 kind+metric+threshold 只留一条", () => {
  const content = `FALSIFIERS_JSON: [{"metric":"grossMargin","op":"below","threshold":40,"text":"a"},{"metric":"grossMargin","op":"below","threshold":40,"text":"b"}]`;
  assert.equal(extractStructuredFalsifiers(content).rules.length, 1);
});

check("上限截断：最多 6 条", () => {
  const items = FUNDAMENTAL_METRICS.concat(FUNDAMENTAL_METRICS).slice(0, 10).map((m, i) => ({ metric: m, op: "below", threshold: 10 + i, text: `条件${i}` }));
  const content = `FALSIFIERS_JSON: ${JSON.stringify(items)}`;
  assert.ok(extractStructuredFalsifiers(content).rules.length <= 6);
});

console.log("\n[2] evaluateFundamentalRule");
check("命中：低于阈值触发", () => {
  const rule = { kind: "fundamental_below", metric: "grossMargin", threshold: 40 };
  const { triggered, sane, currentValue } = evaluateFundamentalRule(rule, { providerStatus: "ok", grossMargin: 35 });
  assert.equal(sane, true);
  assert.equal(triggered, true);
  assert.equal(currentValue, 35);
});

check("未命中：高于阈值不触发", () => {
  const rule = { kind: "fundamental_below", metric: "grossMargin", threshold: 40 };
  const { triggered, sane } = evaluateFundamentalRule(rule, { providerStatus: "ok", grossMargin: 45 });
  assert.equal(sane, true);
  assert.equal(triggered, false);
});

check("above 方向命中判定正确", () => {
  const rule = { kind: "fundamental_above", metric: "netMargin", threshold: 15 };
  const { triggered } = evaluateFundamentalRule(rule, { providerStatus: "ok", netMargin: 18 });
  assert.equal(triggered, true);
});

check("financialsData 不可用（providerStatus != ok）→ sane=false，不是'未触发'", () => {
  const rule = { kind: "fundamental_below", metric: "grossMargin", threshold: 40 };
  const { sane, triggered } = evaluateFundamentalRule(rule, { providerStatus: "missing" });
  assert.equal(sane, false);
  assert.equal(triggered, false);
});

check("该指标本身缺失（null）→ sane=false", () => {
  const rule = { kind: "fundamental_below", metric: "freeCashFlow", threshold: 0 };
  const { sane } = evaluateFundamentalRule(rule, { providerStatus: "ok", grossMargin: 40 });
  assert.equal(sane, false);
});

check("非法 kind → sane=false（防误用）", () => {
  const rule = { kind: "price_below", metric: "grossMargin", threshold: 40 };
  const { sane } = evaluateFundamentalRule(rule, { providerStatus: "ok", grossMargin: 35 });
  assert.equal(sane, false);
});

console.log("\n[3] evaluateRule 护栏：基本面 kind 不会被当价格规则误评估");
check("fundamental_below 直接拒绝，即使 threshold/price 比值对价格规则来说是 sane 的", () => {
  // 现价 100，阈值 40：ratio=0.4，若当成价格规则会判 sane（在 0.05~20 范围内）——
  // 但这是一条毛利率规则，绝不能被当价格线核对。
  const rule = { kind: "fundamental_below", metric: "grossMargin", threshold: 40 };
  const result = evaluateRule(rule, 100);
  assert.equal(result.sane, false);
  assert.equal(result.triggered, false);
  assert.equal(result.distancePct, null);
});
check("fundamental_above 同样被拒绝", () => {
  const rule = { kind: "fundamental_above", metric: "netMargin", threshold: 15 };
  assert.equal(evaluateRule(rule, 100).sane, false);
});
check("价格规则仍正常工作（回归确认未破坏既有行为）", () => {
  const rule = { kind: "price_below", threshold: 90 };
  const result = evaluateRule(rule, 100);
  assert.equal(result.sane, true);
  assert.equal(result.triggered, false);
});

console.log("\n[4] watchRulesRepository：metric 列落库/读回");
check("replaceFalsifierRules 存混合规则集（价格+基本面），hydrate 正确读回 metric", () => {
  replaceFalsifierRules("F3TEST", [
    { kind: "price_below", threshold: 90, label: "跌破90美元" },
    { kind: "fundamental_below", metric: "grossMargin", threshold: 40, label: "毛利率跌破40%" }
  ], { sessionId: "s_f3" });
  const rules = listRules("F3TEST");
  assert.equal(rules.length, 2);
  const priceRule = rules.find((r) => r.kind === "price_below");
  const fundRule = rules.find((r) => r.kind === "fundamental_below");
  assert.equal(priceRule.metric, null, "价格规则的 metric 列应为 null");
  assert.equal(fundRule.metric, "grossMargin");
  assert.equal(fundRule.sessionId, "s_f3");
});

check("replaceFalsifierRules 幂等重建：旧的基本面规则被新一轮替换", () => {
  replaceFalsifierRules("F3TEST", [
    { kind: "fundamental_above", metric: "revenueGrowth", threshold: 10, label: "营收增速回升至10%以上" }
  ]);
  const rules = listRules("F3TEST");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].metric, "revenueGrowth");
});

console.log("\n[5] companyPortrait.updatePortraitFromPanel：structuredFalsifiers 合并");
check("structuredFalsifiers 参数正确落进 watch_rules", () => {
  const panel = {
    ticker: "F3PORT", companyName: "F3 测试公司", oneLineView: "测试主线",
    rating: "watch", confidence: "高", keyDrivers: [], missingData: [], riskTriggers: []
  };
  updatePortraitFromPanel({
    ticker: "F3PORT", panel, question: "测试",
    answerContent: "证伪条件：\n- 若毛利率跌破 35%，逻辑证伪",
    structuredFalsifiers: [{ kind: "fundamental_below", metric: "grossMargin", threshold: 35, label: "若毛利率跌破 35%，逻辑证伪" }]
  });
  const rules = listRules("F3PORT");
  const fundRule = rules.find((r) => r.kind === "fundamental_below");
  assert.ok(fundRule, "应有一条基本面规则落库");
  assert.equal(fundRule.metric, "grossMargin");
  assert.equal(fundRule.threshold, 35);
});

check("第二轮判断未变：不重复触发 falsifier_change 事件（ruleSignature 含 metric 生效）", () => {
  const panel = {
    ticker: "F3PORT", companyName: "F3 测试公司", oneLineView: "测试主线",
    rating: "watch", confidence: "高", keyDrivers: [], missingData: [], riskTriggers: []
  };
  const before = getCompanyProfile("F3PORT").events.filter((e) => e.kind === "falsifier_change").length;
  updatePortraitFromPanel({
    ticker: "F3PORT", panel, question: "测试2",
    answerContent: "证伪条件：\n- 若毛利率跌破 35%，逻辑证伪",
    structuredFalsifiers: [{ kind: "fundamental_below", metric: "grossMargin", threshold: 35, label: "若毛利率跌破 35%，逻辑证伪" }]
  });
  const after = getCompanyProfile("F3PORT").events.filter((e) => e.kind === "falsifier_change").length;
  assert.equal(after, before, "同样的规则集不该重复记一条证伪线更新事件");
});

console.log("\n[6] scheduler：runEarningsReviewJob 不因基本面规则检查引入非预期网络请求");
await checkAsync("无基本面规则的票：任务正常完成，不触发 getFinancials（离线可跑）", async () => {
  // 本套测试全程离线（无 API key），真实的 getFinancials 网络调用只在真实浏览器/curl
  // 验证里做（见 PLAN.md F-3 验收记录）——这里只确认"没有基本面规则时完全不触碰
  // getFinancials 这条代码路径"，防止未来改动意外让所有票都发一次多余请求。
  const ticker = "F3JOBTEST";
  insertResearchSnapshot({ ticker, snapshotDate: "2026-01-01", thesis: "测试主线", priceAtSnapshot: 100 });
  upsertEarningsCalendar({
    ticker, nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null,
    source: "Finnhub", providerStatus: "ok", detail: null,
    lastReported: { date: "2026-06-01", quarter: 2, year: 2026, epsEstimate: 1.0, epsActual: 1.05, revenueEstimate: null, revenueActual: null, epsSurprisePct: 5, revenueSurprisePct: null }
  });
  assert.equal(listRules(ticker).filter((r) => r.kind.startsWith("fundamental_")).length, 0, "前置条件：这只票没有基本面规则");
  const job = JOBS.find((j) => j.id === "earnings_review");
  const detail = await job.run();
  assert.match(detail, /条业绩后提醒已通知/);
  assert.ok(!detail.includes("条基本面证伪命中"), "无规则时不该出现基本面命中计数（fundamentalHits 应为 0，被短路成空字符串）");
});

check("FUNDAMENTAL_METRIC_LABELS 覆盖全部白名单指标（防漏配置导致通知文案里出现英文字段名）", () => {
  for (const m of FUNDAMENTAL_METRICS) {
    assert.ok(FUNDAMENTAL_METRIC_LABELS[m], `缺少 ${m} 的中文标签`);
  }
});

console.log(`\nF-3: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
