// M-3 测试：看盘内容质量——thesis 碎片过滤（R12）+ 同题材事件去重（P11）。
// [1] isDataFragmentThesis：真实碎片样本命中、真实合法主线/业务描述不误伤。
// [2] updatePortraitFromPanel：oneLineView 缺失时不再回落到 keyDrivers 数据摘要
//     （根因验证——这是 R12 的核心回归点），且能正确保留上一轮的真实主线。
// [3] dedupeSimilarNews：真实抓到的三条同题材回购新闻按标定阈值部分聚合，
//     不同事实的新闻（真实标题）不被误合并（红线：错合=0）。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { isDataFragmentThesis, updatePortraitFromPanel } from "../src/server/services/companyPortrait.js";
import { getCompanyProfile } from "../src/server/repositories/companyProfiles.js";
import { dedupeSimilarNews } from "../src/server/services/eventEngine.js";

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

console.log("[1] isDataFragmentThesis（真实碎片样本，来自 2026-07-07 实跑审计）");

check("「收入增速 -1.10%，毛利率 55.71%」命中（0700.HK 真实脏数据）", () => {
  assert.equal(isDataFragmentThesis("收入增速 -1.10%，毛利率 55.71%"), true);
});
check("「增速波动、无单一方向（59.9% → 1.3% → 127.0% → 115.4% → 67.4%），毛利率 74.15%」命中（NVDA 真实脏数据）", () => {
  assert.equal(isDataFragmentThesis("增速波动、无单一方向（59.9% → 1.3% → 127.0% → 115.4% → 67.4%），毛利率 74.15%"), true);
});
check("空字符串不命中（不是碎片，是缺失，两者处理路径不同）", () => {
  assert.equal(isDataFragmentThesis(""), false);
  assert.equal(isDataFragmentThesis(null), false);
});
check("真实合法主线不误伤（阿里巴巴，唯一一条真实通过审计的主线）", () => {
  assert.equal(isDataFragmentThesis("阿里巴巴是中国电商和云基础设施核心公司，价值重估取决于电商竞争、云增长和资本回报。"), false);
});
check("业务描述类 prose 不误伤（即使提到具体业务名词）", () => {
  assert.equal(isDataFragmentThesis("耐世特是一家汽车转向与线控底盘供应商，收入与全球整车厂平台周期、北美订单、智能底盘渗透率高度相关。"), false);
});
check("单个百分号的正常判断句不误伤（数字密度阈值不应误伤含一两个数字的正常判断）", () => {
  assert.equal(isDataFragmentThesis("公司毛利率处于历史高位，但增长放缓，估值隐含了过度乐观的预期。"), false);
});

console.log("\n[2] updatePortraitFromPanel：oneLineView 缺失时不再回落到数据摘要（R12 根因回归）");

check("panel 无 oneLineView、keyDrivers 有基本面数据摘要时，thesis 不会被数据摘要污染——首次建档因无真实内容而不建档", () => {
  const panel = {
    ticker: "TEST1",
    companyName: "测试公司",
    oneLineView: "", // 模型未给出（本地兜底路径，R12 的触发条件）
    keyDrivers: [{ name: "基本面", summary: "收入增速 12.3%，毛利率 45.6%" }],
    riskTriggers: []
  };
  const result = updatePortraitFromPanel({ ticker: "TEST1", panel });
  // thesis 候选是空字符串（oneLineView 缺失且无 profile.summary），bull/bear 也空——
  // 触发"没有实质内容不建档"的诚实降级，不会拿数据摘要凑一条假主线。
  assert.equal(result.created, false);
  assert.equal(getCompanyProfile("TEST1"), null, "不应该建出一条以数据摘要为 thesis 的假画像");
});

check("已有真实主线时，本轮 oneLineView 缺失不会用数据摘要覆盖旧主线（保留上一轮判断）", () => {
  const panelWithThesis = {
    ticker: "TEST2", companyName: "测试公司2",
    oneLineView: "这是一句真实的投资主线判断。",
    keyDrivers: [], riskTriggers: []
  };
  const first = updatePortraitFromPanel({ ticker: "TEST2", panel: panelWithThesis });
  assert.equal(first.created, true);
  assert.equal(first.profile.thesis, "这是一句真实的投资主线判断。");

  const panelNoThesis = {
    ticker: "TEST2", companyName: "测试公司2",
    oneLineView: "", // 本轮模型未给出
    keyDrivers: [{ name: "基本面", summary: "收入增速 -5.0%，毛利率 30.0%" }],
    riskTriggers: []
  };
  const second = updatePortraitFromPanel({ ticker: "TEST2", panel: panelNoThesis });
  assert.equal(second.profile.thesis, "这是一句真实的投资主线判断。", "应保留上一轮真实主线，不被本轮数据摘要覆盖");
});

console.log("\n[3] dedupeSimilarNews（真实抓到的 0700.HK 同日事件，2026-07-06；数字 token 匹配方案）");

