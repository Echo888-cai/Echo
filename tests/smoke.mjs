import "./setupTestDb.mjs";
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
import { beijingDate, anchorQueryToDate, hasRelativeTime } from "../src/server/utils/time.js";
import { buildEvidenceQueries } from "../src/server/services/intentClassifier.js";
import { fmpGet, fmpKeyPool, _resetFmpClient } from "../src/fmpClient.js";
import { parseUserContext } from "../src/server/services/userContext.js";
import { classifyNewsSeverity } from "../src/server/services/eventEngine.js";
import { upsertCompanyProfile, getCompanyProfile, deleteCompanyProfile } from "../src/server/repositories/companyProfiles.js";
import { upsertPosition, getPosition, deletePosition } from "../src/server/repositories/portfolio.js";
import { looksMultiHolding } from "../src/server/services/entityExtractor.js";

assert.equal(companies.length, 31, "seed data should include 31 HK companies");
assert.equal(PROMPT_VERSION, "luvio-prompts-v0.6");
assert.ok(promptNames().includes("首席研究助手"));
assert.ok(PROMPTS.risk.system.includes("挑战"));
// 研究纪律宪法注入 cio 与 chat 两条链路。
assert.ok(PROMPTS.cio.system.includes("概率优先"), "cio prompt should embed the research discipline");
assert.ok(PROMPTS.chat.system.includes("概率优先"), "chat prompt should embed the research discipline");

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

// ── 时间锚点与查询改写 ──────────────────────────────────────────
assert.match(beijingDate(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(hasRelativeTime("今天怎么样"), true);
assert.equal(hasRelativeTime("基本面如何"), false);
assert.equal(anchorQueryToDate("AAPL news", "AAPL 基本面"), "AAPL news", "无相对时间不改写");
assert.ok(anchorQueryToDate("AAPL news", "今天 AAPL 怎么样").startsWith(beijingDate()), "相对时间问题改写为绝对日期");
const relQueries = buildEvidenceQueries({ company: { ticker: "AAPL", nameEn: "Apple", nameZh: "苹果" }, question: "今天苹果怎么样" });
assert.ok(relQueries.every((q) => q.startsWith(beijingDate())), "相对时间问题的所有查询都锚定日期");

// ── FMP 多 Key fallback / 缓存 / 冷却 ──────────────────────────────
await (async () => {
  const realFetch = globalThis.fetch;
  const prevKeys = process.env.FMP_API_KEYS;
  const prevKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEYS = "KEY_BAD,KEY_GOOD";
  delete process.env.FMP_API_KEY;
  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const key = new URL(url).searchParams.get("apikey");
    if (key === "KEY_BAD") return { ok: false, status: 401, text: async () => "unauthorized" };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ key }]) };
  };
  try {
    assert.deepEqual(fmpKeyPool(), ["KEY_BAD", "KEY_GOOD"]);
    _resetFmpClient();
    let r = await fmpGet("/stable/profile", { symbol: "AAPL" });
    assert.equal(r[0].key, "KEY_GOOD", "401 应自动 fallback 到下一个 Key");
    assert.equal(calls.length, 2);
    calls = [];
    await fmpGet("/stable/profile", { symbol: "AAPL" });
    assert.equal(calls.length, 0, "同请求应命中缓存");
    calls = [];
    await fmpGet("/stable/profile", { symbol: "MSFT" });
    assert.equal(calls.length, 1, "被拒 Key 冷却后不再重试");
  } finally {
    globalThis.fetch = realFetch;
    _resetFmpClient();
    if (prevKeys === undefined) delete process.env.FMP_API_KEYS; else process.env.FMP_API_KEYS = prevKeys;
    if (prevKey === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = prevKey;
  }
})();

// ── P2.1 公司画像：建档 + 部分更新保留 ────────────────────────────
{
  const T = "SMOKEPF.US";
  deleteCompanyProfile(T);
  upsertCompanyProfile(T, { companyName: "冒烟", thesis: "现金流稳", researchStatus: "watch", confidence: "中", event: { date: "2026-06-22", summary: "建档" } });
  let p = getCompanyProfile(T);
  assert.equal(p.thesis, "现金流稳");
  assert.equal(p.events.length, 1);
  upsertCompanyProfile(T, { confidence: "低" }); // 部分更新
  p = getCompanyProfile(T);
  assert.equal(p.confidence, "低");
  assert.equal(p.thesis, "现金流稳", "部分更新应保留 thesis");
  deleteCompanyProfile(T);
}

