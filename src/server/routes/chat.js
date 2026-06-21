import { readJsonBody, sendJson, withTimeout } from "../utils/async.js";
import { runAgent } from "../services/agentService.js";
import { getProviderStatus } from "../services/modelGateway.js";
import { companyByTicker } from "../../data.js";
import { saveResearchSession } from "../repositories/researchSessions.js";
import { classifyResearchIntent } from "../services/intentClassifier.js";
import { researchWebEvidence } from "../services/webEvidenceService.js";
import { researchReplyFromPanel, normalizeResearchAnswer, mergeEvidenceIntoPanel } from "../services/answerComposer.js";
import { displayValuation } from "../services/valuationEngine.js";
import { PROMPTS } from "../../prompts.js";
import { loadPortraitContext, updatePortraitFromPanel } from "../services/companyPortrait.js";
import { runTwoStageChat } from "../services/twoStageChat.js";
import { upsertPosition } from "../repositories/portfolio.js";

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

    // Compute valuation before the model call so the prose and the visual bar
    // speak the same odds.
    const valuationProfile = companyByTicker(result.decisionPanel?.ticker || payload.company?.ticker) || payload.company;
    const valuation = displayValuation(valuationProfile, result.marketSnapshot, result.financialsData);
    // 长期画像：研究同一公司时自动带上上次沉淀的投资主线/证伪条件，保持连贯。
    const portraitTicker = result.decisionPanel?.ticker || payload.company?.ticker;
    const context = {
      newsSnapshot: result.newsSnapshot,
      webEvidence,
      financialsData: result.financialsData,
      marketSnapshot: result.marketSnapshot,
      valuation: valuation.cannotValueReason ? null : valuation,
      portraitContext: portraitTicker ? loadPortraitContext(portraitTicker) : ""
    };
    const fallback = researchReplyFromPanel(result.decisionPanel, question, result.dataSources, context);
    let content = fallback;
    let chatModel = null;
    // Two-stage: search-triage agent produces a verified research note, then the
    // answer agent writes from it. Falls back to single-stage / local reply on timeout.
    if (getProviderStatus().configured && result.decisionPanel) {
      chatModel = await runTwoStageChat({
        question,
        panel: result.decisionPanel,
        dataSources: result.dataSources,
        context,
        system: PROMPTS.chat.system
      });
      if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
    }
    content = normalizeResearchAnswer(content, result.decisionPanel, result.dataSources);
    result.webEvidence = webEvidence;
    mergeEvidenceIntoPanel(result.decisionPanel, webEvidence);
    if (result.decisionPanel && !valuation.cannotValueReason) result.decisionPanel.valuation = valuation;
    // 自然语言记账：识别到成本/股数/止损/止盈就 upsert 到持仓账本（持久化）。
    let positionSaved = false;
    const uc = result.userContext || {};
    if (portraitTicker && (uc.cost || uc.shares || uc.stopLoss || uc.takeProfit)) {
      try {
        upsertPosition(portraitTicker, {
          companyName: result.decisionPanel?.companyName || payload.company?.nameZh,
          shares: uc.shares != null ? Number(uc.shares) : undefined,
          avgCost: uc.cost != null ? Number(uc.cost) : undefined,
          stopLoss: uc.stopLoss != null ? Number(uc.stopLoss) : undefined,
          takeProfit: uc.takeProfit != null ? Number(uc.takeProfit) : undefined
        });
        positionSaved = true;
      } catch (err) {
        console.warn("portfolio 记账失败:", err?.message || err);
      }
    }

    // 回写长期画像：判断变化时追加事件日志，否则只累计研究轮次。
    let portrait = null;
    if (portraitTicker && result.decisionPanel) {
      try {
        portrait = updatePortraitFromPanel({
          ticker: portraitTicker,
          panel: result.decisionPanel,
          valuation: valuation.cannotValueReason ? null : valuation,
          question
        });
      } catch (err) {
        console.warn("company_profile 回写失败:", err?.message || err);
      }
    }
    const sessionId = persistFinalChatSession(payload, result, content);
    sendJson(res, 200, {
      mode: chatModel?.content ? "chat_model" : "chat_local",
      stages: chatModel?.stages || "none",
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
      valuation: valuation.cannotValueReason ? null : valuation,
      webEvidence,
      portrait: portrait
        ? { ticker: portraitTicker, created: portrait.created, changed: portrait.changed, turnCount: portrait.profile?.turnCount || 0 }
        : null,
      positionSaved
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
      companyName: panel?.companyName || payload.company?.nameZh || payload.company?.name || ticker,
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