const REAL_EVENTS = [
  { kind: "news", ticker: "0700.HK", severity: "medium", title: "腾讯控股(00700.HK)7月6日回购46.50万股，耗资2.05亿港元", date: "2026-07-06 21:39:00", url: "" },
  { kind: "news", ticker: "0700.HK", severity: "medium", title: "腾讯控股回购47万股 金额达2.05亿港元", date: "2026-07-06 18:02:00", url: "" },
  { kind: "news", ticker: "0700.HK", severity: "medium", title: "腾讯控股7月6日回购46.5万股股份", date: "2026-07-06 17:58:42", url: "" },
  { kind: "news", ticker: "0700.HK", severity: "low", title: "上半年港股市场累计回购超过900亿港元 腾讯控股年内回购金额超240亿港元", date: "2026-07-06 07:08:00", url: "" },
  { kind: "news", ticker: "0700.HK", severity: "low", title: "港股恒生科技指数涨超2%，腾讯控股涨超5%", date: "2026-07-07 10:17:39", url: "" },
  { kind: "news", ticker: "0700.HK", severity: "low", title: "港股午盘｜恒指涨0.83% 腾讯控股涨近4%", date: "2026-07-06 12:05:24", url: "" }
];

check("三条真实回购新闻共享具体金额/股数，全部合并成一条，标最长标题为代表 + relatedCount", () => {
  const out = dedupeSimilarNews(REAL_EVENTS);
  const merged = out.find((e) => e.relatedCount > 1);
  assert.ok(merged, "应有一条被标记为同题材聚合");
  assert.equal(merged.relatedCount, 3, "A/B 共享 2.05 亿港元、A/C 共享 46.5 万股左右的股数，三条应全部聚合");
  assert.equal(merged.title, "腾讯控股(00700.HK)7月6日回购46.50万股，耗资2.05亿港元", "代表标题应是簇内最长、信息量最完整的那条");
});

check("不同事实的新闻不被误合并（红线：错合=0）——累计回购/两条涨跌快讯各自独立", () => {
  const out = dedupeSimilarNews(REAL_EVENTS);
  assert.equal(out.length, 4, "6 条真实事件应变成 4 条（三条回购合一，另 3 条各自独立）");
  const titles = out.map((e) => e.title);
  assert.ok(titles.includes("上半年港股市场累计回购超过900亿港元 腾讯控股年内回购金额超240亿港元"), "累计回购口径（900亿/240亿）金额量级不同，不应被合并进单笔回购（2.05亿）");
  assert.ok(titles.includes("港股恒生科技指数涨超2%，腾讯控股涨超5%"), "指数涨幅新闻应独立保留");
  assert.ok(titles.includes("港股午盘｜恒指涨0.83% 腾讯控股涨近4%"), "另一条指数新闻不应被误合并");
});

check("回归测试：真实复现过的假阳性——三条不同时点的涨跌快讯曾被字符相似度方案误合并成一条，数字 token 方案下必须保持独立", () => {
  // 真实数据：同一天三条不同时刻的涨跌快讯，字符 trigram 重叠率算出 0.6~0.8（因为短标题
  // "腾讯控股涨超4%"的字符集几乎是任何同公司标题的子集），被第一版实现错误合并成一条——
  // 这是真实跑出来的 bug，此处锁定回归。
  const events = [
    { kind: "news", ticker: "0700.HK", severity: "low", title: "腾讯控股涨超4%", date: "2026-07-06 10:28:05", url: "" },
    { kind: "news", ticker: "0700.HK", severity: "low", title: "港股科网股拉升，哔哩哔哩、腾讯控股涨超3%", date: "2026-07-06 10:11:32", url: "" },
    { kind: "news", ticker: "0700.HK", severity: "low", title: "港股午盘｜恒指涨0.83% 腾讯控股涨近4%", date: "2026-07-06 12:05:24", url: "" }
  ];
  const out = dedupeSimilarNews(events);
  assert.equal(out.length, 3, "三条不同时点的涨跌快讯都提不出具体金额/股数 token，必须保持互相独立");
  assert.ok(!out.some((e) => "relatedCount" in e), "任何一条都不应带 relatedCount（没有数字依据就不该聚合）");
});

check("金额四舍五入误差在 2% 容差内仍判定为同一事件（46.50万 vs 47万，相对误差约 1.08%）", () => {
  const events = [
    { kind: "news", ticker: "TEST", severity: "medium", title: "测试公司回购46.50万股，耗资1.00亿港元", date: "2026-01-01", url: "" },
    { kind: "news", ticker: "TEST", severity: "medium", title: "测试公司回购47万股 金额达1.00亿港元", date: "2026-01-01", url: "" }
  ];
  const out = dedupeSimilarNews(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].relatedCount, 2);
});

check("金额数量级明显不同时不合并（900亿 vs 2.05亿，相对误差远超 2% 容差）", () => {
  const events = [
    { kind: "news", ticker: "TEST2", severity: "low", title: "测试公司累计回购超过900亿港元", date: "2026-01-01", url: "" },
    { kind: "news", ticker: "TEST2", severity: "medium", title: "测试公司单日回购耗资2.05亿港元", date: "2026-01-01", url: "" }
  ];
  const out = dedupeSimilarNews(events);
  assert.equal(out.length, 2);
});

check("非 news 事件（position_alert/earnings）原样透传，不参与相似度聚类", () => {
  const events = [
    { kind: "earnings", ticker: "AAPL", severity: "medium", title: "AAPL 财报临近：2026-07-30", date: "2026-07-01" },
    { kind: "position_alert", ticker: "AAPL", severity: "high", title: "苹果 触及止损线：现价 100 ≤ 止损 100", date: "2026-07-01" }
  ];
  const out = dedupeSimilarNews(events);
  assert.equal(out.length, 2);
  assert.ok(!out.some((e) => "relatedCount" in e));
});

check("空数组不报错", () => {
  assert.deepEqual(dedupeSimilarNews([]), []);
});

console.log(`\nM-3: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
