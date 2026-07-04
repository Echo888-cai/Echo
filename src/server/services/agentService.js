/**
 * agentService — the heart of the reliability refactor.
 *
 * Pipeline (Phase-1):
 *  1. Collect data sources with timeouts.
 *  2. Parse user question into userContext (cost/shares/horizon).
 *  3. If no model key → return local fallback.
 *  4. Otherwise, call model and try to extract a JSON object.
 *  5. Validate it against `agentDecisionPanelSchema`. If invalid → one
 *     repair attempt. If still invalid → local fallback.
 *  6. Build a clean decision panel via `buildDecisionPanel` (the single
 *     place that hardens all fields, never leaks Markdown).
 *  7. Persist the session to research_sessions.
 */

import { withTimeout } from "../utils/async.js";
import { callModel } from "./modelGateway.js";
import { collectDataSources } from "./dataSources.js";
import { buildDecisionPanel } from "./decisionPanel.js";
import { buildLocalContent } from "./localContent.js";
import { parseUserContext, applyUserContextToMemory, hasUserContext } from "./userContext.js";
import { saveResearchSession } from "../repositories/researchSessions.js";
import { validateAgentPanel, buildRepairPrompt, REPAIR_SYSTEM_PROMPT, RESEARCH_STATUS_VALUES } from "../schemas/agentPanel.js";
import { companyByTicker } from "../../data.js";
import { buildPromptContext } from "../../prompts.js";
import { marketSnapshotToMarkdown } from "../../marketData.js";
import { financialsToMarkdown } from "../../financialData.js";
import { filingsToMarkdown } from "../../filingData.js";
import { analystEstimatesToMarkdown } from "../../financialData.js";
import { newsSnapshotToMarkdown } from "../../newsData.js";
import { PROMPTS } from "../../prompts.js";
import { getProviderStatus } from "./modelGateway.js";
import { beijingMinute } from "../utils/time.js";

const REPAIR_TIMEOUT_MS = 8000;
const MODEL_TIMEOUT_MS = 12000;

