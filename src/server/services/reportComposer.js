/**
 * reportComposer — judgment-first deep-research report built deterministically
 * from a decisionPanel + the local company profile.
 *
 * This is the fallback used when the report model call is unavailable or times
 * out, so it must read like a research note on its own: lead with the
 * judgment, never expose backend / vendor / "data completeness %" language.
 */

import { RESEARCH_STATUS_LABELS } from "../schemas/agentPanel.js";
import { companyByTicker } from "../../data.js";
import { beijingMinute } from "../utils/time.js";

const DISCLAIMER =
  "\n\n---\n> 本报告仅供研究学习，不构成投资建议。请用公司原始公告核验关键数据，独立做出决定。";

function clean(value) {
  return String(value || "").replace(/[。；;,\s]+$/g, "").trim();
}

function driverSummary(panel, name, fallback) {
  const d = (panel?.keyDrivers || []).find((item) => item.name === name);
  const text = clean(d?.summary || "");
  if (!text || /暂不评分|未接入|缺失|不可用|新闻源/.test(text)) return fallback;
  return text;
}

function sourceLines(panel) {
  const seen = new Set();
  const lines = [];
  for (const s of Array.isArray(panel?.sources) ? panel.sources : []) {
    if (!s?.label && !s?.url) continue;
    if (s.url) { if (seen.has(s.url)) continue; seen.add(s.url); }
    lines.push(`- ${s.label || s.type || "来源"}${s.timestamp ? `（${s.timestamp}）` : ""}${s.url ? `：${s.url}` : ""}`);
    if (lines.length >= 7) break;
  }
  if (!lines.length) {
    const price = panel?.price?.value && panel.price.value !== "暂不可用" ? panel.price.value : "公开行情";
    lines.push(`- 行情：${panel?.price?.source || "公开行情"}（${price}）`);
    lines.push("- 公司档案：Echo Research 本地研究档案");
  }
  return lines;
}

/**
 * Accept a decisionPanel and produce a clean, judgment-first markdown report.
 * @param {object} panel
 * @returns {{ markdown: string, sections: string[] }}
 */
export function composeReport(panel) {
  if (!panel) {
    return { markdown: `# 研究报告\n\n暂时拿不到足够上下文，先告诉我公司名称或港股代码。${DISCLAIMER}`, sections: [] };
  }

  const profile = companyByTicker(panel.ticker) || {};
  const name = panel.companyName || profile.nameZh || panel.ticker || "这家公司";
  const statusLabel = RESEARCH_STATUS_LABELS[panel.researchStatus] || panel.researchStatus || "持续观察";
  const business = (profile.businessModel || []).map(clean).filter(Boolean);
  const moat = (profile.moat || []).map(clean).filter(Boolean);
  const risks = (profile.risks || []).map(clean).filter(Boolean);
  const monitors = (profile.monitors || ["收入增速", "利润率", "自由现金流", "回购/分红", "监管与竞争"]).slice(0, 5);
  const bull = (profile.bull || []).map(clean).filter(Boolean);
  const bear = (profile.bear || []).map(clean).filter(Boolean);
  const price = panel.price?.value && panel.price.value !== "暂不可用" ? panel.price.value : null;

  const sections = [];

  sections.push([
    `# ${name}（${panel.ticker || ""}）深度研究`,
    `> 北京时间 ${beijingMinute()} · 研究状态：${statusLabel} · 置信度：${panel.confidence || "中"}`
  ].join("\n"));

  sections.push([
    `## 核心判断`,
    clean(panel.oneLineView) ? `${clean(panel.oneLineView)}。` : `${name} 的价值要看赚钱机制、利润质量和现金流能否同向兑现。`,
    `它现在的核心矛盾不是“有没有收入”，而是${business[0] ? `「${business[0]}」这类利润池能否持续放大` : "高质量利润能否持续"}；最大的赌点是${bull[0] || "核心业务重新加速、利润率与现金流改善"}；最大的风险是${bear[0] || risks[0] || "竞争或监管压低利润与现金流"}。${price ? `当前价格口径 ${price}，只反映市场状态，不等于公司价值。` : ""}`
  ].join("\n\n"));

  sections.push([
    `## 赚钱机制与护城河`,
    business.length ? business.slice(0, 5).map((b, i) => `${i + 1}. ${b}。`).join("\n") : "核心收入来源需要用最新财报拆分，先从主业收入、利润率和现金流判断。",
    `护城河：${moat.length ? moat.slice(0, 5).join("、") : "规模效应、客户关系、品牌与渠道"}。真正的壁垒不是“听起来强”，而是能不能转成更低获客成本、更高留存、更稳利润率和更强自由现金流。`
  ].join("\n\n"));

  sections.push([
    `## 财务质量`,
    `- 基本面：${driverSummary(panel, "基本面", "完整三表还没核到，先看高毛利业务占比是否提升、利润率是否稳定")}。`,
    `- 股东回报：${driverSummary(panel, "股东回报", "重点看回购、分红和自由现金流是否可持续")}。`,
    `判断它“赚不赚钱”，不能只看一次性净利润，而要看高毛利业务占比、经营现金流和股东回报是不是同向。`
  ].join("\n\n"));

  sections.push([
    `## 估值与赔率`,
    `- 估值状态：${driverSummary(panel, "估值", "当前未核到 Forward PE、FCF 收益率和可比区间，暂不锁定目标价")}。`,
    `- Bull：${bull.length ? bull.slice(0, 3).join("；") : "收入恢复、利润率稳定、自由现金流改善，且估值仍有安全边际"}。`,
    `- Bear：${bear.length ? bear.slice(0, 3).join("；") : "竞争、监管或投入周期继续压低利润与现金流，所谓便宜只是逻辑重估"}。`
  ].join("\n\n"));

  sections.push([
    `## 风险与证伪条件`,
    (risks.length ? risks.slice(0, 5) : ["利润率下滑", "竞争加剧", "现金流转弱", "监管或商业模式变化"]).map((r, i) => `${i + 1}. ${r}。`).join("\n"),
    `证伪：一旦${bear[0] || "收入/利润率/现金流持续走弱"}真实发生并改变利润池，就不该再用“便宜/被低估”自我安慰，而要按逻辑重估。`
  ].join("\n\n"));

  sections.push([
    `## 关键监控与下一步`,
    monitors.map((m, i) => `${i + 1}. ${m}：作为先行指标盯趋势，而不是等财报盖棺。`).join("\n"),
    `还缺什么：完整财报三表、最新公告和一致预期核到后，可把财务与估值从方向判断升级为区间判断——这只影响置信度，不影响当前方向。`
  ].join("\n\n"));

  sections.push([`## 来源`, ...sourceLines(panel)].join("\n"));

  // Optional: append model long-form research if it exists and is substantial.
  if (panel.fullResearch && panel.fullResearch.length > 120 && !/^北京时间/.test(panel.fullResearch.trim())) {
    sections.push(`## 研究材料\n\n${panel.fullResearch}`);
  }

  return { markdown: sections.join("\n\n") + DISCLAIMER, sections };
}

/** Plain-text summary for session lists / search previews. */
export function reportPreview(panel) {
  if (!panel) return "";
  return String(panel.oneLineView || panel.action || "").slice(0, 200);
}
