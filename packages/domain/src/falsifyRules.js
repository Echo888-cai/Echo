/**
 * falsifyRules — 证伪条件的"文本 → 可执行监控规则"解析与核对（UX-7 闭环的大脑）。
 *
 * 解析原则：**宁可漏，不可错**。只把"明确是股价"的条件解析成规则：
 *   ✓ "股价跌破 90 美元" "跌破 300 港元" "现价低于 85" "跌穿 4.2"
 *   ✓ "股价涨破 150" "升破 700 港元"
 *   ✗ "云增速低于 20%"（百分比量纲）
 *   ✗ "营收跌破 500 亿"（金额量纲，不是股价）
 *   ✗ "用户数低于 1 亿" "毛利率失守 40%"
 * 漏掉的条件仍以原文留在画像里给人看，不丢信息；解析错误则会造成假警报，伤信任。
 */

const CURRENCY = "(?:美元|美金|港元|港币|港紙|元|块|USD|HKD|\\$)";
const NUM = "([0-9]+(?:\\.[0-9]+)?)";
// 动词和数字之间允许的短填充（"跌破本地档案看空线 74.37"），不含数字/百分号/换行
const FILLER = "(?:[^\\d%％\\n]{0,14}?)";
// 数字后面跟这些量纲 → 不是股价
const NON_PRICE_UNIT = /^\s*[%％‰xX]|^\s*(?:亿|万|千万|百万|[MBmb]\b|million|billion|个点|pct|bp|季度|年|次|倍|日均线|日线|周线|月线|均线|个月|天)/;
// 动词前紧邻这些词 → 主语是估值倍数，不是股价（"PE 跌破 13"）
const MULTIPLE_SUBJECT = /(?:P\/?E|P\/?S|P\/?B|EV|市盈率|市销率|市净率|倍数)\s*(?:\(TTM\)|（TTM）)?\s*$/i;
// 句中出现这些词 → 该条件谈的是经营指标/技术位，不是股价证伪线
const NON_PRICE_CONTEXT = /增速|利率|利润率|毛利|净利|营收|收入|市占|份额|用户|订阅|出货|销量|产能|渗透|良率|市值|营业额|现金流|负债|指引中位数|均线/;

const PRICE_CONTEXT = /股价|现价|价格|收盘|股票|看空线|悲观情景价|价位/;

/**
 * 解析单条证伪条件文本。返回 { kind, threshold, label } 或 null。
 */