// ── 画像卫生回归：诊断文案不冒充主线 + 数据抖动不进时间线 + 研究覆盖手动隐藏 ──
{
  const { updatePortraitFromPanel, extractFalsifiersFromAnswer } = await import("../src/server/services/companyPortrait.js");

  // 证伪抽取不得越过段落边界（"我的判断：…"散文头曾整段泄漏进证伪条件）。
  const fals = extractFalsifiersFromAnswer([
    "证伪条件", "1. 股价跌破 100 美元。", "2. 毛利率连续两季下滑超过 2 个点。", "",
    "我的判断：整体商业逻辑还成立。", "还缺什么（不影响判断）", "- 一致预期"
  ].join("\n"));
  assert.deepEqual(fals, ["股价跌破 100 美元。", "毛利率连续两季下滑超过 2 个点。"], "证伪抽取应止步于段落边界");
  const { addToWatch, removeFromWatch, getHiddenTickers, listWatchAdds } = await import("../src/server/repositories/watchlist.js");
  const { getDb } = await import("../src/db/index.js");
  const T = "SMOKECLEAN.US";
  deleteCompanyProfile(T);

  const mkPanel = (over = {}) => ({
    ticker: T, companyName: "清洁冒烟", researchStatus: "watch", confidence: "中",
    oneLineView: "现金流驱动的稳健复合，主线成立", keyDrivers: [], riskTriggers: [], sources: [], ...over
  });
  // 首轮：真实主线建档
  const r1 = updatePortraitFromPanel({ ticker: T, panel: mkPanel(), question: "值得研究吗" });
  assert.equal(r1.created, true);
  assert.equal(r1.profile.thesis, "现金流驱动的稳健复合，主线成立");
  // 第二轮：模型没给 oneLineView（本地兜底路径），状态/置信度还在抖 → 不算判断变化、主线保留、时间线不加垃圾
  const r2 = updatePortraitFromPanel({ ticker: T, panel: mkPanel({ oneLineView: "", researchStatus: "research_more", confidence: "低" }) });
  assert.equal(r2.changed, false, "数据可用性抖动不算判断变化");
  assert.equal(r2.profile.thesis, "现金流驱动的稳健复合，主线成立", "空主线不得覆盖真实判断");
  assert.equal(r2.profile.events.filter((e) => e.kind === "thesis_change").length, 0, "抖动不得进时间线");
  // 第三轮：真实主线变化 → 恰好记一条
  const r3 = updatePortraitFromPanel({ ticker: T, panel: mkPanel({ oneLineView: "现金流增速放缓，主线转弱为观察" }) });
  assert.equal(r3.changed, true, "真实主线变化应记事件");
  assert.equal(r3.profile.events.filter((e) => e.kind === "thesis_change").length, 1);
  deleteCompanyProfile(T);

  // 看盘闭环语义：手动移除(hide)后重新研究(addToWatch)应重新可见
  removeFromWatch(T);
  assert.ok(getHiddenTickers().has(T), "removeFromWatch 应写 hide");
  addToWatch(T, "清洁冒烟");
  assert.ok(!getHiddenTickers().has(T), "重新研究应覆盖 hide");
  assert.ok(listWatchAdds().some((x) => x.ticker === T), "翻转后应出现在关注列表");
  getDb().prepare("DELETE FROM watchlist_prefs WHERE ticker = ?").run(T);
}

// ── Markdown 渲染：新语法（hr/表格/斜体/行内代码/引用/h4）+ 正文数字不受占位符误伤 ──
{
  const { markdownToHtml } = await import("../src/ui/markdown.js");
  const out = markdownToHtml([
    "**加粗** 与 *斜体* 和 `code` 与 [苹果](https://apple.com)",
    "---",
    "| 指标 | 数值 |",
    "|---|---:|",
    "| 营收 | 949 亿 |",
    "> 引用",
    "#### 小标题",
    "价格 308.63，涨 4.8%"
  ].join("\n"));
  assert.ok(out.includes('<hr class="md-rule"'), "--- 应渲染为分隔线而非裸文本");
  assert.ok(!out.includes("<p>---</p>"), "不得再出现裸 --- 段落");
  assert.ok(out.includes('<table class="md-table"') && out.includes("<th>指标</th>"), "表格应渲染");
  assert.ok(out.includes('class="md-al-r"'), "表格右对齐应生效");
  assert.ok(out.includes("<em>斜体</em>") && out.includes('<code class="md-code">code</code>'), "斜体/行内代码应渲染");
  assert.ok(out.includes(">苹果</a>"), "markdown 链接应渲染");
  assert.ok(out.includes('<blockquote class="md-quote"') && out.includes("<h4>小标题</h4>"), "引用/h4 应渲染");
  assert.ok(out.includes("308.63") && out.includes("4.8%") && out.includes("949 亿"), "正文数字不得被占位符吞掉");
}

