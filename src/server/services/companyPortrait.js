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
import { replaceFalsifierRules, listRules } from "../repositories/watchRules.js";
import { parseFalsifierRules, parseFalsifierRule } from "./falsifyRules.js";
import { companyByTicker } from "../../data.js";
import { beijingDate } from "../utils/time.js";
import { marketCurrency } from "../../market.js";
import { insertResearchSnapshot } from "../repositories/researchSnapshotsRepository.js";

/**
 * 价格相对估值中枢的客观位置——刻意不是"看多/看空"评级（宪法：不给买卖指令），
 * 只记录"当时价格相对我们自己算的估值带在哪"这一几何关系，供 R7 复盘用。
 */
function deriveValuationPosition(valuation) {
  if (!valuation || valuation.base == null || valuation.currentPrice == null) return null;
  if (valuation.currentPrice < valuation.base) return "below_base";
  if (valuation.currentPrice > valuation.base) return "above_base";
  return "at_base";
}

/** 从面板的展示级价格字符串（如"431.2 HKD"）兜底解析数字+币种（valuation 缺失时用）。 */
function parsePriceFromPanel(panel, ticker) {
  const raw = String(panel?.price?.value || "");
  const match = raw.match(/^(-?[\d.]+)\s*([A-Za-z]+)?/);
  if (!match) return { price: null, currency: marketCurrency(ticker) };
  return { price: parseFloat(match[1]), currency: match[2] || marketCurrency(ticker) };
}

function asList(value, limit = 6) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || "").trim()).filter(Boolean).slice(0, limit);
}

