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
 */
export function evaluateRule(rule, price) {
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