// ── P3.1 事件引擎：新闻分级 ────────────────────────────────────────
assert.equal(classifyNewsSeverity({ title: "ROSEN LAW Reminds Investors" }), "drop", "律所广告→drop");
assert.equal(classifyNewsSeverity({ title: "Company faces SEC investigation" }), "high", "SEC调查→high");
assert.equal(classifyNewsSeverity({ title: "公司发布新配色" }), "low", "普通新闻→low");

// ── P3.2 持仓：止损/止盈解析 + 记账部分更新 ──────────────────────
{
  const c = parseUserContext("成本 4.9，持有 3000 股，止损 4.2，止盈 6.5");
  assert.equal(c.stopLoss, "4.2");
  assert.equal(c.takeProfit, "6.5");
  const T = "SMOKEPOS.US";
  deletePosition(T);
  upsertPosition(T, { companyName: "冒烟", shares: 3000, avgCost: 4.9, stopLoss: 4.2 });
  upsertPosition(T, { stopLoss: 4.0 });
  const p = getPosition(T);
  assert.equal(p.stopLoss, 4.0);
  assert.equal(p.avgCost, 4.9, "部分更新应保留成本");
  deletePosition(T);
}

// ── P1 数据接地：真财报前置 + 分析师目标价进估值 ──────────────────
{
  const { displayValuation } = await import("../src/server/services/valuationEngine.js");
  const { buildChatPrompt } = await import("../src/server/services/answerComposer.js");

  // 一致预期存在、缺 EPS/PE 时，用分析师目标价区间替代机械 ±25% 带，且区间包住现价（可视化自洽）。
  const valEst = displayValuation(
    { ticker: "TESTUS", sector: "科技" },
    { price: 100, pe: null },
    { providerStatus: "ok", eps: null },
    { providerStatus: "ok", source: "FMP", consensusTargetPrice: 130, targetLow: 110, targetHigh: 150 }
  );
  assert.equal(valEst.method, "分析师目标价区间", "有合理一致预期时应替代机械 PE 带");
  assert.equal(valEst.analyst?.target, 130, "估值应携带分析师目标价锚点");
  assert.ok(parseFloat(valEst.bear) <= 100 && parseFloat(valEst.bull) >= 100, "估值区间应包住现价");

  // 离谱/陈旧目标价（>1.8x 现价，如 NVDA 一致目标 500 vs 现价 202）→ 退回现价 PE 带，
  // 但仍附 analyst 锚点。保证"有真 EPS 就一定有估值条"。
  const valStale = displayValuation(
    { ticker: "NVDA" },
    { price: 202, pe: null },
    { providerStatus: "ok", eps: 4.93 },
    { providerStatus: "ok", source: "FMP", consensusTargetPrice: 500, targetLow: 218, targetHigh: 500 }
  );
  assert.equal(valStale.method, "PE 区间", "离谱目标价应退回现价 PE 带");
  assert.equal(valStale.analyst?.target, 500, "PE 带仍附分析师锚点");
  assert.ok(parseFloat(valStale.bear) < 202 && parseFloat(valStale.bull) > 202, "PE 带应包住现价");

  // 有真财报（providerStatus ok）时，提示词必须前置实时财报块并声明唯一事实源，且行情带当日涨跌幅。
  const panel = {
    ticker: "AAPL", companyName: "Apple", researchStatus: "watch", confidence: "中",
    dataCompleteness: 70, oneLineView: "测试", keyDrivers: [], connectedData: [], missingData: [],
    price: { value: "190 USD", change: "-1.20%" }, sources: []
  };
  const liveFin = {
    providerStatus: "ok", source: "FMP", period: "2025-09-30",
    revenue: 9e10, revenueGrowth: 8, grossMargin: 45, operatingMargin: 30,
    netIncome: 2e10, freeCashFlow: 2.5e10, eps: 6.1
  };
  const prompt = buildChatPrompt("赚不赚钱", panel, {}, { financialsData: liveFin });
  assert.ok(prompt.includes("已核到的实时财报（来源"), "有真财报时应前置实时财报块");
  assert.ok(prompt.includes("唯一事实源"), "应声明财务数字唯一事实源");
  assert.ok(prompt.includes("（-1.20%）"), "行情应带当日涨跌幅");

  const prompt2 = buildChatPrompt("估值贵不贵", panel, {}, { financialsData: liveFin, valuation: valEst });
  assert.ok(prompt2.includes("分析师一致目标价 130"), "估值行应带分析师目标价");

  // 无真财报时回退档案口径，不前置实时财报块。
  const promptNoFin = buildChatPrompt("赚不赚钱", panel, {}, { financialsData: { providerStatus: "missing" } });
  assert.ok(!promptNoFin.includes("已核到的实时财报（来源"), "无真财报时不前置实时财报块");
  assert.ok(!promptNoFin.includes("唯一事实源"), "无真财报时不声明唯一事实源");
}