/** Extract a JSON object from a model response — even when wrapped in Markdown. */
export function extractJsonObject(text = "") {
  const trimmed = String(text || "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildUserPrompt(input) {
  const { company, question, filings, financialsData, marketSnapshot, newsSnapshot, filingsData, estimatesData, history, memory, documents, userContext } = input;
  const profile = company || { nameZh: "研究对象", ticker: "unknown.HK" };
  const userLine = userContext && (userContext.cost || userContext.shares || userContext.horizon)
    ? `\n用户持仓：成本 ${userContext.cost || "未提供"}，持股 ${userContext.shares || "未提供"} 股，周期 ${userContext.horizon || "未提供"}。`
    : "\n用户未录入持仓。";

  return `当前北京时间：${beijingMinute()}（涉及"今天/最新/盘前"等相对时间时，以此为锚点）

${buildPromptContext(profile, question, filings, financialsData)}

${marketSnapshotToMarkdown(marketSnapshot)}

${financialsToMarkdown(financialsData)}

${filingsToMarkdown(filingsData)}

${analystEstimatesToMarkdown(estimatesData)}

${newsSnapshotToMarkdown(newsSnapshot)}

${historyToMarkdown(history)}
${userLine}
${memoryToMarkdown(memory)}
${documentsToMarkdown(documents)}

核心规则：只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要表格。
JSON 字段必须包含：
{
  "ticker": "",
  "companyName": "",
  "researchStatus": "watch|research_more|data_missing|risk_alert|out_of_scope",
  "confidence": "高|中|低",
  "dataCompleteness": 0-100,
  "oneLineView": "≤120字",
  "action": "≤60字",
  "userContext": { "cost": null|"", "shares": null|"", "horizon": null|"", "note": "" },
  "price": { "value": "", "change": "", "source": "", "timestamp": "", "evidence": [...] },
  "metrics": [{ "name": "", "value": "", "note": "", "evidence": [...] }],
  "keyDrivers": [
    { "name": "价格信号|基本面|估值|股东回报|风险信号", "status": "", "summary": "≤60字", "evidence": [...] },
    ... 共 5 项
  ],
  "connectedData": [],
  "missingData": [],
  "riskTriggers": [{ "label": "", "evidence": [...] }],
  "sources": [{ "label": "", "url": "", "type": "", "timestamp": "" }],
  "evidence": [...],
  "details": { "overview": [], "financials": [], "valuation": [], "risks": [], "sources": [] },
  "fullResearch": ""
}

每个 evidence 项必须含：source、asOf(可空)、quote(可空)、status(可空)、confidence(高/中/低)、missingReason。
当数据缺失时，missingReason 必须写具体原因，例如"未获取实时行情（已 timeout）"。

严格规则：
- researchStatus 只允许枚举值。
- keyDrivers 必须正好 5 张卡，每张 1 个 status + 1 句 summary + 至少 1 个 evidence。
- 数据缺失维度不能参与评分，写"暂不评分 —— [原因]"，禁止打 5/10 敷衍。
- 新闻源 0 条不等于中性，写"新闻源不可用"。
- 用户未录入持仓时，userContext 全为空，missingData 列出"用户成本价/持股数/投资周期"。
- 如果有异常持仓（如成本为 1），必须把对应 userContext 字段置 null 并 missingReason 说明。
- 禁止"我会先…""让我来分析…"等开场白。
- 严禁 Markdown 表格、代码块、注释、键名拼写错误。直接输出 JSON。
- fullResearch 不要使用 Markdown 表格。`;
}

function documentsToMarkdown(documents = []) {
  if (!documents.length) return "## 用户上传资料\n- 本轮未上传资料。";
  return `## 用户上传资料\n${documents
    .slice(-6)
    .map((doc, index) => `### ${index + 1}. ${doc.name || "未命名资料"}\n解析器：${doc.parser || "unknown"}\n${String(doc.text || doc.summary || "").slice(0, 2200)}`)
    .join("\n\n")}`;
}

function historyToMarkdown(history = []) {
  if (!history.length) return "## 最近对话\n- 无。";
  return `## 最近对话\n${history
    .slice(-12)
    .map((m) => `- ${m.role === "user" ? "用户" : "助手"}：${String(m.content || "").replace(/\s+/g, " ").slice(0, 800)}`)
    .join("\n")}`;
}

function memoryToMarkdown(memory = {}) {
  const positions = Object.values(memory.positions || {});
  const lines = [
    memory.horizon ? `- 投资周期：${memory.horizon}` : "",
    memory.riskPreference ? `- 风险偏好：${memory.riskPreference}` : "",
    positions.length
      ? `- 已知持仓/成本：${positions.map((p) => `${p.ticker}${p.cost ? ` 成本${p.cost}` : ""}${p.shares ? ` ${p.shares}股` : ""}`).join("；")}`
      : "",
    Array.isArray(memory.focusTopics) && memory.focusTopics.length ? `- 长期关注：${memory.focusTopics.slice(-8).join("；")}` : ""
  ].filter(Boolean);
  return `## 用户长期记忆\n${lines.length ? lines.join("\n") : "- 暂无沉淀记忆。"}`;
}

/**
 * Main entry point. Returns a uniform object that the route can serialize.
 * Shape:
 *   {
 *     mode: "model" | "local" | "repair_failed" | "model_key_missing",
 *     provider?, model?,
 *     decisionPanel, marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData,
 *     content (long-form markdown),
 *     dataSources,
 *     userContext,
 *     repaired (bool)
 *   }
 */
