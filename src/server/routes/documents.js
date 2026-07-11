/**
 * Document routes — persist and retrieve research documents.
 *
 * GET  /api/documents?ticker=  → list documents
 * GET  /api/documents/:id      → get one document
 * POST /api/documents          → save a parsed document
 * POST /api/parse-document     → (legacy alias) parse + persist
 */

import { readJsonBody, sendOk, sendError } from "../utils/async.js";
import { parseUploadedDocument } from "../../documentParser.js";
import { addDocument, getDocuments, getDocument, deleteDocument } from "../repositories/documentRepository.js";

const userId = (req) => req.echoUser?.id || "local";

export async function handleDocumentList(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker") || null;
    const docs = getDocuments({ ticker, userId: userId(req) });
    sendOk(res, { documents: docs, count: docs.length });
  } catch (error) {
    sendError(res, 500, error.message || "获取文档列表失败");
  }
}

export async function handleDocumentUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const parsed = parseUploadedDocument(body);
    const docId = addDocument({
      ticker: body.ticker || null,
      name: parsed.name,
      mimeType: parsed.type,
      size: parsed.size,
      parser: parsed.parser,
      text: parsed.text,
      summary: parsed.summary,
      sourceType: "upload",
      userId: userId(req)
    });
    sendOk(res, { docId, document: { ...parsed, id: docId } });
  } catch (error) {
    sendError(res, 400, error.message || "文档解析失败");
  }
}

/** Legacy /api/parse-document handler — parse but don't necessarily persist. */
export async function handleDocumentParseApi(req, res) {
  try {
    // 文档以 base64 放进 JSON，单独允许 8MB；其它 API 默认只有 256KB。
    const payload = await readJsonBody(req, { maxBytes: 8_000_000 });
    const parsed = parseUploadedDocument(payload);
    // Also persist if possible
    try {
      const docId = addDocument({
        ticker: payload.ticker || null,
        name: parsed.name,
        mimeType: parsed.type,
        size: parsed.size,
        parser: parsed.parser,
        text: parsed.text,
        summary: parsed.summary,
        sourceType: "upload",
        userId: userId(req)
      });
      parsed.id = docId;
    } catch {}
    sendOk(res, { document: parsed });
  } catch (error) {
    sendError(res, 400, error.message || "资料解析失败");
  }
}

export async function handleDocumentGet(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const doc = getDocument(id, userId(req));
    if (!doc) { sendError(res, 404, "未找到文档"); return; }
    sendOk(res, { document: doc });
  } catch (error) {
    sendError(res, 500, error.message || "获取文档失败");
  }
}

export async function handleDocumentDelete(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const deleted = deleteDocument(id, userId(req));
    if (!deleted) { sendError(res, 404, "未找到文档"); return; }
    sendOk(res, { deleted: true });
  } catch (error) {
    sendError(res, 500, error.message || "删除文档失败");
  }
}