// ── P2 数据接地：SEC EDGAR 美股公告 + FMP 分部收入 ───────────────
{
  const { buildTickerCikMap, parseSecSubmissions } = await import("../src/secFilings.js");
  const { normalizeSegments, financialsToMarkdown } = await import("../src/financialData.js");

  // ticker → 10 位 CIK 映射
  const cikMap = buildTickerCikMap({
    0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    1: { cik_str: 789019, ticker: "MSFT", title: "Microsoft" }
  });
  assert.equal(cikMap.AAPL, "0000320193");
  assert.equal(cikMap.MSFT, "0000789019");

  // EDGAR submissions → 只保留 8-K/10-Q/10-K，URL 拼装正确
  const f = parseSecSubmissions(
    {
      filings: {
        recent: {
          form: ["8-K", "4", "10-Q", "10-K"],
          accessionNumber: ["0000320193-26-000001", "x", "0000320193-25-000050", "0000320193-24-000123"],
          filingDate: ["2026-01-30", "2026-01-29", "2025-10-31", "2024-11-01"],
          primaryDocument: ["a8k.htm", "f4.xml", "q3.htm", "10k.htm"],
          primaryDocDescription: ["Current report", "", "Quarterly", "Annual"]
        }
      }
    },
    "0000320193"
  );
  assert.equal(f.length, 3, "应过滤 Form 4，只保留 8-K/10-Q/10-K");
  assert.equal(f[0].filingType, "8-K");
  assert.ok(f[0].url.includes("/Archives/edgar/data/320193/000032019326000001/a8k.htm"), "EDGAR 文档 URL 拼装正确");

  // 分部收入归一化：新版 flat 形态 + 旧版 nested 形态 + 空
  const flat = normalizeSegments([
    { date: "2024-09-28", fiscalYear: 2024, period: "FY", data: { iPhone: 2.0e11, Services: 9.6e10, Mac: 3.0e10 } }
  ]);
  assert.equal(flat.segments[0].name, "iPhone", "分部按收入降序");
  assert.equal(flat.period, "2024-09-28");
  assert.ok(flat.segments[0].pct > flat.segments[1].pct);
  const nested = normalizeSegments([{ "2024-09-28": { Cloud: 4.1626e10, Commerce: 2.0e11 } }]);
  assert.equal(nested.segments[0].name, "Commerce", "旧版 nested 形态也能解析");
  assert.equal(normalizeSegments([]), null, "空输入返回 null");

  // 分部收入进入 financialsToMarkdown（即提示词的实时财报块）
  const md = financialsToMarkdown({
    providerStatus: "ok", source: "FMP", revenue: 1e11,
    segments: { period: "2024", source: "FMP", segments: [{ name: "云智能", value: 4.1626e10, pct: 38 }] }
  });
  assert.ok(md.includes("分部收入"), "财报块应含分部收入");
  assert.ok(md.includes("云智能") && md.includes("38%"), "分部应含名称与占比");
}

// P0 对话内多标的门控：looksMultiHolding 决定是否动用一次 LLM 抽取"当前公司之外"的其他持仓。
// 与前端 app.js isMultiHoldingQuestion 保持一致：命中才让"我持有 A 和 B"作为追问直发、后端补齐。
assert.equal(looksMultiHolding("我持有22股思科和7股spacex 成本分别是118.3和151能挣钱吗"), true, "双股持仓应命中");
assert.equal(looksMultiHolding("我持有腾讯和阿里"), true, "持有+列举应命中");
assert.equal(looksMultiHolding("苹果、英伟达、特斯拉我都拿着"), true, "口语所有权动词应命中");
assert.equal(looksMultiHolding("思科现金流和利润怎么样"), false, "同公司追问不应命中");
assert.equal(looksMultiHolding("苹果和英伟达哪个好"), false, "纯对比走对比路径，门控不命中");
assert.equal(looksMultiHolding("估值贵不贵"), false, "单点追问不应命中");

console.log("Smoke tests passed.");