export async function runAgent(input, options = {}) {
  // persist: write the session to SQLite here. Chat route persists once itself, so it passes persist:false.
  // useModelPanel: call the model to produce the structured JSON panel. Chat builds a deterministic
  //   local panel and uses a single model call for the prose instead, so it passes useModelPanel:false.
  const { persist = true, useModelPanel = true } = options;
  const {
    question = "",
    company,
    filings = [],
    marketSnapshot: suppliedMarketSnapshot = null,
    history = [],
    memory = {},
    documents = [],
    sessionId = null,
    sessionTitle = "",
    conversationId = null
  } = input || {};
  if (!company?.ticker) {
    const err = new Error("缺少公司上下文");
    err.statusCode = 400;
    throw err;
  }

  // 1. Parse user context from question and merge into memory so it propagates.
  const userContext = parseUserContext(question);
  const updatedMemory = applyUserContextToMemory(memory, company.ticker, userContext);
  const effectiveMemory = { ...updatedMemory, horizon: updatedMemory.horizon || userContext.horizon || "" };

  // 2. Collect data sources with timeouts.
  const data = await collectDataSources({ company, suppliedMarketSnapshot });

  // Enrich company name for bare tickers (e.g. "RKLB" → "Rocket Lab USA") using
  // the FMP profile fetched in parallel by collectDataSources.
  const resolvedName = data.companyProfile?.companyName;
  const enrichedCompany = resolvedName && company.nameZh === company.ticker
    ? { ...company, nameZh: resolvedName, nameEn: resolvedName }
    : company;

  // 3. Local-panel path: no key, or the caller (chat) wants a deterministic panel + its own single model call.
  const providerStatus = getProviderStatus();
  if (!useModelPanel || !providerStatus.configured) {
    return assembleLocal({
      question, company: enrichedCompany, filings, marketSnapshot: data.marketSnapshot, newsSnapshot: data.newsSnapshot,
      financialsData: data.financialsData, filingsData: data.filingsData, estimatesData: data.estimatesData,
      documents, memory: effectiveMemory, userContext,
      mode: providerStatus.configured ? "local_panel" : "model_key_missing", dataSources: data,
      history, sessionId, sessionTitle, conversationId, persist
    });
  }

  // 4. First pass — call the model.
  const profile = companyByTicker(enrichedCompany.ticker) || enrichedCompany;
  const userPrompt = buildUserPrompt({
    company: profile,
    question, filings,
    financialsData: data.financialsData,
    marketSnapshot: data.marketSnapshot,
    newsSnapshot: data.newsSnapshot,
    filingsData: data.filingsData,
    estimatesData: data.estimatesData,
    history, memory: effectiveMemory, documents, userContext
  });

  let firstCall;
  try {
    firstCall = await withTimeout(callModel({ system: PROMPTS.cio.system, user: userPrompt }), MODEL_TIMEOUT_MS, null);
  } catch (err) {
    firstCall = null;
  }
  const firstCandidate = extractJsonObject(firstCall?.content || "");
  let firstValidation = firstCandidate ? validateAgentPanel(firstCandidate) : { valid: false, errors: [{ path: "$", message: "模型未返回 JSON" }] };

  let modelPanel = firstValidation.valid ? firstValidation.value : null;
  let repaired = false;
  let modelResult = firstCall;

  // 5. Repair-once if the first pass failed validation.
  if (!firstValidation.valid && firstCall?.content) {
    try {
      const repairUser = buildRepairPrompt(firstValidation.errors, firstCall.content);
      const repairCall = await withTimeout(callModel({ system: REPAIR_SYSTEM_PROMPT, user: repairUser }), REPAIR_TIMEOUT_MS, null);
      const repairCandidate = extractJsonObject(repairCall?.content || "");
      if (repairCandidate) {
        const repairValidation = validateAgentPanel(repairCandidate);
        if (repairValidation.valid) {
          modelPanel = repairValidation.value;
          repaired = true;
          modelResult = repairCall;
        }
      }
    } catch {
      // ignore — fall through to local fallback
    }
  }

  // 6. If both passes failed → local fallback (never leak dirty Markdown).
  if (!modelPanel) {
    return assembleLocal({
      question, company: enrichedCompany, filings,
      marketSnapshot: data.marketSnapshot, newsSnapshot: data.newsSnapshot,
      financialsData: data.financialsData, filingsData: data.filingsData, estimatesData: data.estimatesData,
      documents, memory: effectiveMemory, userContext, mode: "repair_failed", dataSources: data,
      history, sessionId, sessionTitle, conversationId, persist
    });
  }

  // 7. Build the final panel. We force userContext = our parsed one, never the model's.
  const decisionPanel = buildDecisionPanel({
    question, company: profile, userContext,
    marketSnapshot: data.marketSnapshot, newsSnapshot: data.newsSnapshot,
    financialsData: data.financialsData, filingsData: data.filingsData, estimatesData: data.estimatesData,
    filings, modelPanel, fullResearch: modelPanel.fullResearch || ""
  });

  const localContent = buildLocalContent({
    question, company: profile, filings,
    marketSnapshot: data.marketSnapshot, newsSnapshot: data.newsSnapshot,
    documents, memory: effectiveMemory, financialsData: data.financialsData,
    filingsData: data.filingsData, estimatesData: data.estimatesData, userContext
  });

  const result = {
    mode: "model",
    provider: modelResult?.provider,
    model: modelResult?.model,
    repaired,
    marketSnapshot: data.marketSnapshot,
    newsSnapshot: data.newsSnapshot,
    financialsData: data.financialsData,
    filingsData: data.filingsData,
    estimatesData: data.estimatesData,
    decisionPanel: { ...decisionPanel, fullResearch: decisionPanel.fullResearch || localContent },
    content: decisionPanel.fullResearch || localContent,
    userContext,
    dataSources: summarizeDataSources(data)
  };

  result.sessionId = persist
    ? persistSession(result, profile, { question, userContext, repaired, sessionId, sessionTitle, conversationId, history })
    : (sessionId || null);
  return result;
}

