import { readJsonBody, sendJson } from "../utils/async.js";
import { runChat } from "../services/chatOrchestrator.js";
import { quotaGuard } from "../services/quotaService.js";

export async function handleChatApi(req, res) {
  let payload;
  try { payload = await readJsonBody(req); }
  catch { return sendJson(res, 400, { error: "请求体解析失败" }); }
  payload.userId = req.echoUser?.id || "local";
  const limited = quotaGuard(payload.userId);
  if (limited) return sendJson(res, limited.status, { error: limited.message, code: "QUOTA_EXCEEDED", usage: limited.usage });
  return runChat(payload, res);
}
