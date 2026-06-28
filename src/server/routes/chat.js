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
import { runTwoStageChat, runTwoStageChatStream } from "../services/twoStageChat.js";
import { upsertPosition } from "../repositories/portfolio.js";
import { getMarketSnapshot, getRangeReturns } from "../../marketData.js";
import { getFinancials, getAnalystEstimates } from "../../financialData.js";

// 对话内对比：只拉"对比对象"做并排比较真正需要的几项（行情/区间回报/财报/评级），
// 不跑 news/filings/segments——精简后更快，避免和主公司的全量管道并发争抢时超时拿不到数据
// （之前用 collectDataSources 全量跑，并发下常超时→对比块为空，模型只能说"未核到对方数据"）。
async function buildCompareSummary(compareWith) {
  const company = companyByTicker(compareWith.ticker) || compareWith;
  if (!company?.ticker) return null;
  const t = company.ticker;
  const [ms, ranges, fin, est] = await Promise.all([
    withTimeout(getMarketSnapshot(t), 6000, null),
    withTimeout(getRangeReturns(t), 6000, { providerStatus: "missing" }),
    withTimeout(getFinancials(t), 8000, { providerStatus: "missing" }),
    withTimeout(getAnalystEstimates(t), 6000, { providerStatus: "missing" })
  ]);
  if (!ms || ms.providerStatus !== "ok") return null; // 连行情都没有就别给半截对比
  if (ranges?.providerStatus === "ok") ms.ranges = ranges;
  const valuation = displayValuation(companyByTicker(t) || company, ms, fin, est);
  const analyst = buildAnalystSummary(est, ms.price);
  return {
    ticker: t,
    name: company.nameZh || company.name || t,
    marketSnapshot: ms,
    financialsData: fin,
    valuation: valuation.cannotValueReason ? null : valuation,
    analyst
  };
}

