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
    const valuation = displayValuation(valuationProfile, result.marketSnapshot, result.financialsData, result.estimatesData);
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
    const sessionId = persistFinalChatSession(payload, result, content, {
      valuation: valuation.cannotValueReason ? null : valuation,
      mode: chatModel?.content ? "chat_model" : "chat_local"
    });
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

function persistFinalChatSession(payload, result, content, extra = {}) {
  const panel = result.decisionPanel;
  const ticker = panel?.ticker || payload.company?.ticker;
  if (!ticker) return payload.sessionId || result.sessionId || null;
  // Reconstruct the assistant message meta so a restored session renders exactly
  // like the live answer — including the valuation bar, evidence cards and chips.
  const assistantMeta = {
    mode: extra.mode || "chat_local",
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    confidence: panel?.confidence || null,
    valuation: extra.valuation || null,
    evidence: provenanceFromPanel(panel)
  };
  const thread = buildFinalThread(payload.history, payload.question, content, assistantMeta);
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

function buildFinalThread(history = [], question = "", assistantContent = "", assistantMeta = {}) {
  const thread = Array.isArray(history) ? [...history] : [];
  const normalizedQuestion = String(question || "").trim();
  const last = thread[thread.length - 1];
  if (!(last?.role === "user" && String(last.content || "").trim() === normalizedQuestion)) {
    thread.push({ role: "user", content: question, createdAt: new Date().toISOString() });
  }
  if (assistantContent) {
    thread.push({ role: "assistant", content: assistantContent, meta: assistantMeta, createdAt: new Date().toISOString() });
  }
  return thread.slice(-80);
}

// 服务端复刻前端的 provenance/数据源标签（app.js 同名函数），让恢复历史时
// assistant 消息的 meta（估值条/证据卡/置信度）与实时回答完全一致。
const TYPE_CRED_DEFAULT = { official: 0.9, industry_research: 0.82, financial_media: 0.72, cn_financial_media: 0.6, market: 0.7, news: 0.55, web: 0.45 };

function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function provenanceFromPanel(panel) {
  const sources = Array.isArray(panel?.sources) ? panel.sources : [];
  return sources
    .filter((s) => s.url)
    .slice(0, 6)
    .map((s) => ({
      title: s.label || hostFromUrl(s.url) || "来源",
      url: s.url,
      source: hostFromUrl(s.url) || s.type || "web",
      type: s.type || (s.origin === "web_evidence" ? "web" : "official"),
      cred: typeof s.credibility === "number" ? s.credibility : (TYPE_CRED_DEFAULT[s.type] ?? null),
      date: s.timestamp || ""
    }));
}

function dataSourceLabels(dataSources = {}) {
  const map = { market: "行情", financials: "财报", filings: "公告", news: "新闻", estimates: "预期" };
  return Object.entries(map)
    .filter(([key]) => dataSources?.[key]?.status === "ok")
    .map(([, label]) => label);
}

