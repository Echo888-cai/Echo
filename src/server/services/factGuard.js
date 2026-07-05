/**
 * factGuard — R3 数字级防幻觉护栏。
 *
 * 纯函数模块：不碰网络、不碰 DB。两个入口：
 *   - buildFactsRegistry(sources)：把已接地的结构化数据（行情/财报/估值/同业/财报日历/持仓）
 *     按维度（货币金额/百分比/倍数/日期）收成一张"事实登记表"。
 *   - verifyAnswerNumbers(text, registry)：从模型正文里抽数字，逐个去登记表里核对，
 *     给出 pass / soft（未核到，不拦截）/ hard（符号错、数量级错、日期错、币种张冠李戴）。
 *
 * 设计原则（对齐 R3 方案）：
 *   - 事实源优先级 结构化 facts > valuation > earnings > comp peers > web evidence，
 *     体现在 registry 构建顺序里；匹配时不分先后，只看"这个数字是否落在对应维度的
 *     任一事实容差范围内"，避免模型"各取一半编第三个数"蒙混过关。
 *   - 宁可漏报不可误报：默认判 soft 而不是 hard；只有符号相反、数量级相差 ≥10 倍、
 *     显式日期找不到、换算后仍对不上的币种标注，才升级成 hard。
 *   - 不做语义槽位校验：只核"这个数字是否真实存在"，不核"标签配对是否正确"（比如
 *     看空的数字被错标成看多，数值本身仍会 pass）——这是记录在案的已知边界。
 */

// 与 dataSources.js / portfolioReview.js 同一套展示级近似汇率，不新造汇率。
const FX_TO_HKD = { HKD: 1, CNY: 1.08, USD: 7.8 };
const CN_UNIT = { "万亿": 1e12, "亿": 1e8, "万": 1e4 };
const CURRENCY_ALIAS = {
  "港元": "HKD", "港币": "HKD", "HK$": "HKD", HKD: "HKD",
  "美元": "USD", "US$": "USD", "$": "USD", USD: "USD",
  "人民币": "CNY", RMB: "CNY", "¥": "CNY", CNY: "CNY"
};
const AMOUNT_KEYWORDS = [
  "现价", "收盘价", "目标价", "看空", "中性", "看多", "市值", "收入", "营收", "净利", "毛利",
  "经营利润", "现金流", "EPS", "每股", "回购", "分红", "净现金", "净债务", "成本", "止损", "止盈"
];

function numOrNull(value) {
  if (value === null || value === undefined) return null; // Number(null)===0 陷阱，见 G-3
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "3.92 万亿" / "2099.21 亿" 这类 compactNumber() 输出反解析成原始数值。 */
export function parseCompactAmount(str) {
  if (typeof str === "number") return Number.isFinite(str) ? str : null;
  const s = String(str || "").trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(万亿|亿|万)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] ? n * CN_UNIT[m[2]] : n;
}

/** 展示级近似汇率换算（跟 CNY_TO_HKD=1.08、HKD/USD≈1/7.8 同一套常量）。 */
export function convertCurrency(value, from, to) {
  const f = FX_TO_HKD[String(from || "").toUpperCase()];
  const t = FX_TO_HKD[String(to || "").toUpperCase()];
  if (!f || !t) return null;
  return (value * f) / t;
}

function resolveCurrency(token) {
  if (!token) return null;
  return CURRENCY_ALIAS[token] || CURRENCY_ALIAS[token.toUpperCase()] || null;
}

// ───────────────────────── registry ─────────────────────────

