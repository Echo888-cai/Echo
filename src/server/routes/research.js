/**
 * Research session routes:
 *
 * GET    /api/research/sessions       → list recent sessions
 * DELETE /api/research/sessions       → clear all sessions
 * GET    /api/research/sessions/:id   → get one session (with data)
 * DELETE /api/research/sessions/:id   → delete one session
 * POST   /api/research/sessions/:id/memo → add a memo note
 */

import { readJsonBody, sendOk, sendError } from "../utils/async.js";
import { listResearchSessions, listConversations, getResearchSession, saveResearchSession, deleteResearchSession, clearResearchSessions } from "../repositories/researchSessions.js";
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
