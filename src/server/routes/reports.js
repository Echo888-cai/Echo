import { readJsonBody, sendJson } from "../utils/async.js";
import { runAgent } from "../services/agentService.js";
import { composeReport, reportPreview } from "../services/reportComposer.js";
import { saveResearchSession } from "../repositories/researchSessions.js";

export async function handleReportGenerateApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = await runAgent(payload);
    const report = composeReport(result.decisionPanel);
    const sessionId = persistFinalReportSession(payload, result, report.markdown);
    sendJson(res, 200, {
      mode: result.mode === "model" ? "report_model" : "report_local",
      provider: result.provider,
      model: result.model,
      sessionId,
      decisionPanel: result.decisionPanel,
      markdown: report.markdown,
      preview: reportPreview(result.decisionPanel),
      dataSources: result.dataSources,
      marketSnapshot: result.marketSnapshot,
      newsSnapshot: result.newsSnapshot
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