export function parseFalsifierRule(text) {
  // 去掉 markdown 强调符，避免 "**74.37 HKD**" 断开数字和货币
  const raw = String(text || "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 300) return null;
  if (NON_PRICE_CONTEXT.test(raw)) return null;

  // 跌破类：跌破/跌穿/失守 天然偏向价格；低于 太泛，必须有价格上下文或货币后缀。
  const below = raw.match(new RegExp(`(跌破|跌穿|失守|低于)${FILLER}${NUM}\\s*(${CURRENCY})?`));
  if (below) {
    const after = raw.slice(below.index + below[0].length);
    const before = raw.slice(Math.max(0, below.index - 10), below.index);
    const hasCurrency = Boolean(below[3]);
    const hasPriceCtx = PRICE_CONTEXT.test(raw);
    const generic = below[1] === "低于";
    if (!NON_PRICE_UNIT.test(after) && !MULTIPLE_SUBJECT.test(before) && (hasCurrency || hasPriceCtx || !generic)) {
      return { kind: "price_below", threshold: parseFloat(below[2]), label: raw };
    }
  }

  // 涨破类：涨破/升破/站上 偏向价格；突破/高于 太泛，必须有价格上下文或货币后缀。
  const above = raw.match(new RegExp(`(涨破|升破|站上|突破|高于)${FILLER}${NUM}\\s*(${CURRENCY})?`));
  if (above) {
    const after = raw.slice(above.index + above[0].length);
    const before = raw.slice(Math.max(0, above.index - 10), above.index);
    const hasCurrency = Boolean(above[3]);
    const hasPriceCtx = PRICE_CONTEXT.test(raw);
    const generic = above[1] === "突破" || above[1] === "高于";
    if (!NON_PRICE_UNIT.test(after) && !MULTIPLE_SUBJECT.test(before) && (hasCurrency || hasPriceCtx || !generic)) {
      return { kind: "price_above", threshold: parseFloat(above[2]), label: raw };
    }
  }

  return null;
}

/** 批量解析证伪条件文本，去重（同 kind+threshold 只留一条）。 */
export function parseFalsifierRules(texts = []) {
  const out = [];
  const seen = new Set();
  for (const t of texts) {
    const rule = parseFalsifierRule(t);
    if (!rule || !(rule.threshold > 0)) continue;
    const key = `${rule.kind}:${rule.threshold}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

/**
 * 核对一条规则是否命中。带阈值-现价的合理性护栏：阈值离现价超过 20 倍
 * （或不足 1/20）说明解析出了非股价数字（或股票拆股/换币种），不触发。
 *
 * F-3：只认 price_below/price_above 两种 kind——`watch_rules` 现在也存基本面规则
 * （kind=fundamental_below/above，阈值单位是百分比/金额，不是价格），必须在这里
 * 就地拦截，否则调用方一旦忘记先过滤（真实存在多处消费 listRules() 的地方：
 * watchDesk 卡片监控芯片、组合体检的"最近证伪线"），会把毛利率阈值当股价核对，
 * 拼出一条毫无意义的"距触发 X%"。基本面规则的核对走专门的 evaluateFundamentalRule。
 */
export function evaluateRule(rule, price) {
  if (rule?.kind !== "price_below" && rule?.kind !== "price_above") {
    return { triggered: false, sane: false, distancePct: null };
  }
  if (!(price > 0) || !(rule?.threshold > 0)) return { triggered: false, sane: false, distancePct: null };
  const ratio = rule.threshold / price;
  const sane = ratio <= 20 && ratio >= 0.05;
  const triggered = sane && (rule.kind === "price_below" ? price <= rule.threshold : price >= rule.threshold);
  // 距触发的百分比（正=还有空间，负=已越线）
  const distancePct = rule.kind === "price_below"
    ? ((price - rule.threshold) / price) * 100
    : ((rule.threshold - price) / price) * 100;
  return { triggered, sane, distancePct: Math.round(distancePct * 10) / 10 };
}

// ───────────────────────── F-3：基本面证伪条件（结构化输出，不做事后文本解析） ─────────────────────────
//
// 价格证伪线只兑现了证伪条件的一半——真正的研究员证伪线大多是基本面口径（"毛利率跌破
// 40%"），此前这些只以原文文本存在画像里，从不被巡检核对。文本正则解析基本面条件的
// 误报率不可控（v2 R3/factGuard 的教训是数字模式匹配边界很硬），所以改让模型在研究时
// 直接输出结构化字段（chat 框架的 prompts.js 有对应指令），本模块只做"抽取 + 白名单校验"，
// 不做自由文本 → 结构化的猜测式解析。
//
// 白名单刻意只覆盖能在 financialsData 上独立核对的指标——字段名直接对应
// financialData.js 的输出（不建翻译层，减少一处可能出错的映射）。
export const FUNDAMENTAL_METRICS = ["revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "profitGrowth", "freeCashFlow"];
export const FUNDAMENTAL_METRIC_LABELS = {
  revenueGrowth: "营收增速", grossMargin: "毛利率", operatingMargin: "经营利润率",
  netMargin: "净利率", profitGrowth: "利润增速", freeCashFlow: "自由现金流"
};
const FUNDAMENTAL_OPS = new Set(["below", "above"]);
// 百分比类指标的合理阈值范围（防模型给出离谱数字，如把小数误当百分比：0.4 而非 40）；
// freeCashFlow 是金额，量级天然横跨几个数量级，不做范围校验，只做类型/有限性校验。
const PERCENT_METRICS = new Set(["revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "profitGrowth"]);

// 只锚定前缀，不要求方括号闭合完整——模型偶尔会因为截断/token 限制吐出残缺 JSON，
// 这时更要把这行剥离掉（这行本来就不是给用户看的），而不是因为"格式不完美"就放过它
// 泄露到聊天气泡里。JSON.parse 失败自然会走 catch，rules 诚实为空，不影响主流程。
const FALSIFIERS_LINE_RE = /^FALSIFIERS_JSON:(.*)$/m;

/** 校验单条模型输出的候选规则，任何一项不满足白名单就整条丢弃（不是报错，不是硬凑）。 */
function validateStructuredFalsifier(item) {
  if (!item || typeof item !== "object") return null;
  const { metric, op, threshold, text } = item;
  if (!FUNDAMENTAL_METRICS.includes(metric)) return null;
  if (!FUNDAMENTAL_OPS.has(op)) return null;
  const t = Number(threshold);
  if (!Number.isFinite(t)) return null;
  if (PERCENT_METRICS.has(metric) && Math.abs(t) > 1000) return null; // 离谱百分比，判定为模型输出异常
  const label = String(text || "").replace(/[*_`]/g, "").trim().slice(0, 300);
  if (!label) return null;
  return {
    kind: op === "below" ? "fundamental_below" : "fundamental_above",
    metric,
    threshold: t,
    label
  };
}

/**
 * 从模型回答正文里抽取结构化证伪条件（F-3），并把这一行从正文里剥离——这行是给
 * 系统看的，不是给用户看的散文。找不到标记行、或 JSON 解析失败时，诚实返回空数组，
 * 原文不受影响（不猜、不报错、不阻断主流程）。
 * @returns {{rules: Array<{kind: string, metric: string, threshold: number, label: string}>, cleanContent: string}}
 */
export function extractStructuredFalsifiers(content = "") {
  const text = String(content || "");
  const match = text.match(FALSIFIERS_LINE_RE);
  if (!match) return { rules: [], cleanContent: text };

  const cleanContent = text.replace(FALSIFIERS_LINE_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { rules: [], cleanContent };
  }
  if (!Array.isArray(parsed)) return { rules: [], cleanContent };

  const rules = [];
  const seen = new Set();
  for (const item of parsed.slice(0, 6)) {
    const rule = validateStructuredFalsifier(item);
    if (!rule) continue;
    const key = `${rule.kind}:${rule.metric}:${rule.threshold}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return { rules, cleanContent };
}

/**
 * 核对一条基本面规则是否命中——只在真实拿到该指标的最新值时才评估（找不到该字段就
 * `sane:false`，不猜、不当作"未触发"处理，避免"数据缺失"和"确认安全"被混淆）。
 * @param {{kind: string, metric: string, threshold: number}} rule
 * @param {object|null} financialsData - `getFinancials(ticker)` 的结果
 */
export function evaluateFundamentalRule(rule, financialsData) {
  if (rule?.kind !== "fundamental_below" && rule?.kind !== "fundamental_above") {
    return { triggered: false, sane: false, currentValue: null };
  }
  if (financialsData?.providerStatus !== "ok") return { triggered: false, sane: false, currentValue: null };
  const currentValue = financialsData[rule.metric];
  if (!Number.isFinite(currentValue)) return { triggered: false, sane: false, currentValue: null };
  const triggered = rule.kind === "fundamental_below" ? currentValue <= rule.threshold : currentValue >= rule.threshold;
  return { triggered, sane: true, currentValue };
}