function pushAmount(registry, value, currency, label, source) {
  const v = numOrNull(value);
  if (v === null) return;
  const cur = String(currency || registry.nativeCurrency || "UNKNOWN").toUpperCase();
  if (!registry.amounts[cur]) registry.amounts[cur] = [];
  registry.amounts[cur].push({ value: v, label, source });
}
function pushPercent(registry, value, label, source) {
  const v = numOrNull(value);
  if (v === null) return;
  registry.percents.push({ value: v, label, source });
}
function pushMultiple(registry, value, label, source) {
  const v = numOrNull(value);
  if (v === null) return;
  registry.multiples.push({ value: v, label, source });
}
function pushDate(registry, isoLike, label, source) {
  const s = String(isoLike || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  registry.dates.push({ iso: `${m[1]}-${m[2]}-${m[3]}`, year, month, day, quarter: Math.ceil(month / 3), label, source });
}
function pushYoyPercent(registry, cur, prior, label, source) {
  const c = numOrNull(cur), p = numOrNull(prior);
  if (c === null || !p) return;
  pushPercent(registry, ((c - p) / Math.abs(p)) * 100, label, source);
}

/**
 * 把已接地的结构化数据收成一张按维度分桶的事实登记表。
 * @param {{ticker?: string, nativeCurrency?: string, marketSnapshot?: object, financialsData?: object,
 *   valuation?: object, compPeers?: object, earnings?: object, position?: object}} sources
 */
export function buildFactsRegistry(sources = {}) {
  const { ticker, marketSnapshot, financialsData, valuation, earnings, position } = sources;
  const compPeers = valuation?.compPeers || sources.compPeers;
  const nativeCurrency = String(
    sources.nativeCurrency || marketSnapshot?.currency || financialsData?.currency || "HKD"
  ).toUpperCase();
  const registry = { ticker: ticker || "", nativeCurrency, amounts: {}, percents: [], multiples: [], dates: [] };

  // 结构化事实：优先级最高。
  if (marketSnapshot?.providerStatus === "ok") {
    pushAmount(registry, marketSnapshot.price, marketSnapshot.currency, "现价", "marketSnapshot");
    pushPercent(registry, marketSnapshot.changePercent, "今日涨跌幅", "marketSnapshot");
    pushMultiple(registry, marketSnapshot.pe, "PE", "marketSnapshot");
    pushPercent(registry, marketSnapshot.dividendYield, "股息率", "marketSnapshot");
    const mc = parseCompactAmount(marketSnapshot.marketCap);
    if (mc !== null) pushAmount(registry, mc, marketSnapshot.currency, "市值", "marketSnapshot");
    const ranges = marketSnapshot.ranges;
    if (ranges?.providerStatus === "ok") {
      pushPercent(registry, ranges.oneMonthPct, "近1月回报", "marketSnapshot.ranges");
      pushPercent(registry, ranges.ytdPct, "年初至今回报", "marketSnapshot.ranges");
    }
  }

  const fin = financialsData;
  if (fin?.providerStatus === "ok") {
    const cur = fin.currency || nativeCurrency;
    pushAmount(registry, fin.revenue, cur, "收入", "financialsData");
    pushAmount(registry, fin.grossProfit, cur, "毛利", "financialsData");
    pushAmount(registry, fin.operatingIncome, cur, "经营利润", "financialsData");
    pushAmount(registry, fin.netIncome, cur, "净利润", "financialsData");
    pushAmount(registry, fin.freeCashFlow, cur, "自由现金流", "financialsData");
    pushAmount(registry, fin.operatingCashFlow, cur, "经营现金流", "financialsData");
    pushAmount(registry, fin.cashAndEquivalents, cur, "现金及等价物", "financialsData");
    pushAmount(registry, fin.netDebt, cur, "净债务", "financialsData");
    pushAmount(registry, fin.dividendPaid, cur, "分红", "financialsData");
    pushAmount(registry, fin.repurchaseOfStock, cur, "回购金额", "financialsData");
    pushAmount(registry, fin.eps, cur, "EPS", "financialsData");
    pushPercent(registry, fin.revenueGrowth, "收入增速", "financialsData");
    pushPercent(registry, fin.grossMargin, "毛利率", "financialsData");
    pushPercent(registry, fin.operatingMargin, "经营利润率", "financialsData");
    pushPercent(registry, fin.netMargin, "净利率", "financialsData");
    pushPercent(registry, fin.profitGrowth, "利润增速", "financialsData");
    pushPercent(registry, fin.returnOnEquity, "ROE", "financialsData");
    pushPercent(registry, fin.returnOnAssets, "ROA", "financialsData");
    pushMultiple(registry, fin.pe, "PE", "financialsData");
    pushMultiple(registry, fin.forwardPE, "Forward PE", "financialsData");
    pushMultiple(registry, fin.pb, "PB", "financialsData");
    pushDate(registry, fin.period, "财报期", "financialsData.period");

    for (const row of Array.isArray(fin.hkFilings) ? fin.hkFilings : []) {
      const rc = row.currency || cur;
      pushAmount(registry, row.revenue, rc, "收入（一手）", "hkFilings");
      pushAmount(registry, row.gross_profit, rc, "毛利（一手）", "hkFilings");
      pushAmount(registry, row.operating_income, rc, "经营盈利（一手）", "hkFilings");
      pushAmount(registry, row.net_income, rc, "净利（一手）", "hkFilings");
      pushAmount(registry, row.operating_cash_flow, rc, "经营现金流（一手）", "hkFilings");
      pushAmount(registry, row.net_cash, rc, "净现金（一手）", "hkFilings");
      pushAmount(registry, row.eps, rc, "EPS（一手）", "hkFilings");
      pushYoyPercent(registry, row.revenue, row.revenue_prior, "收入同比（一手）", "hkFilings");
      pushYoyPercent(registry, row.net_income, row.net_income_prior, "净利同比（一手）", "hkFilings");
      pushYoyPercent(registry, row.operating_income, row.operating_income_prior, "经营利润同比（一手）", "hkFilings");
      pushDate(registry, row.period_end, "一手财报期末", "hkFilings");
      pushDate(registry, row.published_at, "一手公告发布", "hkFilings");
    }
  }

  // 估值输出：次优先级——我们自己的确定性计算，同样可信，但排在原始事实之后。
  if (valuation && !valuation.cannotValueReason) {
    pushAmount(registry, valuation.bear, nativeCurrency, "估值看空", "valuation");
    pushAmount(registry, valuation.base, nativeCurrency, "估值中性", "valuation");
    pushAmount(registry, valuation.bull, nativeCurrency, "估值看多", "valuation");
    pushAmount(registry, valuation.currentPrice, nativeCurrency, "现价", "valuation");
    // 赔率（如 1.3:1）刻意不进 multiples 桶：它跟 PE/EV-Sales 是完全不同尺度的比值（通常
    // 0~5 之间），混进同一个桶会让"5倍"这类小倍数候选把赔率当"最接近的事实"算数量级——
    // 影子模式真实实测抓到过这个误报（AAPL："5倍" vs 赔率 0.20 被判数量级差 25 倍）。
    for (const m of Array.isArray(valuation.methodDetail) ? valuation.methodDetail : []) {
      pushAmount(registry, m.bear, nativeCurrency, `${m.name} 看空`, "valuation.methodDetail");
      pushAmount(registry, m.base, nativeCurrency, `${m.name} 中性`, "valuation.methodDetail");
      pushAmount(registry, m.bull, nativeCurrency, `${m.name} 看多`, "valuation.methodDetail");
    }
    if (valuation.analyst?.target != null) {
      pushAmount(registry, valuation.analyst.target, nativeCurrency, "分析师目标价", "valuation.analyst");
      pushAmount(registry, valuation.analyst.low, nativeCurrency, "分析师目标价下限", "valuation.analyst");
      pushAmount(registry, valuation.analyst.high, nativeCurrency, "分析师目标价上限", "valuation.analyst");
    }
  }

  // 财报日历（G-2）。
  if (earnings?.providerStatus === "ok" && earnings.nextDate) {
    pushDate(registry, earnings.nextDate, "下一业绩日", "earnings");
  }

  // 同业可比（G-3）：优先级最低的结构化源。
  if (compPeers?.providerStatus === "ok") {
    for (const peer of Array.isArray(compPeers.peers) ? compPeers.peers : []) {
      if (peer.multiple != null) pushMultiple(registry, peer.multiple, `${peer.ticker} ${peer.multipleType || ""}`.trim(), "compPeers");
    }
    if (compPeers.anchor) {
      pushMultiple(registry, compPeers.anchor.p25, "同业锚点 p25", "compPeers.anchor");
      pushMultiple(registry, compPeers.anchor.median, "同业锚点中位", "compPeers.anchor");
      pushMultiple(registry, compPeers.anchor.p75, "同业锚点 p75", "compPeers.anchor");
    }
  }

  // 持仓盈亏：用真实持仓记录（DB）+ 现价现算，不用自由文本 userContext（那是用户自己说的）。
  if (position && position.avgCost != null && marketSnapshot?.providerStatus === "ok" && marketSnapshot.price != null) {
    const price = numOrNull(marketSnapshot.price);
    const cost = numOrNull(position.avgCost);
    if (price !== null && cost) pushPercent(registry, ((price - cost) / cost) * 100, "持仓浮动盈亏", "position");
    pushAmount(registry, position.avgCost, nativeCurrency, "持仓成本", "position");
    if (position.stopLoss != null) pushAmount(registry, position.stopLoss, nativeCurrency, "止损线", "position");
    if (position.takeProfit != null) pushAmount(registry, position.takeProfit, nativeCurrency, "止盈线", "position");
  }

  return registry;
}

// ───────────────────────── extraction ─────────────────────────

/**
 * 从正文抽取候选数字。分优先级跑正则、用字符区间去重（防止 "15.75x" 里的 "15.75"
 * 被裸数字规则再抓一次）。故意不处理"来源："之后的引用列表和"北京时间 …"时间戳——
 * 那些是程序拼接/引用来源，不是模型给出的待核实断言（时间戳真实触发过一次误报，
 * 已通过真实回答实测发现，见 verifyAnswerNumbers 的裁剪逻辑）。
 */
function extractNumbers(text) {
  const consumed = [];
  const isFree = (start, end) => !consumed.some(([s, e]) => start < e && end > s);
  const claim = (start, end) => consumed.push([start, end]);
  const candidates = [];

  // 负号前用 (?<![\d.]) 卡住："220-250 美元"这类区间写法里的连字符不是负号——不加这个
  // 判断会把 "-250" 当成负数抓出来，跟正数事实符号相反直接误判 hard（真实实测抓到过）。
  for (const m of text.matchAll(/(?<![\d.])([-+]?\d+(?:\.\d+)?)\s*%/g)) {
    let value = Number(m[1]);
    // 中文财经写作常用"下滑/下降 10.9%"表达降幅，不写负号（真实实测抓到：小米"收入同比
    // 下滑10.9%"被当成正数跟事实里的 -10.9 符号相反误判 hard）。数字本身没带正负号时，
    // 看紧邻前面的词是不是"降/减/跌/滑/收窄/放缓"这类，是就按语义当负数处理。
    if (!/^[-+]/.test(m[1])) {
      const before = text.slice(Math.max(0, m.index - 6), m.index);
      if (/(下滑|下降|下跌|减少|降低|收窄|走低|回落|放缓|亏损扩大|转负|缩水|萎缩)$/.test(before)) value = -Math.abs(value);
    }
    candidates.push({ dimension: "percent", value, raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*[xX倍]/g)) {
    if (!isFree(m.index, m.index + m[0].length)) continue;
    candidates.push({ dimension: "multiple", value: Number(m[1]), raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    candidates.push({ dimension: "date", year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), precision: "day", raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    if (!isFree(m.index, m.index + m[0].length)) continue;
    candidates.push({ dimension: "date", year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), precision: "day", raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(/(\d{4})\s*年?\s*(?:Q([1-4])|第([一二三四])季度)/g)) {
    if (!isFree(m.index, m.index + m[0].length)) continue;
    const quarter = m[2] ? Number(m[2]) : "一二三四".indexOf(m[3]) + 1;
    candidates.push({ dimension: "date", year: Number(m[1]), quarter, precision: "quarter", raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(/(?<![\d.])(-?\d+(?:\.\d+)?)\s*(万亿|亿|万)(港元|美元|人民币|HKD|USD|CNY|元)?/g)) {
    if (!isFree(m.index, m.index + m[0].length)) continue;
    // "3451万股"是股数不是金额——真实回答实测抓到过（腾讯回购新闻"连续32日回购，累计
    // 回购3451.51万股"），不排除会把股数当成金额去跟估值/收入比对，数量级差几十万倍
    // 全部误判成 hard。紧跟"股/份额"就跳过，不当金额候选。
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^(股|份)/.test(after)) { claim(m.index, m.index + m[0].length); continue; }
    const value = Number(m[1]) * CN_UNIT[m[2]];
    candidates.push({ dimension: "amount", value, currency: resolveCurrency(m[3]), raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  // 裸数字（无单位）：必须有相邻货币标签或财务关键词窗口命中才算候选，否则大量误报
  // （"3 家同业""T-5""第 1 条"这类非财务数字）。
  for (const m of text.matchAll(/(?<![\d.])(-?\d+(?:\.\d+)?)/g)) {
    if (!isFree(m.index, m.index + m[0].length)) continue;
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
    const tagMatch = (before + after).match(/(港元|美元|人民币|HKD|USD|CNY|HK\$|US\$|\$|¥)/);
    const currency = tagMatch ? resolveCurrency(tagMatch[1]) : null;
    const hasKeyword = AMOUNT_KEYWORDS.some((k) => before.includes(k));
    if (!tagMatch && !hasKeyword) continue;
    candidates.push({ dimension: "amount", value: Number(m[1]), currency, raw: m[0], index: m.index });
    claim(m.index, m.index + m[0].length);
  }
  return candidates.sort((a, b) => a.index - b.index);
}

// ───────────────────────── matching ─────────────────────────

/**
 * 在同维度桶里找容差内的事实；返回 pass（命中）/ hard（符号相反或数量级相差过大）/
 * soft（未核到）。两处真实影子模式实测抓到的回归都已经修：
 *
 * 1）"最接近的事实"不能用绝对差选——金额桶经常同时有 551.94（估值）和 2100亿（收入）
 *    这种跨数量级的事实，绝对差会永远选中数值更小的那个当"最近"（"10亿"离 551.94 的
 *    绝对差远小于离 2100亿 的绝对差，尽管数量级上明显更接近收入），把候选数字硬凑给一个
 *    完全不相关的事实。改用比值的对数距离选"量级上最接近"的事实。
 * 2）符号翻转只在数量级也大致相当（1/3~3 倍内）时才判定为"很可能在说同一件事、符号
 *    错了"（AAPL 实测：模型说"+0.4%"，桶里唯一的百分比事实是"近1月回报 -2.1%"，两者
 *    量级差 5 倍，是完全不同的指标凑巧符号相反，不该扣符号错误）。
 *
 * 数量级 hard-fail 的倍数阈值可调：货币金额天然跨越 EPS（个位数）到收入（千亿级）好几个
 * 数量级，即使"最接近"的事实也可能只是"我们没有这个数据"而不是"这个数字错了"，阈值定
 * 得比百分比/倍数（10x，覆盖真实的万/亿单位混淆）宽得多（1000x），避免把"未核到的其它
 * 金额"错判成"数量级错误"。
 */
function matchInBucket(value, bucket, { relTol, absTol, magnitudeThreshold = 10 }) {
  if (!bucket.length) return { verdict: "soft", fact: null };
  for (const fact of bucket) {
    const diff = Math.abs(value - fact.value);
    const tol = Math.max(absTol, Math.abs(fact.value) * relTol);
    if (diff <= tol) return { verdict: "pass", fact };
  }
  // 候选值为 0 时比值/对数距离都没有意义（真实实测抓到过：value=0 时 log10(0/x)=-Infinity，
  // 落到"没有 best 就随手挑 bucket[0]"的兜底，吐出一句"数量级相差 Infinity 倍"的荒谬提示）。
  // 0 本身也几乎不构成"错误数字"（比如"零负债"是合法陈述），一律按未核到处理，不硬扣。
  if (value === 0) return { verdict: "soft", fact: null };
  let best = null, bestLogDist = Infinity;
  for (const fact of bucket) {
    if (fact.value === 0) continue;
    const logDist = Math.abs(Math.log10(Math.abs(value) / Math.abs(fact.value)));
    if (logDist < bestLogDist) { bestLogDist = logDist; best = fact; }
  }
  if (!best) return { verdict: "soft", fact: null };
  const magRatio = best.value !== 0 ? Math.abs(value) / Math.abs(best.value) : Infinity;
  const sameBallpark = magRatio >= 1 / 3 && magRatio <= 3;
  if (sameBallpark && Math.sign(value) !== 0 && Math.sign(best.value) !== 0 && Math.sign(value) !== Math.sign(best.value)) {
    return { verdict: "hard", fact: best, reason: `符号相反（最接近的事实是"${best.label}"=${best.value}）` };
  }
  if (best.value !== 0 && (magRatio >= magnitudeThreshold || magRatio <= 1 / magnitudeThreshold)) {
    return { verdict: "hard", fact: best, reason: `数量级相差 ${magRatio >= magnitudeThreshold ? magRatio.toFixed(0) : (1 / magRatio).toFixed(0)} 倍以上（最接近的事实是"${best.label}"=${best.value}）` };
  }
  return { verdict: "soft", fact: best };
}

const PERCENT_TOL = { relTol: 0, absTol: 0.3 };
// 影子模式真实实测抓到：AAPL"同业对比"回答里的"0.8倍"（很可能是某同业的 PEG/P-S 之类
// 我们没接的倍数口径）离唯一的 Forward PE=31.1x 差 39 倍，被 10x 阈值误判 hard——多倍数
// 口径（PE/PEG/EV-Sales/P-B）天然跨度比单一 PE 更宽，阈值放宽到 30x，兼顾"万一真是同一
// 口径写错了 10 倍"这种更明确的错误。
const MULTIPLE_TOL = { relTol: 0.05, absTol: 0.3, magnitudeThreshold: 30 };
// 金额数量级阈值放宽到 1000x：EPS（个位数）到收入（千亿级）天然跨好几个数量级，
// "最接近"的事实经常只是"没有这项数据"而不是"这个数字错了"；1000x 仍然稳稳盖住真实的
// 万/亿/万亿单位混淆（每级至少 10000x），不会因此漏放真正的单位错误。
const AMOUNT_TOL = { relTol: 0.02, absTol: 0, magnitudeThreshold: 1000 };
const AMOUNT_TOL_CROSS = { relTol: 0.08, absTol: 0, magnitudeThreshold: 1000 };

function matchAmount(candidate, registry) {
  const stated = candidate.currency;
  const currency = stated || registry.nativeCurrency;
  const isNative = currency === registry.nativeCurrency;
  const directBucket = registry.amounts[currency] || [];
  const direct = matchInBucket(candidate.value, directBucket, AMOUNT_TOL);
  if (direct.verdict === "pass") return { ...direct, currency };
  // 本币桶通常覆盖各种量级（现价/EPS/收入……），数量级判定可信；非本币桶常常只有零星
  // 几个跟候选数字量级完全不同的事实（比如整张收入表都在 CNY 桶，一个 EPS 级别的小数字
  // 混进来对比"最近的"会是几十亿的收入，被错判"数量级差10倍"）——非本币的 hard 不采信，
  // 降级去走下面的换算/币种标签路径。
  if (direct.verdict === "hard" && isNative) return { ...direct, currency };
  if (stated && stated !== registry.nativeCurrency) {
    const nativeBucket = registry.amounts[registry.nativeCurrency] || [];
    const converted = convertCurrency(candidate.value, stated, registry.nativeCurrency);
    if (converted !== null) {
      const cross = matchInBucket(converted, nativeBucket, AMOUNT_TOL_CROSS);
      if (cross.verdict === "pass") return { ...cross, currency };
      // 换算后仍对不上：再看原始数值是否精确撞上本币事实——像是"数字对、币种标签错"。
      const mislabel = matchInBucket(candidate.value, nativeBucket, AMOUNT_TOL);
      if (mislabel.verdict === "pass") {
        return {
          verdict: "hard", currency, fact: mislabel.fact,
          reason: `疑似币种标注错误：数值与 ${registry.nativeCurrency} 口径的"${mislabel.fact.label}"（${mislabel.fact.value}）吻合，但标注成了 ${stated}`
        };
      }
      if (cross.verdict === "hard") return { ...cross, currency };
    }
    return { verdict: "soft", fact: direct.fact, currency };
  }
  return { ...direct, currency };
}

function matchDate(candidate, registry) {
  if (candidate.precision === "day") {
    const days = (a, b) => Math.abs(Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86400000;
    const exact = registry.dates.find((f) => days(candidate, f) <= 1);
    if (exact) return { verdict: "pass", fact: exact };
    const quarter = Math.ceil(candidate.month / 3);
    const sameQuarter = registry.dates.find((f) => f.year === candidate.year && f.quarter === quarter);
    if (sameQuarter) return { verdict: "soft", fact: sameQuarter, reason: "季度对得上但具体日期不一致" };
    return { verdict: "hard", fact: null, reason: "给出的具体日期在已核数据里找不到对应记录" };
  }
  const hit = registry.dates.find((f) => f.year === candidate.year && (candidate.quarter == null || f.quarter === candidate.quarter));
  return hit ? { verdict: "pass", fact: hit } : { verdict: "soft", fact: null };
}

/**
 * 校验正文里的数字。只检查"来源："之前的正文（引用列表是程序拼接的真实链接，不是模型
 * 断言），并跳过紧跟在"北京时间"后面的时间戳（那是每条回答固定的生成时刻，不是待核实
 * 的财务日期——真实回答实测过，不跳过会把这一条 100% 命中"日期找不到"误判成 HARD_FAIL）。
 * @returns {{checked: Array, softCount: number, hardCount: number, hasHardFail: boolean}}
 */
export function verifyAnswerNumbers(text, registry) {
  const raw = String(text || "");
  const [body] = raw.split(/\n\n?来源[:：]/);
  const scanText = body || raw;

  const candidates = extractNumbers(scanText).filter((c) => {
    if (c.dimension !== "date") return true;
    const before = scanText.slice(Math.max(0, c.index - 6), c.index);
    return !/北京时间\s*$/.test(before);
  });

  const checked = candidates.map((c) => {
    let result;
    if (c.dimension === "percent") result = matchInBucket(c.value, registry.percents, PERCENT_TOL);
    else if (c.dimension === "multiple") result = matchInBucket(c.value, registry.multiples, MULTIPLE_TOL);
    else if (c.dimension === "amount") result = matchAmount(c, registry);
    else result = matchDate(c, registry);
    return { ...c, verdict: result.verdict, matchedFact: result.fact || null, reason: result.reason || null };
  });

  const softCount = checked.filter((c) => c.verdict === "soft").length;
  const hardCount = checked.filter((c) => c.verdict === "hard").length;
  return { checked, softCount, hardCount, hasHardFail: hardCount > 0 };
}

/** SOFT_FLAG 提示文案（低调、不拦截）——soft/full 模式追加在正文末尾。 */
export function buildSoftNote(verdict) {
  if (!verdict || (!verdict.softCount && !verdict.hardCount)) return "";
  const parts = [];
  if (verdict.softCount) parts.push(`${verdict.softCount} 处数字未能与已核实数据直接核对`);
  if (verdict.hardCount) parts.push(`${verdict.hardCount} 处存在明显不一致（符号/数量级/日期）`);
  return `\n\n> 提示：${parts.join("，")}。判断依据请以事实块和来源链接为准。`;
}

/** 影子模式/日志用的精简摘要（不含正文，方便打印/落库）。 */
export function summarizeVerdict(verdict) {
  if (!verdict) return null;
  return {
    total: verdict.checked.length,
    pass: verdict.checked.filter((c) => c.verdict === "pass").length,
    soft: verdict.softCount,
    hard: verdict.hardCount,
    hardDetails: verdict.checked
      .filter((c) => c.verdict === "hard")
      .map((c) => ({ raw: c.raw, dimension: c.dimension, reason: c.reason }))
  };
}

/** 定向重答用：把命中的 hard-fail 数字整理成可读的问题清单（纯格式化，不调用模型）。 */
export function renderHardFailIssues(verdict) {
  return verdict.checked
    .filter((c) => c.verdict === "hard")
    .map((c) => `- "${c.raw}"：${c.reason || "与已核实数据不一致"}${c.matchedFact ? `（可能应为"${c.matchedFact.label}"=${c.matchedFact.value}）` : ""}`)
    .join("\n");
}
