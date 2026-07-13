/**
 * companyPortrait — 把单次研究升级成可持续维护的长期画像。
 *
 * 两个方向：
 * 1. loadPortraitContext(ticker)：把已有画像格式化成模型上下文，研究同一公司时
 *    自动带上"上次的投资主线、证伪条件、置信度"，保持判断连贯。
 * 2. updatePortraitFromPanel(...)：一轮研究后，从 decisionPanel + 公司档案
 *    蒸馏出"当前 view"并回写；投资主线/状态/置信度变化时追加一条事件日志。
 */

import { getCompanyProfile, upsertCompanyProfile } from "../repositories/companyProfilesRepository.js";
import { replaceFalsifierRules, listRules } from "../repositories/watchRulesRepository.js";
import {
  deriveValuationPosition,
  distillPortraitView as distillView,
  extractFalsifiersFromAnswer,
  extractThesisFromAnswer,
  falsifierRuleSignature as ruleSignature,
  isDataFragmentThesis,
  parseFalsifierRules,
  portraitJudgmentChanged as judgmentChanged,
  topPortraitEvidence as topEvidence
} from "@echo/domain";
import { companyByTicker } from "../../data.js";
import { beijingDate } from "../utils/time.js";
import { marketCurrency } from "../../market.js";
import { insertResearchSnapshot } from "../repositories/researchSnapshotsRepository.js";
export { extractFalsifiersFromAnswer, extractThesisFromAnswer, isDataFragmentThesis } from "@echo/domain";

/** 从面板的展示级价格字符串（如"431.2 HKD"）兜底解析数字+币种（valuation 缺失时用）。 */
function parsePriceFromPanel(panel, ticker) {
  const raw = String(panel?.price?.value || "");
  const match = raw.match(/^(-?[\d.]+)\s*([A-Za-z]+)?/);
  if (!match) return { price: null, currency: marketCurrency(ticker) };
  return { price: parseFloat(match[1]), currency: match[2] || marketCurrency(ticker) };
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
  // F1：panel.oneLineView 是死字段（见 extractThesisFromAnswer 顶部注释），一句话主线
  // 改从回答正文的"我的判断"段落抽取；碎片过滤器兜底，防止抽到数据罗列。
  const thesisFromAnswer = extractThesisFromAnswer(answerContent);
  if (thesisFromAnswer && !isDataFragmentThesis(thesisFromAnswer)) view.thesis = thesisFromAnswer;
  // 本轮没形成新主线（如模型未给判断段落的本地兜底路径）时保留已有主线——空值不覆盖真实判断。
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
