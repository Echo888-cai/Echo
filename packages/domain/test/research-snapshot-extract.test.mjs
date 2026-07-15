/**
 * R7 链路回归：answerComposer/reportComposer 的真实小标题 → 主线/证伪条件提取。
 *
 * 为什么值得单独一个文件：#27 终局迁移把 persistResearch 的快照写入方连同它的测试
 * （旧 tests/research-scorecard.test.mjs）一起删了，于是 research_snapshots 变成没人写
 * 的冻结表、research.scorecard 对着零条快照算命中率，整整两个月没有任何东西报警。
 * 这里锁住的是"提取器必须认得 composer 当下真的吐出来的格式"——它一旦悄悄漂移，
 * 写入方还在、但只会写进空主线和空证伪条件，比直接删掉更难发现。
 */
import assert from "node:assert/strict";
import { extractFalsifiersFromAnswer, extractThesisFromAnswer, parseFalsifierRules } from "../src/index.js";

// ── 1. chat 默认模板：模型吐的是**粗体**小标题、无冒号（answerComposer 第 800 行的固定段落）。
//     这正是线上真实回答的样子，也是原正则（锚定 `^#{0,3}`）失配的地方。
const chatAnswer = [
  "北京时间 2026-07-15 14:23，腾讯控股 最近的状态是：……",
  "",
  "**结论**",
  "腾讯的核心判断是：多利润池提供稳健现金流。",
  "",
  "**证伪条件**",
  "- 如果收入同比继续下滑（低于 -1.1%），则增长停滞的判断被强化。",
  "- 股价跌破 300 港元说明多头逻辑需要重估。",
  "",
  "**我的判断**",
  "腾讯当前处于“利润质量高但增长停滞”的稳态。后面这句不该进主线。",
  "",
  "**还缺什么**",
  "- 缺少游戏流水的最新数据。",
  "",
  "**来源**",
  "- Yahoo Finance"
].join("\n");

assert.equal(
  extractThesisFromAnswer(chatAnswer),
  "腾讯当前处于“利润质量高但增长停滞”的稳态。",
  "粗体 **我的判断** 必须能提取，且只取第一句"
);
const chatFalsifiers = extractFalsifiersFromAnswer(chatAnswer);
assert.equal(chatFalsifiers.length, 2, "粗体 **证伪条件** 段落必须能提取");
assert.match(chatFalsifiers[1], /股价跌破 300 港元/);
// **我的判断** 是段落边界：证伪条件不能把后面的段落吞进来。
assert.ok(!chatFalsifiers.some((item) => /还缺什么|利润质量高但增长停滞/.test(item)), "证伪条件段落必须在下一个粗体小标题处终止");

// ── 2. 深度报告：reportComposer 发的是 `## 核心判断` / `## 风险与证伪条件`。
const reportAnswer = [
  "# 腾讯控股（0700.HK）深度研究",
  "",
  "## 核心判断",
  "游戏与广告双引擎带动高质量利润回升。",
  "",
  "## 风险与证伪条件",
  "1. 利润率持续下滑。",
  "2. 现金流转弱且回购停止。",
  "",
  "## 来源",
  "- Yahoo Finance"
].join("\n");

assert.equal(extractThesisFromAnswer(reportAnswer), "游戏与广告双引擎带动高质量利润回升。", "## 核心判断 必须能提取");
assert.equal(extractFalsifiersFromAnswer(reportAnswer).length, 2, "## 风险与证伪条件 必须能提取");

// ── 3. 老手写模板：历史会话正文仍是这个格式，必须继续可复盘。
const legacyAnswer = ["我的判断：老格式的主线判断句在这里。", "", "证伪条件", "- 股价跌破 90 美元触发复核"].join("\n");
assert.equal(extractThesisFromAnswer(legacyAnswer), "老格式的主线判断句在这里。", "老格式 `我的判断：` 不能回归");
assert.equal(extractFalsifiersFromAnswer(legacyAnswer).length, 1);

// ── 4. 文本证伪条件 → 可执行价格规则：只有明确的股价条件才落成 watch_rules。
//     基本面口径必须被拒（"宁可漏，不可错"）——它们由 F-3 结构化路径负责，不是文本解析。
const rules = parseFalsifierRules(chatFalsifiers);
assert.equal(rules.length, 1, "两条证伪条件里只有'股价跌破 300 港元'是可执行价格规则");
assert.equal(rules[0].kind, "price_below");
assert.equal(rules[0].threshold, 300);
assert.deepEqual(parseFalsifierRules(["毛利率跌破 55%", "收入增速低于 -2.3%"]), [], "基本面口径不得被误解析成股价规则");

// ── 5. 段落引导语不是证伪条件。真实回答（falsifyMode 意图）在小标题后先写一句
//     "以下事实出现任意一项，即需重估…："，它紧跟标题且此时还没收集到条目，
//     必须被跳过而不是当成第一条证伪线存进画像。
const withLeadIn = [
  "**会推翻逻辑的关键事实**",
  "以下事实出现任意一项，即需重估腾讯的核心逻辑：",
  "- 游戏流水连续两个季度同比下滑超过 10%。",
  "- 广告收入增速持续低于行业平均水平。"
].join("\n");
const leadInItems = extractFalsifiersFromAnswer(withLeadIn);
assert.equal(leadInItems.length, 2, "引导语不能被算成一条证伪条件");
assert.ok(!leadInItems.some((item) => /以下事实出现任意一项/.test(item)));

// ── 6. 取不到时诚实返回空，不硬凑（下游据此回退到 panel.oneLineView 而不是写入假主线）。
assert.equal(extractThesisFromAnswer("一段没有任何小标题的自由文本。"), null);
assert.deepEqual(extractFalsifiersFromAnswer("一段没有证伪条件段落的正文。"), []);

console.log("Research snapshot extraction ✓ chat 粗体 / 深度报告 ## / 老格式 三代小标题都能提取");
