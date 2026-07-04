import { readJsonBody, sendJson } from "../utils/async.js";
import { runChat } from "../services/chatOrchestrator.js";

export async function handleChatApi(req, res) {
  let payload;
  try { payload = await readJsonBody(req); }
  catch { return sendJson(res, 400, { error: "请求体解析失败" }); }
  return runChat(payload, res);
}