export async function handleChatApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const question = payload.question || "";
    const intent = classifyResearchIntent(question);
    const companyForEvidence = companyByTicker(payload.company?.ticker) || payload.company || {};

    // 对话内对比：用户点了"在本对话里对比"时带上 compareWith，并行把对比对象也跑一遍。
    const compareWith = payload.compareWith?.ticker ? payload.compareWith : null;

    // Single pipeline: data + deterministic local panel (no model, no persist here) runs in
    // parallel with web-evidence retrieval. The model is only called once, for the prose below.
    const [result, webEvidence, compareData] = await Promise.all([
      runAgent(payload, { persist: false, useModelPanel: false }),
      withTimeout(
        researchWebEvidence({ company: companyForEvidence, question, intent }),
        9000,
        { intent, queries: [], evidence: [], gaps: ["网页证据检索超时，本轮先使用本地档案和已接入数据。"], provider: "timeout", searchedAt: new Date().toISOString() }
      ),
      compareWith ? withTimeout(buildCompareSummary(compareWith), 12000, null) : Promise.resolve(null)
    ]);

    // Compute valuation before the model call so the prose and the visual bar
    // speak the same odds.
    const valuationProfile = companyByTicker(result.decisionPanel?.ticker || payload.company?.ticker) || payload.company;
    const valuation = displayValuation(valuationProfile, result.marketSnapshot, result.financialsData, result.estimatesData);
    const analyst = buildAnalystSummary(result.estimatesData, result.marketSnapshot?.price);
    // 长期画像：研究同一公司时自动带上上次沉淀的投资主线/证伪条件，保持连贯。
    const portraitTicker = result.decisionPanel?.ticker || payload.company?.ticker;
    const context = {
      newsSnapshot: result.newsSnapshot,
      webEvidence,
      financialsData: result.financialsData,
      marketSnapshot: result.marketSnapshot,
      valuation: valuation.cannotValueReason ? null : valuation,
      portraitContext: portraitTicker ? loadPortraitContext(portraitTicker) : "",
      // 最近几轮对话，注入作答 prompt 让追问能承接上文（连续对话能力）。
      history: Array.isArray(payload.history) ? payload.history : [],
      // 对话内对比对象（拿到才有；buildChatPrompt 会渲染并排比较块 + 切到对比作答规则）。
      compare: compareData
    };
    const fallback = researchReplyFromPanel(result.decisionPanel, question, result.dataSources, context);
    const wantStream = payload.stream === true;
    const modelReady = getProviderStatus().configured && result.decisionPanel;
    let content = fallback;
    let chatModel = null;

    // ── 流式（SSE）：阶段2 答案逐字推送，收尾再发一个 final 事件携带完整面板/估值/接地 ──
    if (wantStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no" // 反代不缓冲，token 才能实时吐出
      });
      const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 客户端断开 */ } };
      send("status", { stage: modelReady ? "generating" : "local" });
      if (modelReady) {
        chatModel = await runTwoStageChatStream({
          question, panel: result.decisionPanel, dataSources: result.dataSources, context,
          system: PROMPTS.chat.system,
          onToken: (t) => send("token", { t }),
          onReasoning: (t) => send("reasoning", { n: t.length }) // 只送字数，不送思考原文
        });
        if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
      }
      const finalPayload = finalizeChat({ payload, result, webEvidence, valuation, analyst, portraitTicker, intent, content, chatModel });
      send("final", finalPayload);
      try { res.write("event: done\ndata: {}\n\n"); res.end(); } catch { /* already closed */ }
      return;
    }

    // ── 非流式（JSON）：保留原行为，作为前端不支持流式时的回退 ──
    if (modelReady) {
      chatModel = await runTwoStageChat({
        question,
        panel: result.decisionPanel,
        dataSources: result.dataSources,
        context,
        system: PROMPTS.chat.system
      });
      if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
    }
    sendJson(res, 200, finalizeChat({ payload, result, webEvidence, valuation, analyst, portraitTicker, intent, content, chatModel }));
  } catch (error) {
    // 流式已经开了头就不能再 sendJson —— 改发一个 error 事件收尾。
    if (res.headersSent) {
      try { res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || "聊天失败" })}\n\n`); res.end(); } catch { /* closed */ }
    } else {
      const status = error.statusCode || 500;
      sendJson(res, status, { error: error.message || "聊天失败" });
    }
  }
}

// 模型作答之后的统一收口：归一化 → 证据并入面板 → 估值挂载 → 自然语言记账 → 画像回写 →
// 落库，返回前端要的完整响应对象。流式 / 非流式共用，保证两条路径产物完全一致。
function finalizeChat({ payload, result, webEvidence, valuation, analyst, portraitTicker, intent, content, chatModel }) {
  const question = payload.question || "";
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
    analyst,
    mode: chatModel?.content ? "chat_model" : "chat_local"
  });

  return {
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
    analyst,
    webEvidence,
    portrait: portrait
      ? { ticker: portraitTicker, created: portrait.created, changed: portrait.changed, turnCount: portrait.profile?.turnCount || 0 }
      : null,
    positionSaved
  };
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
    grounding: dataSourceGrounding(result.dataSources),
    completeness: typeof panel?.dataCompleteness === "number" ? panel.dataCompleteness : null,
    missing: Array.isArray(panel?.missingData) ? panel.missingData : [],
    confidence: panel?.confidence || null,
    valuation: extra.valuation || null,
    analyst: extra.analyst || null,
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

// 接地条用的逐槽 ✓/✗（前端 app.js 同名函数的服务端复刻，让恢复历史时一致）。
// 固定 4 个核心槽，公告只在接入时追加，避免美股恒显"公告✗"。
function dataSourceGrounding(dataSources = {}) {
  const core = [["market", "行情"], ["financials", "财报"], ["news", "新闻"], ["estimates", "预期"]];
  const slots = core.map(([key, label]) => ({ label, ok: dataSources?.[key]?.status === "ok" }));
  if (dataSources?.filings?.status === "ok") slots.push({ label: "公告", ok: true });
  return slots;
}

// 把分析师评级数据收成前端要的紧凑结构：买卖分布 + 共识方向 + 一致目标价/上行空间。
// 分布来自 Finnhub recommendation（免费稳定），目标价来自 Yahoo 兜底（尽力而为）。
function buildAnalystSummary(estimates, price) {
  if (!estimates || estimates.providerStatus !== "ok") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const counts = [estimates.strongBuy, estimates.buy, estimates.hold, estimates.sell, estimates.strongSell];
  const hasDist = counts.some((n) => typeof n === "number");
  const buy = (estimates.strongBuy || 0) + (estimates.buy || 0);
  const hold = estimates.hold || 0;
  const sell = (estimates.sell || 0) + (estimates.strongSell || 0);
  const total = buy + hold + sell;
  const target = num(estimates.consensusTargetPrice) ?? num(estimates.targetMedian);
  const p = num(price);
  const upsidePct = target && p ? Number((((target - p) / p) * 100).toFixed(1)) : null;
  if (!hasDist && !target) return null;
  return {
    distribution: hasDist && total ? { buy, hold, sell, total } : null,
    consensus: estimates.consensus || null,
    target,
    targetLow: num(estimates.targetLow),
    targetHigh: num(estimates.targetHigh),
    analysts: num(estimates.numberOfAnalysts),
    upsidePct,
    source: estimates.source || "评级源"
  };
}

