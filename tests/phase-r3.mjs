// R3 测试：数字级防幻觉护栏（factGuard.js，纯函数，不发真实网络请求）。
// [1] parseCompactAmount / convertCurrency：单位反解析与展示级汇率换算。
// [2] buildFactsRegistry：从结构化数据（行情/财报/估值/同业/财报日历/持仓）建登记表。
// [3] verifyAnswerNumbers：pass/soft/hard 三档判定，覆盖容差、符号、数量级、币种张冠李戴。
// [4] 回归：北京时间时间戳/来源引用不能被误判成待核实的财务日期（真实回答实测过会 100% 误报）。
// [5] buildSoftNote / summarizeVerdict / renderHardFailIssues：格式化辅助函数。
import {
  parseCompactAmount, convertCurrency, buildFactsRegistry, verifyAnswerNumbers,
  buildSoftNote, summarizeVerdict, renderHardFailIssues
} from "../src/server/services/factGuard.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] parseCompactAmount / convertCurrency");
{
  check("3.92 万亿 → 3.92e12", parseCompactAmount("3.92 万亿") === 3.92e12);
  check("2099.21 亿 → 2099.21e8", Math.abs(parseCompactAmount("2099.21 亿") - 2099.21e8) < 1);
  check("裸数字原样返回", parseCompactAmount("100") === 100);
  check("非法输入返回 null", parseCompactAmount("未核到") === null);
  check("CNY→HKD 用 1.08", convertCurrency(100, "CNY", "HKD") === 108);
  check("USD→HKD 用 7.8（peg）", convertCurrency(100, "USD", "HKD") === 780);
  check("未知币种返回 null", convertCurrency(100, "JPY", "HKD") === null);
}

console.log("[2] buildFactsRegistry：从结构化数据建登记表");
const sampleSources = {
  ticker: "0700.HK",
  marketSnapshot: {
    providerStatus: "ok", price: 431.2, currency: "HKD", changePercent: 0.23, pe: 15.75,
    marketCap: "3.92 万亿", ranges: { providerStatus: "ok", oneMonthPct: -10.5, ytdPct: 5.2 }
  },
  financialsData: {
    providerStatus: "ok", currency: "HKD", revenue: 209921000000, revenueGrowth: -1.1,
    netIncome: 63816000000, netMargin: 30.4, eps: 14.72, pe: 15.75, period: "2026-03-31",
    hkFilings: [{
      currency: "CNY", revenue: 209921000000, revenue_prior: 212300000000,
      net_income: 63816000000, net_income_prior: 64100000000,
      period_end: "2026-03-31", published_at: "2026-05-15T08:00:00Z"
    }]
  },
  valuation: {
    cannotValueReason: null, method: "PE 区间", bear: 336.34, base: 431.2, bull: 551.94, currentPrice: 431.2,
    methodDetail: [{ name: "PE 区间", bear: 336.34, base: 431.2, bull: 551.94 }],
    analyst: { target: 480, low: 420, high: 540 },
    compPeers: {
      providerStatus: "ok",
      peers: [
        { ticker: "1024.HK", multipleType: "PE", multiple: 8.94, matched: true },
        { ticker: "BIDU", multipleType: "PE", multiple: 1186.4, matched: true }
      ],
      anchor: { multipleType: "PE", p25: 8.94, median: 11.16, p75: 28.04, n: 4, tickers: ["1024.HK", "BIDU", "1357.HK", "9898.HK"] }
    }
  },
  earnings: { providerStatus: "ok", nextDate: "2026-08-11", source: "Finnhub" },
  position: { avgCost: 380, stopLoss: 340, takeProfit: 500 }
};
const registry = buildFactsRegistry(sampleSources);
{
  check("现价进了 HKD 桶", registry.amounts.HKD?.some((f) => f.value === 431.2 && f.label === "现价"));
  check("市值反解析成原始数值（3.92万亿）", registry.amounts.HKD?.some((f) => Math.abs(f.value - 3.92e12) < 1e9));
  check("收入进了金额桶", registry.amounts.HKD?.some((f) => f.value === 209921000000));
  check("净利率进了百分比桶", registry.percents.some((f) => f.value === 30.4));
  check("PE 进了倍数桶", registry.multiples.some((f) => f.value === 15.75 && f.label === "PE"));
  check("同业倍数进了倍数桶", registry.multiples.some((f) => f.value === 8.94 && f.label.includes("1024.HK")));
  check("同业锚点中位数进了倍数桶", registry.multiples.some((f) => f.value === 11.16 && f.label.includes("中位")));
  check("估值看空/看多进了金额桶", registry.amounts.HKD?.some((f) => f.value === 336.34) && registry.amounts.HKD?.some((f) => f.value === 551.94));
  check("分析师目标价进了金额桶", registry.amounts.HKD?.some((f) => f.value === 480));
  check("赔率不进倍数桶（尺度和 PE/EV-Sales 不同，混进去会污染数量级判定）", !registry.multiples.some((f) => f.label === "赔率"));
  check("下一业绩日进了日期桶", registry.dates.some((f) => f.iso === "2026-08-11" && f.label === "下一业绩日"));
  check("hkFilings 收入同比派生进了百分比桶", registry.percents.some((f) => f.label.includes("收入同比") && f.value < 0));
  check("持仓浮动盈亏现算进了百分比桶", registry.percents.some((f) => f.label === "持仓浮动盈亏" && Math.abs(f.value - ((431.2 - 380) / 380) * 100) < 0.01));
  check("止损线进了金额桶", registry.amounts.HKD?.some((f) => f.value === 340 && f.label === "止损线"));
}

