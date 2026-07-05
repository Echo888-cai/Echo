import { readJsonBody, sendJson, withTimeout } from "../utils/async.js";
import { runAgent } from "../services/agentService.js";
import { callModel, getProviderStatus } from "../services/modelGateway.js";
import { companyByTicker } from "../../data.js";
import { classifyResearchIntent } from "../services/intentClassifier.js";
import { researchWebEvidence } from "../services/webEvidenceService.js";
import { buildReportPrompt, mergeEvidenceIntoPanel } from "../services/answerComposer.js";
import { displayValuation } from "../services/valuationEngine.js";
import { composeReport, reportPreview } from "../services/reportComposer.js";
import { saveResearchSession } from "../repositories/researchSessions.js";

const DISCLAIMER =
  "\n\n---\n> 本报告仅供研究学习，不构成投资建议。请用公司原始公告核验关键数据，独立做出决定。";

export async function handleReportGenerateApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const question = payload.question || "";
    const companyForEvidence = companyByTicker(payload.company?.ticker) || payload.company || {};
    const intent = classifyResearchIntent(question);

    // Data + deterministic local panel (no model panel, no persist here) and web
    // evidence run in parallel — same single-pass pipeline as the chat route.
    const [result, webEvidence] = await Promise.all([
      runAgent(payload, { persist: false, useModelPanel: false }),
      withTimeout(
        researchWebEvidence({ company: companyForEvidence, question, intent }),
        9000,
        { intent, queries: [], evidence: [], gaps: [], provider: "timeout", searchedAt: new Date().toISOString() }
      )
    ]);

    /** @type {(Object & {valuation?: import("../types.js").Valuation})|null|undefined} */
    const panel = result.decisionPanel;
    const valuationProfile = companyByTicker(panel?.ticker || payload.company?.ticker) || payload.company;
    const valuation = displayValuation(valuationProfile, result.marketSnapshot, result.financialsData);
    if (panel && !valuation.cannotValueReason) panel.valuation = valuation;
    const context = {
      newsSnapshot: result.newsSnapshot,
      webEvidence,
      financialsData: result.financialsData,
      marketSnapshot: result.marketSnapshot,
      valuation: valuation.cannotValueReason ? null : valuation
    };

    // One model round-trip for the full report. Generous budget; on failure we
    // fall back to a cleaned structured template (no backend/vendor language).
    let markdown = null;
    let model = null;
    if (getProviderStatus().configured && panel) {
      model = await withTimeout(callModel({
        system: "你是 Luvio 的港股研究负责人，写资深买方研究员风格的深度研究报告：判断优先、克制、可证伪。绝不暴露后台/产品/厂商词，绝不给买卖指令。",
        user: buildReportPrompt(question, panel, result.dataSources, context)
      }), 42000, null);
      if (model?.content && model.content.trim().length > 200) {
        markdown = model.content.trim() + DISCLAIMER;
      }
    }
    if (!markdown) {
      markdown = composeReport(panel).markdown;
    }

    result.webEvidence = webEvidence;
    mergeEvidenceIntoPanel(panel, webEvidence);
    const sessionId = persistFinalReportSession(payload, result, markdown);
    sendJson(res, 200, {
      mode: model?.content ? "report_model" : "report_local",
      provider: model?.provider || result.provider,
      model: model?.model || result.model,
      sessionId,
      decisionPanel: panel,
      markdown,
      preview: reportPreview(panel),
      dataSources: result.dataSources,
      marketSnapshot: result.marketSnapshot,
      newsSnapshot: result.newsSnapshot,
      webEvidence
    });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, { error: error.message || "报告生成失败" });
  }
}

function persistFinalReportSession(payload, result, markdown) {
  const panel = result.decisionPanel;
  const ticker = panel?.ticker || payload.company?.ticker;
  if (!ticker) return payload.sessionId || result.sessionId || null;
  const thread = buildFinalThread(payload.history, payload.question, markdown);
  try {
    const saved = saveResearchSession({
      id: payload.sessionId || result.sessionId || undefined,
      ticker,
      conversationId: payload.conversationId || undefined,
      companyName: panel?.companyName || payload.company?.nameZh || payload.company?.name || ticker,
      title: payload.sessionTitle || payload.question || panel?.companyName || ticker,
      question: payload.question || "",
      status: "completed",
      decisionPanel: panel,
      fullResearch: markdown,
      reportMarkdown: markdown,
      dataSources: result.dataSources,
      researchStatus: panel?.researchStatus,
      confidence: panel?.confidence,
      thread
    });
    return saved.id;
  } catch (error) {
    console.warn("report session 持久化失败:", error?.message || error);
    return payload.sessionId || result.sessionId || null;
  }
}

function buildFinalThread(history = [], question = "", assistantContent = "") {
  const thread = Array.isArray(history) ? [...history] : [];
  const normalizedQuestion = String(question || "").trim();
  const last = thread[thread.length - 1];
  if (!(last?.role === "user" && String(last.content || "").trim() === normalizedQuestion)) {
    thread.push({ role: "user", content: question, createdAt: new Date().toISOString() });
  }
  if (assistantContent) thread.push({ role: "assistant", content: assistantContent, meta: { type: "deep_research" }, createdAt: new Date().toISOString() });
  return thread.slice(-80);
}
