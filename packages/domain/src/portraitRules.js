import { parseFalsifierRule } from "./falsifyRules.js";

// 这三条正则必须跟 answerComposer/reportComposer 实际输出的小标题对得上，否则提取恒为空。
// 真实回答里同一个小标题有三种写法，缺一不可：
//   - chat 默认模板（answerComposer 第 800 行）：模型吐的是 `**我的判断**`、`**证伪条件**`
//     ——粗体、无冒号。正则原本锚定 `^#{0,3}`，遇到开头的 `**` 直接失配，这是提取失效的
//     主因，所以匹配前一律先用 stripEmphasis() 剥掉强调符（`#` 保留，SECTION_END_RE 要用）。
//   - reportComposer / 深度报告：`## 核心判断`、`## 风险与证伪条件`。
//   - 老手写模板留在历史会话正文里的：`我的判断：`、`证伪条件`。
// 三代写法全部保留——历史会话仍要能复盘。
const FALSIFY_HEAD_RE = /^#{0,3}\s*(?:\d+[.、]\s*)?(?:风险与证伪条件|证伪条件|风险\s*\/\s*证伪|会推翻逻辑的关键事实)\s*[：:]?\s*$/;
const SECTION_END_RE = /^#{1,3}\s+\S|^(?:\d+[.、]\s*)?(?:结论|事实|推断|估值|动作|来源|我的判断|核心判断|数据缺口|证据缺口|接下来重点看|深度研究)\s*[：:]?\s*$|^(?:我的判断|核心判断)[：:]|^还缺什么|^估值\s*\/\s*风险\s*$/;
const THESIS_HEAD_RE = /^#{0,3}\s*(?:\d+[.、]\s*)?(?:我的判断|核心判断)\s*[：:]?\s*(.*)$/;
/** 只剥 markdown 强调符，保留 `#`（SECTION_END_RE 靠 `^#{1,3}\s+\S` 识别 ## 小标题）。 */
const stripEmphasis = (text) => String(text).replace(/[*_`]/g, "").trim();
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
    // 标题判定一律走剥掉强调符的副本：真实回答里是 `**证伪条件**` 而不是 `证伪条件`。
    const head = stripEmphasis(line);
    if (FALSIFY_HEAD_RE.test(head)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (SECTION_END_RE.test(head)) break;
    const isListItem = /^[-•*]|^\d+[.、)]/.test(line);
    if (!isListItem && output.length) break;
    const item = cleanItem(line);
    // 段落开头常有一句引导语（真实回答："以下事实出现任意一项，即需重估腾讯的核心逻辑："）。
    // 它不是证伪条件，但它紧跟小标题、且此时 output 还是空的，上面那条"非列表项就停"的
    // 规则拦不住它，于是会被当成第一条收进画像和快照——一条永远无法核对的假证伪线。
    // 冒号结尾是引导语的稳定特征，真正的证伪条件不会这么收尾。
    if (!isListItem && !output.length && /[：:]\s*$/.test(item)) continue;
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
    // 同上：真实回答的小标题是 `**我的判断**`，不剥强调符就永远匹配不到。
    const match = THESIS_HEAD_RE.exec(stripEmphasis(line));
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
        // 段落边界同样要剥：否则 `**还缺什么**` 拦不住，会把后面几段一起吞进主线。
        if (SECTION_END_RE.test(stripEmphasis(next))) break;
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