/** 把已有画像渲染成注入提示词的简短上下文；无画像返回空串。 */
export function loadPortraitContext(ticker, userId = "local") {
  const profile = getCompanyProfile(ticker, userId);
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

/**
 * 从回答正文的"证伪条件"段落抽取具体条件行（UX-7）。
 * 模型被要求给量化阈值（含价格线），这些具体条件比本地面板的通用 riskTriggers
 * （"监管变化/竞争加剧"）更有沉淀价值——有具体条件就用它们覆盖通用项。
 */
const FALSIFY_HEAD_RE = /^#{0,3}\s*(?:\d+[.、]\s*)?(?:证伪条件|风险\s*\/\s*证伪|会推翻逻辑的关键事实)\s*[：:]?\s*$/;
// 段落边界：整行标题，或"我的判断：…/还缺什么…"这类同行携带内容的散文头（本地答案格式）。
const SECTION_END_RE = /^#{1,3}\s+\S|^(?:\d+[.、]\s*)?(?:结论|事实|推断|估值|动作|来源|我的判断|数据缺口|证据缺口|接下来重点看|深度研究)\s*[：:]?\s*$|^我的判断[：:]|^还缺什么/;
export function extractFalsifiersFromAnswer(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const cleanItem = (line) =>
    line.replace(/^[-•*]\s*/, "").replace(/^\d+[.、)]\s*/, "").replace(/[*_`]/g, "").trim();

  // 第一档：标准段落结构（深度研究式回答，"## 证伪条件" 下的条目）。
  const out = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (FALSIFY_HEAD_RE.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (SECTION_END_RE.test(line)) break;
    // 列表已收到条目后撞到散文行 = 段落实际结束（防"我的判断：…"整段被吸进证伪条件）。
    const isListItem = /^[-•*]|^\d+[.、)]/.test(line);
    if (!isListItem && out.length) break;
    const item = cleanItem(line);
    if (item.length >= 6 && item.length <= 200) out.push(item);
    if (out.length >= 6) break;
  }
  if (out.length) return out;

  // 第二档：松散结构（聚焦式证伪回答，无段落标题）。两条通道：
  //  a) "……证伪阈值/证伪条件："引导句之后的编号/列表条目（空行不打断，编号项间常有空行）；
  //  b) 任何"提到证伪/逻辑失效且本身能解析出价格线"的句子（解析器极严，误报率低）。
  const loose = [];
  let collecting = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue; // 空行不打断列表收集
    const item = cleanItem(line);
    const isListItem = /^[-•*]|^\d+[.、)]/.test(line);
    if (collecting) {
      if (isListItem && item.length >= 6) {
        loose.push(item.slice(0, 200));
        if (loose.length >= 6) break;
        continue;
      }
      collecting = false; // 非列表行结束收集；这一行自己可能是新引导句/价格线，继续往下判
    }
    if (/证伪(?:条件|阈值|信号)/.test(item) && /[：:]\s*$/.test(item)) {
      collecting = true;
      continue;
    }
    if (/证伪|触发(?:全面)?复核|多头逻辑失效/.test(item) && parseFalsifierRule(item)) {
      loose.unshift(item.slice(0, 200)); // 价格线放最前
      if (loose.length >= 6) break;
    }
  }
  // 去重（同句只留一条）
  return [...new Set(loose)].slice(0, 6);
}

/**
 * R12（M-3）：thesis 碎片过滤——真实审计发现 6 只关注股里 5 只的"投资主线"存的是
 * "收入增速 -1.10%，毛利率 55.71%"这类数据碎片，不是一句判断。根因是旧版 distillView
 * 把 `panel.keyDrivers` 里"基本面"驱动因素的数据摘要当 oneLineView 的回落值——那是给
 * "关键驱动因素"卡片用的数字罗列，从来就不是给"投资主线"用的。已从回落链路里彻底删除
 * （不是"过滤更严"，是"这条路本来就不该走"）；这里的过滤器是防御性的第二道——万一
 * 模型的 oneLineView 本身混进数据罗列（未观察到，但代价低，值得留），同样拒收置空，
 * 让下面"没有新主线就保留旧主线"的逻辑接管，而不是让碎片糊弄过去。
 */
const FRAGMENT_METRIC_HEAD_RE = /^(收入增速|营收增速|收入|营收|毛利率|净利率|净利润率|经营利润率|净利润增速|利润增速|自由现金流|ROE|ROIC|PE|PB|EPS|同比|环比|增速波动)[\s：:、,，]/;
export function isDataFragmentThesis(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (FRAGMENT_METRIC_HEAD_RE.test(s)) return true;
  // 数字密度信号：≥2 个百分号且数字字符占比过高，是"数据罗列"而非"论点陈述"
  // （真实碎片样本："增速波动、无单一方向（59.9% → 1.3% → 127.0% → 115.4% → 67.4%）"）。
  const pctCount = (s.match(/%/g) || []).length;
  const digitCount = (s.match(/[0-9]/g) || []).length;
  if (pctCount >= 2 && digitCount / s.length > 0.12) return true;
  return false;
}

/** 从 decisionPanel + 本地公司档案蒸馏画像的"当前 view"字段。 */
function distillView(panel = {}, profile = {}, valuation = null) {
  // 证伪条件：优先用面板的 riskTriggers，回落到公司档案 bear。
  const falsifiers = asList(
    (Array.isArray(panel.riskTriggers) && panel.riskTriggers.length
      ? panel.riskTriggers.map((t) => (typeof t === "string" ? t : t.label))
      : profile.bear),
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

/**
 * 只看"投资主线文本"是否实质变化。状态/置信度会随数据源可用性波动（行情源超时又恢复等），
 * 只改字段不进时间线——时间线只留真正的判断变化。
 */
function judgmentChanged(prev, next) {
  if (!prev) return false; // 首次建档不算"变更"
  const norm = (s) => String(s || "").replace(/\s+/g, "").trim();
  return Boolean(norm(next.thesis)) && norm(prev.thesis) !== norm(next.thesis);
}

/** 面板来源里挑最可信的几条作为事件证据链接（未来复盘"当时依据什么"）。 */
function topEvidence(panel, limit = 3) {
  const sources = Array.isArray(panel?.sources) ? panel.sources : [];
  return sources
    .filter((s) => s && s.url)
    .slice(0, limit)
    .map((s) => ({ title: s.label || s.type || "来源", url: s.url }));
}

/** 量化证伪规则的指纹：kind+metric+threshold 集合变了才算"证伪线演进"（文本措辞变化不算）。 */
function ruleSignature(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((r) => `${r.kind}:${r.metric || ""}:${r.threshold}`)
    .sort()
    .join("|");
}

/**
 * 一轮研究后回写画像。返回 { created, changed, profile }。
 * - 首次研究该公司 → 建档（不写"变更"事件，写一条"建档"事件）。
 * - 已有画像且判断变化 → 改正文 + 追加一条变更事件（带理由与证据链接，未来复盘用）。
 * - 证伪价格线（量化规则）变化 → 追加一条"证伪线演进"事件。
 * - 已有画像但判断未变 → 只 bump turn_count，不写流水账。
 * @param {{ticker?: string, panel?: Object, valuation?: import("../types.js").Valuation|null, question?: string, answerContent?: string, sessionId?: string|null, structuredFalsifiers?: Array<{kind: string, metric: string, threshold: number, label: string}>, userId?: string}} [args]
 */
export function updatePortraitFromPanel({ ticker, panel, valuation = null, question = "", answerContent = "", sessionId = null, structuredFalsifiers = [], userId = "local" } = {}) {
  if (!ticker || !panel) return { created: false, changed: false, profile: null };
  const localProfile = companyByTicker(ticker) || {};
  const prev = getCompanyProfile(ticker, userId);
  const view = distillView(panel, localProfile, valuation);
  // 回答正文里有具体的证伪条件（模型按纪律给的量化阈值/价格线）时，优先沉淀它们。
  const fromAnswer = extractFalsifiersFromAnswer(answerContent);
  if (fromAnswer.length) view.falsifiers = fromAnswer.slice(0, 6);
  // 本轮没形成新主线（如模型未给 oneLineView 的本地兜底路径）时保留已有主线——空值不覆盖真实判断。
  if (!view.thesis && prev?.thesis) view.thesis = prev.thesis;
  if (!view.thesis && !view.bull.length && !view.bear.length) {
    return { created: false, changed: false, profile: prev };
  }

  const isNew = !prev;
  const changed = judgmentChanged(prev, view);
  const date = beijingDate();
  const norm = (s) => String(s || "").replace(/\s+/g, "").trim();
  const q = String(question || "").trim().slice(0, 80);
  const evidence = topEvidence(panel);
  const events = [];
  if (isNew) {
    events.push({
      date,
      kind: "created",
      summary: view.thesis ? `建立画像：${view.thesis}` : "建立画像（首轮研究）",
      rationale: q ? `首轮研究，触发问题：「${q}」` : "首轮研究建档",
      evidence,
      sessionId
    });
  } else if (changed) {
    const fromTo = [];
    if (prev.researchStatus && prev.researchStatus !== view.researchStatus) fromTo.push(`状态 ${prev.researchStatus}→${view.researchStatus}`);
    if (prev.confidence && prev.confidence !== view.confidence) fromTo.push(`置信度 ${prev.confidence}→${view.confidence}`);
    const detail = fromTo.length ? `（${fromTo.join("，")}）` : "";
    const rationale = [
      q ? `触发问题：「${q}」` : "",
      prev.thesis && norm(prev.thesis) !== norm(view.thesis) ? `主线由「${prev.thesis}」改为「${view.thesis}」` : "",
      fromTo.join("，")
    ].filter(Boolean).join("；") || "本轮研究后判断更新";
    events.push({ date, kind: "thesis_change", summary: `${view.thesis || "更新判断"}${detail}`, rationale, evidence, sessionId });
  }

  // 证伪线演进：量化规则指纹（kind+metric+threshold 集合）变了才记，措辞微调不记——时间线只留判断变化。
  // F-3：nextRules 现在是价格线（文本解析）+ 基本面线（模型结构化输出）的合集；上一轮的基本面
  // 规则不存在文本里，只能从 watch_rules 现存的活跃规则里取（在 replaceFalsifierRules 覆盖之前）。
  const prevFundamentalRules = ticker ? listRules(ticker, userId).filter((r) => r.kind.startsWith("fundamental_")) : [];
  const nextRules = [...parseFalsifierRules(view.falsifiers), ...structuredFalsifiers];
  const prevRules = [...parseFalsifierRules(prev?.falsifiers), ...prevFundamentalRules];
  if (prev && nextRules.length && ruleSignature(prevRules) !== ruleSignature(nextRules)) {
    events.push({
      date,
      kind: "falsifier_change",
      summary: `证伪线更新：${nextRules.map((r) => r.label).join("；")}`.slice(0, 300),
      rationale: q ? `本轮研究给出新的量化证伪条件（触发问题：「${q}」）` : "本轮研究给出新的量化证伪条件",
      evidence,
      sessionId
    });
  }

  const profile = upsertCompanyProfile(ticker, {
    ...view,
    events,
    bumpTurn: true
  }, userId);

  // R7 Phase A：判断快照——只在"建档/判断变化"这两个跟 profile_events 同源的触发点落一行，
  // 不做流水账（跟时间线的沉淀节奏保持一致）。价格优先取估值引擎算出的 currentPrice
  // （已核对过一致性），拿不到时兜底解析面板的展示级价格字符串。
  if (isNew || changed) {
    const fallback = parsePriceFromPanel(panel, ticker);
    insertResearchSnapshot({
      ticker,
      snapshotDate: date,
      thesis: view.thesis || null,
      valuationPosition: deriveValuationPosition(view.valuation),
      valuationBear: view.valuation?.bear ?? null,
      valuationBase: view.valuation?.base ?? null,
      valuationBull: view.valuation?.bull ?? null,
      valuationCurrency: fallback.currency,
      priceAtSnapshot: view.valuation?.currentPrice ?? fallback.price,
      falsifiers: view.falsifiers,
      sessionId,
      userId
    });
  }

  // UX-7 研究→监控闭环：证伪条件里"明确的价格条件"落成 watch_rules，
  // 看盘状态机 + 定时巡检据此自动盯盘、命中推通知。解析失败不影响画像主流程。
  try {
    replaceFalsifierRules(ticker, nextRules, { sessionId, userId });
  } catch (err) {
    console.error("[companyPortrait] 证伪规则同步失败：", err?.message || err);
  }

  return { created: isNew, changed, profile };
}
