/**
 * F-3 结构化证伪条件 + 港股回购事实块的回归测试。
 *
 * 这两条链路都曾整段静默失效：F-3 的提示词指令在 #27 迁移里随旧底盘丢失（域层校验
 * 代码全在、就是没人喂数据），hk_buybacks 则是采了半年没有任何读取方。共同点是
 * "不报错、只是永远不生效"——只有把契约钉死，才能在它们再次漂移时立刻失败。
 */
import assert from "node:assert/strict";
import {
  extractStructuredFalsifiers, evaluateFundamentalRule, FUNDAMENTAL_METRICS, hkBuybackToPrompt,
  streamSafeResearchText
} from "../src/index.js";

// ── 1. FALSIFIERS_JSON 必须被剥离出正文。它是给系统看的，漏进去就是用户可见的乱码，
//     而且那行里的阈值数字会被 factGuard 当成"未能核对的数字"凭空拉低准信。
const answer = [
  "北京时间 2026-07-15，腾讯控股 最近的状态是：利润质量稳健。",
  "",
  "**证伪条件**",
  "- 毛利率跌破 50%",
  "",
  'FALSIFIERS_JSON: [{"metric":"grossMargin","op":"below","threshold":50,"text":"毛利率跌破 50%"},{"metric":"netMargin","op":"below","threshold":25,"text":"净利率跌破 25%"}]'
].join("\n");
const { rules, cleanContent } = extractStructuredFalsifiers(answer);
assert.ok(!cleanContent.includes("FALSIFIERS_JSON"), "机器可读行必须从正文里剥掉");
assert.ok(cleanContent.includes("利润质量稳健"), "剥离不得损伤正文");
assert.equal(rules.length, 2);
assert.deepEqual(rules[0], { kind: "fundamental_below", metric: "grossMargin", threshold: 50, label: "毛利率跌破 50%" });

// ── 1b. 流式可见前缀：完整标记与半截标记都不能漏进气泡。
assert.equal(streamSafeResearchText(answer), cleanContent.trimEnd());
assert.ok(!streamSafeResearchText("正文。\nFALSIFIERS_").includes("FALSIFIERS_"), "半截标记必须扣住");
assert.equal(streamSafeResearchText("正文还在写"), "正文还在写");

// ── 2. 白名单外的指标整条丢弃，不猜、不硬凑。
//     freeCashFlow 已被移出白名单：filing schema 没有 capex 列，FCF 根本算不出来，
//     留着它只会产生"永远不会触发但用户以为在盯"的哑规则。
assert.ok(!FUNDAMENTAL_METRICS.includes("freeCashFlow"), "算不出来的指标不能出现在白名单里");
const junk = extractStructuredFalsifiers('FALSIFIERS_JSON: [{"metric":"freeCashFlow","op":"below","threshold":0.8,"text":"现金流/净利润低于0.8"},{"metric":"gross_margin","op":"below","threshold":50,"text":"蛇形命名"},{"metric":"grossMargin","op":"crash","threshold":50,"text":"非法 op"},{"metric":"grossMargin","op":"below","threshold":99999,"text":"离谱阈值"}]');
assert.deepEqual(junk.rules, [], "白名单外指标/非法 op/离谱阈值必须全部丢弃");

// ── 3. 残缺 JSON（模型截断）不得抛错，且那行仍要被剥掉——格式不完美不是放它泄露的理由。
const broken = extractStructuredFalsifiers('正文。\nFALSIFIERS_JSON: [{"metric":"grossMargin",');
assert.deepEqual(broken.rules, []);
assert.ok(!broken.cleanContent.includes("FALSIFIERS_JSON"));

// ── 4. 基本面规则只在真拿到该指标时核对；缺数据是"不知道"，不是"未触发"。
assert.deepEqual(
  evaluateFundamentalRule({ kind: "fundamental_below", metric: "grossMargin", threshold: 50 }, { providerStatus: "ok", grossMargin: 45 }),
  { triggered: true, sane: true, currentValue: 45 }
);
assert.equal(evaluateFundamentalRule({ kind: "fundamental_below", metric: "grossMargin", threshold: 50 }, { providerStatus: "ok" }).sane, false,
  "指标缺失必须 sane:false，不能当成未触发");
assert.equal(evaluateFundamentalRule({ kind: "fundamental_below", metric: "grossMargin", threshold: 50 }, null).sane, false);

// ── 5. 港股回购事实块：口径纪律不能丢。
const rows = [
  { tradeDate: "2026-07-08", sharesRepurchased: "1000000", totalConsideration: "473000000", currency: "HKD", sharesIssuedTotal: "9000000000", periodEndDate: "2026-07-08" },
  { tradeDate: "2026-03-26", sharesRepurchased: "1000000", totalConsideration: "380000000", currency: "HKD", sharesIssuedTotal: "9100000000", periodEndDate: "2026-03-26" }
];
const block = hkBuybackToPrompt(rows);
assert.match(block, /累计购回 2,000,000 股/);
assert.match(block, /约占已发行股份 0\.02%/);
assert.match(block, /注销有滞后/, "已发行股份趋势必须带注销滞后的免责说明，不能说成即时净股本");
assert.match(block, /不含未执行的授权额度/, "必须声明只含已成交购回——授权额度不是事实");
assert.equal(hkBuybackToPrompt([]), "", "无数据返回空串，由调用方决定'未核到'文案");
assert.equal(hkBuybackToPrompt(null), "");

console.log("Structured falsifiers + HK buyback ✓ 剥离/白名单/口径纪律都锁住了");
