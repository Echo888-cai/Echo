/**
 * Parse a user question into a uniform `userContext` object.
 *
 * Goal: whether the user typed "成本价 4.9，持有 3000 股", "cost 4.9 shares 3000",
 * or just "看看腾讯", the system can answer "已识别 / 未识别" with a single shape:
 *   { cost, shares, horizon, note }
 *
 * Inputs are loosely written Chinese / mixed CN-EN. We prefer false negatives over
 * false positives — if we are not sure a number refers to cost/shares, we drop it
 * and let the caller add a `missingReason` instead of guessing wrong.
 *
 * This module is pure: it only operates on strings. It does not touch the
 * memory store; `applyUserContextToMemory` is the one place that mutates state.
 */

const COST_PATTERNS = [
  /(?:成本价|成本|cost|买入价|购入价|入仓价)[^\d]{0,8}(\d+(?:\.\d+)?)/i,
  /(\d+(?:\.\d+)?)\s*(?:港币|元|hkd|hk\$)?\s*(?:成本|买入|入仓|购入)/i
];

const SHARES_PATTERNS = [
  // "持有/买了 3000 股" — Chinese verb + number + 万? + 股
  /(?:持有|持仓|买入|入手|买|入仓|购入)[^\d]{0,6}(\d[\d,]*)\s*股/i,
  // "2万股" / "1.5万股" — captures the whole 2万 / 1.5万
  /(\d+(?:\.\d+)?\s*万)\s*股/i,
  // "5000 shares" — must NOT be the tail of a decimal like "4.9 shares"
  /(?<![.\d])(\d[\d,]*)\s*(?:shares|share)\b/i,
  // bare "3000 股" without prefix — must NOT be tail of a decimal
  /(?<![.\d])(\d[\d,]*)\s*股/i
];

/** Convert a raw captured string (e.g. "2万", "3000", "1.5") into a normalized number-as-string. */
function normalizeShares(raw) {
  const cleaned = String(raw || "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  // 万 multiplier form: e.g. "2万" → 20000, "1.5万" → 15000
  const wanMatch = cleaned.match(/^(\d+(?:\.\d+)?)万$/);
  if (wanMatch) {
    const n = Number(wanMatch[1]) * 10000;
    return Number.isFinite(n) ? String(Math.round(n)) : null;
  }
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

const HORIZON_KEYWORDS = [
  { pattern: /(长期|长期持有|3-5年|三到五年|三至五年|五到十年|5-10年|十年|5y|10y)/i, value: "长期（≥3 年）" },
  { pattern: /(三年|3年|3-year)/i, value: "3 年" },
  { pattern: /(五年|5年|5-year)/i, value: "5 年" },
  { pattern: /(短期|短线|一周|两周|几周|几月|几个月|数月|1年|一年|1-year)/i, value: "短期（≤1 年）" },
  { pattern: /(波段|中期|半年|6个月|6-12个月)/i, value: "中期（约 6-12 个月）" }
];

const PURPOSE_KEYWORDS = [
  { pattern: /(分批|加仓|补仓|止错|止损|仓位管理|配置)/i, note: "用户关注分批与仓位管理" },
  { pattern: /(回撤|抗跌|防御|保守|稳健)/i, note: "用户关注回撤与防御" },
  { pattern: /(分红|股息|派息)/i, note: "用户关注分红/股息" }
];

/** Return numeric-or-null. Comma-separated digits are accepted: "3,000" → 3000. */
function parseNumeric(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/,/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Parse the question text and produce a userContext.
 * Even if the result is empty (all null), callers should rely on the shape
 * `{ cost, shares, horizon, note }` so UI panels can render a uniform "未识别" state.
 */
export function parseUserContext(question = "") {
  const text = String(question || "");
  const result = { cost: null, shares: null, horizon: null, note: "" };

  for (const pat of COST_PATTERNS) {
    const match = text.match(pat);
    if (match) {
      const value = parseNumeric(match[1]);
      if (value) {
        result.cost = value;
        break;
      }
    }
  }

  for (const pat of SHARES_PATTERNS) {
    const match = text.match(pat);
    if (match) {
      const value = normalizeShares(match[1]);
      if (value && Number(value) > 0) {
        result.shares = value;
        break;
      }
    }
  }

  for (const { pattern, value } of HORIZON_KEYWORDS) {
    if (pattern.test(text)) {
      result.horizon = value;
      break;
    }
  }

  const notes = [];
  for (const { pattern, note } of PURPOSE_KEYWORDS) {
    if (pattern.test(text)) notes.push(note);
  }
  result.note = notes.join("；");

  return result;
}

/** Returns true if the user supplied at least one of cost/shares/horizon. */
export function hasUserContext(ctx) {
  if (!ctx) return false;
  return Boolean(ctx.cost || ctx.shares || ctx.horizon);
}

/** Returns the set of fields that are still missing (used to surface in panel.missingData). */
export function missingContextFields(ctx) {
  if (!ctx) return ["成本价", "持股数", "投资周期"];
  const missing = [];
  if (!ctx.cost) missing.push("成本价");
  if (!ctx.shares) missing.push("持股数");
  if (!ctx.horizon) missing.push("投资周期");
  return missing;
}

/**
 * Apply parsed context to a memory.positions[ticker] entry. Returns a new
 * memory object; never mutates the input.
 */
export function applyUserContextToMemory(memory, ticker, ctx) {
  if (!memory || !ticker) return memory;
  const positions = { ...(memory.positions || {}) };
  const existing = positions[ticker] || { ticker, name: "", cost: "", shares: "" };
  const next = { ...existing, ticker };
  if (ctx.cost) next.cost = ctx.cost;
  if (ctx.shares) next.shares = ctx.shares;
  next.updatedAt = new Date().toISOString();
  positions[ticker] = next;
  return { ...memory, positions };
}
