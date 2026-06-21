/**
 * companyPortrait — 把单次研究升级成可持续维护的长期画像。
 *
 * 两个方向：
 * 1. loadPortraitContext(ticker)：把已有画像格式化成模型上下文，研究同一公司时
 *    自动带上"上次的投资主线、证伪条件、置信度"，保持判断连贯。
 * 2. updatePortraitFromPanel(...)：一轮研究后，从 decisionPanel + 公司档案
 *    蒸馏出"当前 view"并回写；投资主线/状态/置信度变化时追加一条事件日志。
 */

import { getCompanyProfile, upsertCompanyProfile } from "../repositories/companyProfiles.js";
import { companyByTicker } from "../../data.js";
import { beijingDate } from "../utils/time.js";

function asList(value, limit = 6) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || "").trim()).filter(Boolean).slice(0, limit);
}

/** 把已有画像渲染成注入提示词的简短上下文；无画像返回空串。 */
export function loadPortraitContext(ticker) {
  const profile = getCompanyProfile(ticker);
  if (!profile || (!profile.thesis && !profile.events.length)) return "";
  const lines = [`## 已有长期画像（上次研究沉淀，本轮请保持判断连贯，若有变化要说明并更新）`];
  if (profile.thesis) lines.push(`- 投资主线：${profile.thesis}`);
  if (profile.researchStatus || profile.confidence) {
    lines.push(`- 上次研究状态：${profile.researchStatus || "—"}，置信度：${profile.confidence || "—"}`);
  }
  if (profile.bull.length) lines.push(`- Bull：${profile.bull.join("；")}`);
  if (profile.bear.length) lines.push(`- Bear：${profile.bear.join("；")}`);
  if (profile.monitors.length) lines.push(`- 关键观察变量：${profile.monitors.join("、")}`);
  if (profile.falsifiers.length) lines.push(`- 证伪条件：${profile.falsifiers.join("；")}`);
  const recent = profile.events.slice(-3).reverse();
  if (recent.length) lines.push(`- 最近变更：${recent.map((e) => `${e.date} ${e.summary}`).join("；")}`);
  return lines.join("\n");
}

/** 从 decisionPanel + 本地公司档案蒸馏画像的"当前 view"字段。 */
function distillView(panel = {}, profile = {}, valuation = null) {
  const driverSummary = (name) => {
    const d = (panel.keyDrivers || []).find((x) => x.name === name);
    const s = String(d?.summary || "").trim();
    return s && !/暂不评分|未接入|缺失/.test(s) ? s : "";
  };
  // 证伪条件：优先用面板的 riskTriggers，回落到公司档案 bear。
  const falsifiers = asList(
    (Array.isArray(panel.riskTriggers) && panel.riskTriggers.length
      ? panel.riskTriggers.map((t) => (typeof t === "string" ? t : t.label))
      : profile.bear),
    6
  );
  return {
    companyName: panel.companyName || profile.nameZh || panel.ticker,
    thesis: String(panel.oneLineView || driverSummary("基本面") || profile.summary?.[0] || "").trim(),
    researchStatus: panel.researchStatus || "",
    confidence: panel.confidence || "",
    bull: asList(profile.bull),
    bear: asList(profile.bear),
    monitors: asList(profile.monitors?.length ? profile.monitors : ["收入增速", "利润率", "自由现金流", "回购/分红", "竞争与监管"]),
    falsifiers,
    valuation: valuation && !valuation.cannotValueReason
      ? { method: valuation.method, bear: valuation.bear, base: valuation.base, bull: valuation.bull, currentPrice: valuation.currentPrice }
      : null
  };
}

/** 判断投资主线/状态/置信度是否相对上次发生了实质变化。 */
function judgmentChanged(prev, next) {
  if (!prev) return false; // 首次建档不算"变更"
  const norm = (s) => String(s || "").replace(/\s+/g, "").trim();
  return (
    norm(prev.researchStatus) !== norm(next.researchStatus) ||
    norm(prev.confidence) !== norm(next.confidence) ||
    (norm(prev.thesis) && norm(prev.thesis) !== norm(next.thesis))
  );
}

/**
 * 一轮研究后回写画像。返回 { created, changed, profile }。
 * - 首次研究该公司 → 建档（不写"变更"事件，写一条"建档"事件）。
 * - 已有画像且判断变化 → 改正文 + 追加一条变更事件。
 * - 已有画像但判断未变 → 只 bump turn_count，不写流水账。
 */
export function updatePortraitFromPanel({ ticker, panel, valuation = null, question = "" } = {}) {
  if (!ticker || !panel) return { created: false, changed: false, profile: null };
  const localProfile = companyByTicker(ticker) || {};
  const prev = getCompanyProfile(ticker);
  const view = distillView(panel, localProfile, valuation);
  if (!view.thesis && !view.bull.length && !view.bear.length) {
    return { created: false, changed: false, profile: prev };
  }

  const isNew = !prev;
  const changed = judgmentChanged(prev, view);
  const date = beijingDate();
  let event = null;
  if (isNew) {
    event = { date, kind: "created", summary: `建立画像：${view.thesis || view.researchStatus || "首次研究"}` };
  } else if (changed) {
    const fromTo = [];
    if (prev.researchStatus && prev.researchStatus !== view.researchStatus) fromTo.push(`状态 ${prev.researchStatus}→${view.researchStatus}`);
    if (prev.confidence && prev.confidence !== view.confidence) fromTo.push(`置信度 ${prev.confidence}→${view.confidence}`);
    const detail = fromTo.length ? `（${fromTo.join("，")}）` : "";
    event = { date, kind: "thesis_change", summary: `${view.thesis || "更新判断"}${detail}` };
  }

  const profile = upsertCompanyProfile(ticker, {
    ...view,
    event,
    bumpTurn: true
  });
  return { created: isNew, changed, profile };
}