function assembleLocal({ question, company, filings, marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData, documents, memory, userContext, mode, dataSources, history = [], sessionId = null, sessionTitle = "", conversationId = null, persist = true }) {
  const profile = companyByTicker(company.ticker) || company;
  const localContent = buildLocalContent({
    question, company: profile, filings,
    marketSnapshot, newsSnapshot, documents, memory,
    financialsData, filingsData, estimatesData, userContext
  });
  const decisionPanel = buildDecisionPanel({
    question, company: profile, userContext,
    marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData,
    filings, modelPanel: null, fullResearch: localContent
  });

  const result = {
    mode,
    marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData,
    decisionPanel,
    content: localContent,
    userContext,
    dataSources: summarizeDataSources(dataSources)
  };

  result.sessionId = persist
    ? persistSession(result, profile, { question, userContext, repaired: false, sessionId, sessionTitle, conversationId, history })
    : (sessionId || null);
  return result;
}

function summarizeDataSources({ marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData }) {
  return {
    market: { provider: marketSnapshot?.source || "未接入", status: marketSnapshot?.providerStatus || "missing", asOf: marketSnapshot?.asOf || null },
    news: { provider: newsSnapshot?.source || "未接入", status: newsSnapshot?.providerStatus || "missing", asOf: newsSnapshot?.asOf || null, count: (newsSnapshot?.articles || []).length },
    financials: { provider: financialsData?.source || "未接入", status: financialsData?.providerStatus || "missing", asOf: financialsData?.asOf || null },
    filings: { provider: filingsData?.source || "未接入", status: filingsData?.providerStatus || "missing", asOf: filingsData?.asOf || null, count: (filingsData?.filings || []).length },
    estimates: { provider: estimatesData?.source || "未接入", status: estimatesData?.providerStatus || "missing", asOf: estimatesData?.asOf || null }
  };
}

function sessionThread(history = [], question = "", content = "") {
  const thread = Array.isArray(history) ? [...history] : [];
  const last = thread[thread.length - 1];
  if (!(last?.role === "user" && String(last.content || "").trim() === String(question || "").trim())) {
    thread.push({ role: "user", content: question, createdAt: new Date().toISOString() });
  }
  if (content) thread.push({ role: "assistant", content, createdAt: new Date().toISOString() });
  return thread;
}

function persistSession(result, profile, { question, userContext, repaired, sessionId, sessionTitle, conversationId, history }) {
  try {
    const saved = saveResearchSession({
      id: sessionId || undefined,
      ticker: profile.ticker,
      conversationId: conversationId || undefined,
      title: sessionTitle || question,
      question,
      status: result.mode === "model" ? "completed" : "completed",
      decisionPanel: result.decisionPanel,
      fullResearch: result.content,
      reportMarkdown: result.content,
      dataSources: result.dataSources,
      researchStatus: result.decisionPanel?.researchStatus,
      confidence: result.decisionPanel?.confidence,
      thread: sessionThread(history, question, result.content)
    });
    return saved.id;
  } catch (err) {
    // Persistence is best-effort. Don't break the response.
    console.warn("research_sessions 持久化失败:", err?.message || err);
    return sessionId || null;
  }
}

export { RESEARCH_STATUS_VALUES };
