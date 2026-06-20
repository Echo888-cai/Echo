import { readJsonBody, sendJson, withTimeout } from "../utils/async.js";
import { runAgent } from "../services/agentService.js";
import { callModel, getProviderStatus } from "../services/modelGateway.js";
import { companyByTicker } from "../../data.js";
import { saveResearchSession } from "../repositories/researchSessions.js";
import { classifyResearchIntent } from "../services/intentClassifier.js";
import { researchWebEvidence } from "../services/webEvidenceService.js";
import { researchReplyFromPanel, normalizeResearchAnswer, buildChatPrompt } from "../services/answerComposer.js";

export async function handleChatApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const question = payload.question || "";
    const intent = classifyResearchIntent(question);
    const companyForEvidence = companyByTicker(payload.company?.ticker) || payload.company || {};

    // Single pipeline: data + deterministic local panel (no model, no persist here) runs in
    // parallel with web-evidence retrieval. The model is only called once, for the prose below.
    const [result, webEvidence] = await Promise.all([
      runAgent(payload, { persist: false, useModelPanel: false }),
      withTimeout(
        researchWebEvidence({ company: companyForEvidence, question, intent }),
        9000,
        { intent, queries: [], evidence: [], gaps: ["网页证据检索超时，本轮先使用本地档案和已接入数据。"], provider: "timeout", searchedAt: new Date().toISOString() }
      )
    ]);

    const context = {
      newsSnapshot: result.newsSnapshot,
      webEvidence,
      financialsData: result.financialsData,
      marketSnapshot: result.marketSnapshot
    };
    const fallback = researchReplyFromPanel(result.decisionPanel, question, result.dataSources, context);
    let content = fallback;
    let chatModel = null;
    // One model round-trip for every intent (the prompt carries an intent-specific instruction).
    // Generous budget because this is now the only model call in the chat path; on timeout we fall
    // back to the focused local reply, which is already intent-aware.
    if (getProviderStatus().configured && result.decisionPanel) {
      chatModel = await withTimeout(callModel({
        system: "你是 Luvio 的港股研究助理，风格像资深买方研究员：直接、克制、可证伪。先给判断，再讲依据，最后才提缺口。普通追问给精炼短答，不要伪装成完整正式报告，不给买卖指令。即使公开数据不完整，也必须基于公司档案、商业模式、行业常识、当前可得行情/财务/公告和模型推理给阶段判断；缺数据只影响置信度。正文禁止出现“未接入/完整度xx%/需要补充材料”这类后台状态词。",
        user: buildChatPrompt(question, result.decisionPanel, result.dataSources, context)
      }), 30000, null);
      if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
    }
    content = normalizeResearchAnswer(content, result.decisionPanel, result.dataSources);
    result.webEvidence = webEvidence;
    const sessionId = persistFinalChatSession(payload, result, content);
    sendJson(res, 200, {
      mode: chatModel?.content ? "chat_model" : "chat_local",
      intent,
      provider: chatModel?.provider || result.provider,
      model: chatModel?.model || result.model,
      sessionId,
      content,
      decisionPanel: result.decisionPanel,
      userContext: result.userContext,
      dataSources: result.dataSources,
      marketSnapshot: result.marketSnapshot,
      newsSnapshot: result.newsSnapshot,
      webEvidence
    });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, { error: error.message || "聊天失败" });
  }
}

function persistFinalChatSession(payload, result, content) {
  const panel = result.decisionPanel;
  const ticker = panel?.ticker || payload.company?.ticker;
  if (!ticker) return payload.sessionId || result.sessionId || null;
  const thread = buildFinalThread(payload.history, payload.question, content);
  try {
    const saved = saveResearchSession({
      id: payload.sessionId || result.sessionId || undefined,
      ticker,
      title: payload.sessionTitle || payload.question || panel?.companyName || ticker,
      question: payload.question || "",
      status: "completed",
      decisionPanel: panel,
      fullResearch: content,
      reportMarkdown: content,
      dataSources: {
        ...result.dataSources,
        webEvidence: result.webEvidence
          ? {
              provider: result.webEvidence.provider,
              intent: result.webEvidence.intent,
              count: result.webEvidence.evidence?.length || 0,
              gaps: result.webEvidence.gaps || []
            }
          : null
      },
      researchStatus: panel?.researchStatus,
      confidence: panel?.confidence,
      thread
    });
    return saved.id;
  } catch (error) {
    console.warn("chat session 持久化失败:", error?.message || error);
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
  if (assistantContent) thread.push({ role: "assistant", content: assistantContent, createdAt: new Date().toISOString() });
  return thread.slice(-80);
}