console.log("[3] verifyAnswerNumbers：pass / soft / hard 判定");
{
  const passText = "北京时间 2026-07-05，腾讯现价 431.20 HKD，PE 15.75x，净利率 30.4%，同业 1024.HK PE 8.9x，下一业绩日 2026-08-11。";
  const v1 = verifyAnswerNumbers(passText, registry);
  check("现价/PE/净利率/同业倍数/业绩日全部 pass，无 hard", v1.hardCount === 0, JSON.stringify(v1.checked));
  check("确实抽到了这几类数字", v1.checked.length >= 5, `实际 ${v1.checked.length}`);

  // 符号/数量级测试用隔离的小登记表（只放一个百分比/一个倍数），避免大样本表里
  // 恰好存在"距离更近但方向不同"的干扰事实（比如 -10.5% 的近1月回报）掩盖了符号翻转。
  const isolatedRegistry = buildFactsRegistry({
    ticker: "TEST",
    marketSnapshot: { providerStatus: "ok", price: 100, currency: "HKD" },
    financialsData: { providerStatus: "ok", currency: "HKD", netMargin: 30.4, pe: 15.75 }
  });

  const signFlipText = "净利率 -30.4%，盈利能力大幅恶化。";
  const v2 = verifyAnswerNumbers(signFlipText, isolatedRegistry);
  check("百分比符号相反判 hard", v2.checked.some((c) => c.dimension === "percent" && c.verdict === "hard"));

  const magnitudeText = "PE 551x，明显高估。";
  const v3 = verifyAnswerNumbers(magnitudeText, isolatedRegistry);
  check("倍数数量级相差 ≥30 倍判 hard", v3.checked.some((c) => c.dimension === "multiple" && c.verdict === "hard"));

  const softText = "分析师给的乐观目标价约 600 HKD。";
  const v4 = verifyAnswerNumbers(softText, registry);
  check("找不到但没有离谱到 10 倍的金额判 soft（不拦截）", v4.checked.some((c) => c.dimension === "amount" && c.verdict === "soft"));
  check("soft 不算进 hardCount", v4.hardCount === 0);

  const crossOk = "以人民币口径折算，EPS 约 13.6 元人民币。"; // 14.72 HKD * (1/1.08) ≈ 13.63 CNY
  const v5 = verifyAnswerNumbers(crossOk, registry);
  check("跨币种换算在容差内判 pass", v5.checked.some((c) => c.dimension === "amount" && c.verdict === "pass"));

  const mislabel = "现价 431.20 美元。"; // 数值精确等于 HKD 事实，但标注成了美元——典型币种张冠李戴
  const v6 = verifyAnswerNumbers(mislabel, registry);
  check("数值精确撞上本币事实但币种标错判 hard", v6.checked.some((c) => c.dimension === "amount" && c.verdict === "hard" && /币种/.test(c.reason || "")), JSON.stringify(v6.checked));

  const dateWrong = "下一业绩日预计是 2020-01-01。"; // 年份在登记表里完全没有，连"同季度"都对不上
  const v7 = verifyAnswerNumbers(dateWrong, registry);
  check("显式日期找不到匹配判 hard", v7.checked.some((c) => c.dimension === "date" && c.verdict === "hard"));

  const dateRight = "下一业绩日 2026-08-11。";
  const v8 = verifyAnswerNumbers(dateRight, registry);
  check("显式日期精确匹配判 pass", v8.checked.some((c) => c.dimension === "date" && c.verdict === "pass"));

  const quarterOnly = "2026 年 Q3 业绩值得关注。"; // 下一业绩日 2026-08-11 属于 Q3
  const v9 = verifyAnswerNumbers(quarterOnly, registry);
  check("季度级别提及、年+季度对得上判 pass", v9.checked.some((c) => c.dimension === "date" && c.verdict === "pass"));
}

