import { parseFalsifierRule } from "./falsifyRules.js";

const FALSIFY_HEAD_RE = /^#{0,3}\s*(?:\d+[.、]\s*)?(?:证伪条件|风险\s*\/\s*证伪|会推翻逻辑的关键事实)\s*[：:]?\s*$/;
const SECTION_END_RE = /^#{1,3}\s+\S|^(?:\d+[.、]\s*)?(?:结论|事实|推断|估值|动作|来源|我的判断|数据缺口|证据缺口|接下来重点看|深度研究)\s*[：:]?\s*$|^我的判断[：:]|^还缺什么/;
const THESIS_HEAD_RE = /^#{0,3}\s*(?:\d+[.、]\s*)?我的判断\s*[：:]?\s*(.*)$/;
const FRAGMENT_METRIC_HEAD_RE = /^(收入增速|营收增速|收入|营收|毛利率|净利率|净利润率|经营利润率|净利润增速|利润增速|自由现金流|ROE|ROIC|PE|PB|EPS|同比|环比|增速波动)[\s：:、,，]/;

function asList(value, limit = 6) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

export function extractFalsifiersFromAnswer(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const cleanItem = (line) => line
    .replace(/^[-•*]\s*/, "")
    .replace(/^\d+[.、)]\s*/, "")
    .replace(/[*_`]/g, "")
    .trim();

  const output = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (FALSIFY_HEAD_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (SECTION_END_RE.test(line)) break;
    const isListItem = /^[-•*]|^\d+[.、)]/.test(line);
    if (!isListItem && output.length) break;
    const item = cleanItem(line);
    if (item.length >= 6 && item.length <= 200) output.push(item);
    if (output.length >= 6) break;
  }
  if (output.length) return output;

  const loose = [];
  let collecting = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const item = cleanItem(line);
    const isListItem = /^[-•*]|^\d+[.、)]/.test(line);
    if (collecting) {
      if (isListItem && item.length >= 6) {
        loose.push(item.slice(0, 200));
        if (loose.length >= 6) break;
        continue;
      }
      collecting = false;
    }
    if (/证伪(?:条件|阈值|信号)/.test(item) && /[：:]\s*$/.test(item)) {
      collecting = true;
      continue;
    }
    if (/证伪|触发(?:全面)?复核|多头逻辑失效/.test(item) && parseFalsifierRule(item)) {
      loose.unshift(item.slice(0, 200));
      if (loose.length >= 6) break;
    }
  }
  return [...new Set(loose)].slice(0, 6);
}

export function extractThesisFromAnswer(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const clean = (text) => text.replace(/[*_`#]/g, "").trim();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const match = THESIS_HEAD_RE.exec(line);
    if (!match) continue;
    let text = clean(match[1] || "");
    if (!text) {
      const collected = [];
      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
        const next = lines[nextIndex].trim();
        if (!next) {
          if (collected.length) break;
          continue;
        }
        if (SECTION_END_RE.test(next)) break;
        collected.push(clean(next));
      }
      text = collected.join("");
    }
    if (!text) continue;
    const firstSentence = (text.split(/(?<=[。！？])/)[0] || text).trim();
    const result = firstSentence.slice(0, 120);
    return result.length >= 6 ? result : null;
  }
  return null;
}

export function isDataFragmentThesis(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (FRAGMENT_METRIC_HEAD_RE.test(value)) return true;
  const percentCount = (value.match(/%/g) || []).length;
  const digitCount = (value.match(/[0-9]/g) || []).length;
  return percentCount >= 2 && digitCount / value.length > 0.12;
}

export function deriveValuationPosition(valuation) {
  if (!valuation || valuation.base == null || valuation.currentPrice == null) return null;
  if (valuation.currentPrice < valuation.base) return "below_base";
  if (valuation.currentPrice > valuation.base) return "above_base";
  return "at_base";
}

export function distillPortraitView(panel = {}, profile = {}, valuation = null) {
  const falsifiers = asList(
    Array.isArray(panel.riskTriggers) && panel.riskTriggers.length
      ? panel.riskTriggers.map((trigger) => typeof trigger === "string" ? trigger : trigger.label)
      : profile.bear,
    6
  );
  const thesisCandidate = String(panel.oneLineView || profile.summary?.[0] || "").trim();
  return {
    companyName: panel.companyName || profile.nameZh || panel.ticker,
    thesis: isDataFragmentThesis(thesisCandidate) ? "" : thesisCandidate,
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

export function portraitJudgmentChanged(previous, next) {
  if (!previous) return false;
  const normalize = (value) => String(value || "").replace(/\s+/g, "").trim();
  return Boolean(normalize(next.thesis)) && normalize(previous.thesis) !== normalize(next.thesis);
}

export function topPortraitEvidence(panel, limit = 3) {
  return (Array.isArray(panel?.sources) ? panel.sources : [])
    .filter((source) => source && source.url)
    .slice(0, limit)
    .map((source) => ({ title: source.label || source.type || "来源", url: source.url }));
}

export function falsifierRuleSignature(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => `${rule.kind}:${rule.metric || ""}:${rule.threshold}`)
    .sort()
    .join("|");
}
