/**
 * Research session routes:
 *
 * GET    /api/research/sessions       → list recent sessions
 * DELETE /api/research/sessions       → clear all sessions
 * GET    /api/research/sessions/:id   → get one session (with data)
 * DELETE /api/research/sessions/:id   → delete one session
 * POST   /api/research/sessions/:id/memo → add a memo note
 * GET    /api/research/search?q=      → P7 全文检索历史研究
 */

import { readJsonBody, sendOk, sendError } from "../utils/async.js";
import { listResearchSessions, listConversations, getResearchSession, saveResearchSession, deleteResearchSession, clearResearchSessions, searchResearchSessions } from "../repositories/researchSessions.js";
import { composeReport } from "../services/reportComposer.js";

const userId = (req) => req.echoUser?.id || "local";

export async function handleSessionList(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker") || null;
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
    const sessions = listResearchSessions({ ticker, limit, userId: userId(req) });
    const withPreview = sessions.map(s => ({
      ...s,
      title: s.title || s.question || s.company_name || s.ticker,
      preview: s.question ? String(s.question).slice(0, 120) : "",
      companyName: s.company_name || s.ticker,
      turnCount: s.turn_count || 0,
      // The decision panel and full research are not included in list
    }));
    sendOk(res, { sessions: withPreview, count: withPreview.length });
  } catch (error) {
    sendError(res, 500, error.message || "获取研究会话失败");
  }
}

/**
 * EA-5.1：GET /api/research/conversations —— 按对话分组的侧栏数据源。
 * 一次对话里研究过多家公司时，这里把它们收进同一组（组内按时间顺序列出途经的每家公司），
 * 取代 handleSessionList 的扁平列表，作为研究前端侧栏唯一权威来源。
 */
export async function handleConversationList(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
    const conversations = listConversations({ limit, userId: userId(req) });
    sendOk(res, { conversations, count: conversations.length });
  } catch (error) {
    sendError(res, 500, error.message || "获取对话列表失败");
  }
}

/**
 * P7：GET /api/research/search?q=液冷&limit=20 —— 全文检索历史研究会话（标题/问题/
 * 报告正文/完整对话）。查询串短于 3 个字符时 trigram 索引匹配不到任何结果（子串索引
 * 的固有限制），这里显式告知前端 tooShort，而不是让前端把"没查到"误解成"真没有"。
 */
export async function handleSessionSearch(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
    if (q.length < 3) { sendOk(res, { results: [], count: 0, tooShort: true }); return; }
    const results = searchResearchSessions(q, { limit, userId: userId(req) }).map((r) => ({
      id: r.id,
      ticker: r.ticker,
      title: r.title || r.question || r.company_name || r.ticker,
      companyName: r.company_name || r.ticker,
      status: r.status,
      rating: r.rating,
      confidence: r.confidence,
      turnCount: r.turn_count || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      // 命中片段用两个控制字符当高亮定界符占位符，不是字面 <b> 标签——前端负责
      // 先转义整段文本、再把占位符换成真正的 <b>/</b>，避免命中片段里可能夹带的 HTML
      // 字符被当成标签渲染（存储型 XSS）。
      snippet: (r.snippet_report && r.snippet_report.includes("\u0001") ? r.snippet_report : r.snippet_question) || ""
    }));
    sendOk(res, { results, count: results.length, tooShort: false });
  } catch (error) {
    sendError(res, 500, error.message || "搜索研究历史失败");
  }
}

export async function handleSessionClear(req, res) {
  try {
    const deleted = clearResearchSessions(userId(req));
    sendOk(res, { deleted, cleared: true });
  } catch (error) {
    sendError(res, 500, error.message || "清空研究历史失败");
  }
}

export async function handleSessionGet(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const session = getResearchSession(id, userId(req));
    if (!session) { sendError(res, 404, "未找到研究会话"); return; }
    // Build report
    let report = null;
    if (session.decisionPanel) {
      report = composeReport(session.decisionPanel);
    }
    sendOk(res, { session, report });
  } catch (error) {
    sendError(res, 500, error.message || "获取研究会话失败");
  }
}

export async function handleSessionDelete(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const deleted = deleteResearchSession(id, userId(req));
    if (!deleted) { sendError(res, 404, "未找到研究会话"); return; }
    sendOk(res, { deleted: true, sessionId: id });
  } catch (error) {
    sendError(res, 500, error.message || "删除研究会话失败");
  }
}

export async function handleSessionMemo(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const session = getResearchSession(id, userId(req));
    if (!session) { sendError(res, 404, "未找到研究会话"); return; }

    const body = await readJsonBody(req);
    const memoText = body.memo || body.content || "";
    if (!memoText.trim()) { sendError(res, 400, "备忘录内容不能为空"); return; }

    // Save memo as a lightweight update — store in a memo field
    // (For Phase-2 we just save the session with an updated report_markdown marker.
    // A full memo system would use research_artifacts table.)
    saveResearchSession({
      id,
      ticker: session.ticker,
      question: session.question,
      status: session.status,
      decisionPanel: session.decisionPanel,
      fullResearch: `${session.fullResearch || ""}\n\n## AI 助手备注\n> ${memoText}`,
      reportMarkdown: `${session.reportMarkdown || ""}\n\n---\n*用户备注 (${new Date().toISOString().slice(0, 10)}):*\n${memoText}`,
    }, userId(req));

    sendOk(res, { memo: memoText, sessionId: id });
  } catch (error) {
    sendError(res, 500, error.message || "保存备忘录失败");
  }
}
