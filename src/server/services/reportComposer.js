/**
 * reportComposer — generates a structured, source-audited investment research
 * report from a decisionPanel (the canonical schema that comes out of
 * /api/agent). Never fabricates data; all claims reference evidence IDs.
 *
 * The output is a long-form Chinese Markdown report ready for
 * saving/exporting, plus a structured JSON summary.
 */

import { RESEARCH_STATUS_LABELS, KEY_DRIVER_NAMES } from "../schemas/agentPanel.js";
import { missing } from "../utils/format.js";

const DISCLAIMER =
  "\n\n---\n> **免责声明**：Luvio 不提供投资顾问服务。本报告仅用于研究和学习，请用公司原始公告核验全部数据，并独立做出投资决定。报告中的研究状态描述不构成买卖建议。";

/**
 * Accept a decisionPanel (from agentService) and produce a structured report.
 *
 * @param {object} panel - the decisionPanel output from agentService
 * @returns {{ markdown: string, sections: string[] }}
 */
export function composeReport(panel) {
  if (!panel) {
    return {
      markdown: `# 研究报告\n\n**数据不足，无法生成报告。**${DISCLAIMER}`,
      sections: []
    };
  }

  const { ticker, companyName, researchStatus, confidence, dataCompleteness, oneLineView,
    action, userContext, price, keyDrivers, connectedData, missingData,
    riskTriggers, sources, evidence, details, fullResearch } = panel;

  const statusLabel = RESEARCH_STATUS_LABELS[researchStatus] || researchStatus || "未设置";
  const sections = [];

  // ── Section 0: Summary ──────────────────────────────
  const s0 = [
    `## 0. 结论摘要`,
    `- **研究状态**：${statusLabel}`,
    `- **置信度**：${confidence || "低"}`,
    `- **数据完整度**：${dataCompleteness ?? 0}%`,
    `- **一句话判断**：${oneLineView || "数据不足，无法形成判断。"}`,
    `- **当前建议动作**：${action || "补充关键数据后再判断。"}`,
    !researchStatus || researchStatus === "data_missing" || researchStatus === "research_more" ? `- **本轮不能形成完整结论的原因**：关键证据缺失（缺失项：${(missingData || []).join("、") || "无"}）。` : ""
  ].filter(Boolean).join("\n");
  sections.push(s0);

  // ── Section 1: User context ─────────────────────────
  const s1 = [
    `## 1. 用户问题与持仓上下文`,
    userContext && (userContext.cost || userContext.shares)
      ? `- **成本价**：${missing(userContext.cost)}   **持股数**：${missing(userContext.shares)}   **投资周期**：${missing(userContext.horizon)}`
      : "- **用户未录入持仓。** 添加成本价和仓位后，可生成分批和止错计划。",
    userContext?.note ? `- 用户偏好：${userContext.note}` : ""
  ].filter(Boolean).join("\n");
  sections.push(s1);

  // ── Section 2: Data source status ───────────────────
  const s2 = [
    `## 2. 数据源状态`,
    `- **行情**：${price?.source || "缺失"}${price?.timestamp ? `（${price.timestamp}）` : ""}${price?.stale ? " ⚠ 此数据为缓存的旧数据" : ""}`,
    ...(connectedData || []).map(d => `- **已接入**：${d}`),
    ...(missingData || []).map(d => `- **缺失**：${d} —— 本次不参与评分`),
    `- **数据完整度**：${dataCompleteness ?? 0}%（${connectedData?.length || 0}/${(connectedData?.length || 0) + (missingData?.length || 0)} 项）`
  ].join("\n");
  sections.push(s2);

  // ── Section 3: Company overview ─────────────────────
  const s3 = [
    `## 3. 公司与业务概览`,
    `**${companyName || "待确定"}（${ticker || ""}）**`,
    details?.overview?.length ? details.overview.map(l => `- ${l}`).join("\n") : "- 本地档案数据不足，依赖实时数据。"
  ].join("\n");
  sections.push(s3);

  // ── Section 4: Financial quality ────────────────────
  const finCards = (keyDrivers || []).filter(d => d.name === "基本面" || d.name === "股东回报");
  const s4 = [
    `## 4. 财务质量`,
    ...finCards.map(card =>
      `- **${card.name}**：${card.summary || "暂不评分"}`
    ),
    details?.financials?.length ? "" : "",
    ...(details?.financials || ["财报解析未接入，收入、利润率、FCF 暂不评分。"]).map(l => `- ${l}`),
    "**缺失数据说明**：",
    ...(missingData || []).map(d => `- ${d}：暂不评分 —— 数据缺失。`)
  ].join("\n");
  sections.push(s4);

  // ── Section 5: Valuation framework ──────────────────
  const valCards = (keyDrivers || []).filter(d => d.name === "估值");
  const s5 = [
    `## 5. 估值框架`,
    ...valCards.map(card =>
      `- **当前估值状态**：${card.summary || "无法估值"}`
    ),
    ...(details?.valuation || ["缺 Forward PE、FCF 收益率和可比公司区间，暂不给目标价。"]).map(l => `- ${l}`),
    "- **什么数据会改变估值判断**：配置 FMP_API_KEY 获取 Forward PE 与 FCF 数据，或上传年报补全现金流。"
  ].join("\n");
  sections.push(s5);

  // ── Section 6: Risk radar ───────────────────────────
  const riskCards = (keyDrivers || []).filter(d => d.name === "风险信号");
  const risks = Array.isArray(riskTriggers) ? riskTriggers : [];
  const s6 = [
    `## 6. 风险雷达`,
    ...riskCards.map(card =>
      `- **舆论/风险信号**：${card.summary || "新闻源不可用"}`
    ),
    ...risks.slice(0, 5).map(r => {
      const label = typeof r === "string" ? r : (r.label || "");
      const evidenceIds = r.evidence?.map(e => e.missingReason).filter(Boolean).slice(0, 2).join("；") || "";
      return `- **${label}**${evidenceIds ? `（证据：${evidenceIds}）` : ""}`;
    }),
    risks.length === 0 ? "- 当前无风险触发器数据。" : ""
  ].filter(Boolean).join("\n");
  sections.push(s6);

  // ── Section 7: Bull / Bear debate ───────────────────
  const s7 = [
    `## 7. 多空辩论`,
    details?.overview?.length ? details.overview.join("\n") : "- 数据不足，无法展开多空辩论。",
    "> 判断均来自结构化数据。如需更完整的多空辩论，请上传更多公告和年报。"
  ].join("\n");
  sections.push(s7);

  // ── Section 8: Next actions ─────────────────────────
  const s8 = [
    `## 8. 下一步研究动作`,
    `- **当前建议**：${action || "继续收集数据。"}`,
    ...(missingData || []).map(d => `- **需要补充**：${d}`),
    "- **上传材料**：上传年报、业绩公告或管理层电话会纪要可补全缺项。",
    "- **下次复盘**：当关键数据项状态从 missing 变为 ok 时触发。",
    "- **监控项**：加入 Watchlist 后系统会在下次研究中自动带入上下文。"
  ].join("\n");
  sections.push(s8);

  // ── Section 9: Source audit ─────────────────────────
  const s9 = [
    `## 9. 来源审计`,
    ...(Array.isArray(sources) ? sources.map((s, i) => {
      const label = s.label || "未命名来源";
      const url = s.url ? `｜${s.url}` : "";
      const type = s.type ? `（${s.type}）` : "";
      const ts = s.timestamp ? `｜${s.timestamp}` : "";
      return `${i + 1}. ${label}${type}${ts}${url}`;
    }) : []),
    "",
    ...(Array.isArray(evidence) ? evidence.slice(0, 8).map((e, i) =>
      `- 证据 #${i + 1}：${e.source || "无来源"}${e.asOf ? `｜${e.asOf}` : ""}${e.confidence ? `｜可信度 ${e.confidence}` : ""}${e.missingReason && e.missingReason !== "无" ? `｜${e.missingReason}` : ""}`
    ) : []),
    evidence?.length === 0 ? "- 暂无可引用的可信证据。" : ""
  ].filter(Boolean).join("\n");
  sections.push(s9);

  // ── Section 10: Full research markdown ──────────────
  if (fullResearch && fullResearch.length > 50) {
    sections.push(`## 10. 研究材料\n\n${fullResearch}`);
  }

  const markdown = sections.join("\n\n") + DISCLAIMER;
  return { markdown, sections };
}

/**
 * Build a plain-text summary (first 200 chars) for search results / session list.
 */
export function reportPreview(panel) {
  if (!panel) return "";
  const text = panel.oneLineView || panel.action || "";
  return String(text).slice(0, 200);
}