console.log("[4] 回归：北京时间时间戳 / 来源引用不误判");
{
  const withTimestamp = "北京时间 2026-07-05 20:16，腾讯控股最近的状态是：估值处于中性区间。\n\n来源：\n- finance.eastmoney.com：2026-07-02 21:21:00";
  const v = verifyAnswerNumbers(withTimestamp, registry);
  check("北京时间戳不产生任何日期候选（不会因此误判 hard）", !v.checked.some((c) => c.dimension === "date"), JSON.stringify(v.checked));
  check("来源列表里的日期不被扫描", v.checked.length === 0, JSON.stringify(v.checked));

  const noContext = "本轮有 3 家同业，第 1 条最相关，参考 T-5 提醒。";
  const v2 = verifyAnswerNumbers(noContext, registry);
  check("无货币标签/关键词的裸数字不产生候选（防误报 3/1/5 这类非财务数字）", v2.checked.length === 0, JSON.stringify(v2.checked));

  // 真实影子模式抓到：腾讯回购新闻"连续32日回购，累计回购3451.51万股"——股数不是金额，
  // 拿去跟估值/收入比对会因数量级差几十万倍被误判 hard。
  const shareCount = "腾讯控股连续32日回购，累计回购3451.51万股，回购金额5.01亿港元。";
  const v3 = verifyAnswerNumbers(shareCount, registry);
  check("股数不产生金额候选", !v3.checked.some((c) => c.dimension === "amount" && Math.abs(c.value - 3451.51e4) < 1), JSON.stringify(v3.checked));
  check("紧跟着的真实金额（回购金额）仍然正常抽取", v3.checked.some((c) => c.dimension === "amount" && Math.abs(c.value - 5.01e8) < 1));
}

console.log("[4.5] 回归：金额桶跨数量级时按对数距离找最近事实，不按绝对差");
{
  // 登记表同时有 551.94（估值）和 2099.21亿（收入）这种跨 8 个数量级的金额。"10亿"在
  // 绝对差上离 551.94 更"近"（约 1e9 vs 2e11），但量级上明显更接近收入——修复前会被误判
  // 成"离估值差 180 万倍"的 hard，现在应该顶多是 soft（毕竟"10亿"具体对应什么我们确实
  // 没有能核对的事实，但不该被扣一个荒谬的"离 551.94 差 180 万倍"的理由）。
  const text = "如果按 10 亿港元的规模计算。";
  const v = verifyAnswerNumbers(text, registry);
  const amountChecks = v.checked.filter((c) => c.dimension === "amount");
  check("抽到了金额候选", amountChecks.length > 0, JSON.stringify(v.checked));
  check("不会被夸张地判成数量级差 100 万倍以上的 hard", !amountChecks.some((c) => c.verdict === "hard" && /\d{6,} 倍/.test(c.reason || "")), JSON.stringify(amountChecks));

  // 真实影子模式抓到的崩溃级回归：候选值恰好是 0 时 log10(0/x)=-Infinity，落到"挑
  // bucket[0] 兜底"的分支，吐出一句"数量级相差 Infinity 倍"的荒谬提示。
  const zeroText = "净债务 0 HKD。";
  const vZero = verifyAnswerNumbers(zeroText, registry);
  check("候选值为 0 时不产生 Infinity 倍这种荒谬理由", !vZero.checked.some((c) => /Infinity/.test(c.reason || "")), JSON.stringify(vZero.checked));
}

console.log("[5] buildSoftNote / summarizeVerdict / renderHardFailIssues");
{
  const isolatedRegistry = buildFactsRegistry({
    ticker: "TEST",
    marketSnapshot: { providerStatus: "ok", price: 100, currency: "HKD" },
    financialsData: { providerStatus: "ok", currency: "HKD", netMargin: 30.4, pe: 15.75 }
  });
  const v = verifyAnswerNumbers("净利率 -30.4%，PE 551x。", isolatedRegistry);
  const note = buildSoftNote(v);
  check("有 hard 命中时提示文案包含数量说明", /存在明显不一致/.test(note));
  const summary = summarizeVerdict(v);
  check("summarizeVerdict 统计数量正确", summary.hard === v.hardCount && summary.total === v.checked.length);
  const issues = renderHardFailIssues(v);
  check("renderHardFailIssues 列出每条 hard 问题", issues.split("\n").length === v.hardCount);
  check("空 verdict 的 buildSoftNote 返回空字符串", buildSoftNote({ softCount: 0, hardCount: 0 }) === "");
}

console.log(`\nR3: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
