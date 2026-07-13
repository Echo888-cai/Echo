import { readJsonBody, sendOk, sendError } from "../utils/async.js";
import { getUserPreferences, updateUserPreferences } from "../repositories/userPreferencesRepository.js";
import { insertFeedback } from "../repositories/feedbackRepository.js";

const userId = (req) => req.echoUser?.id || "local";

export function handlePreferencesGet(req, res) {
  sendOk(res, { preferences: getUserPreferences(userId(req)) });
}

export async function handlePreferencesUpdate(req, res) {
  try {
    const body = await readJsonBody(req, { maxBytes: 16_000 });
    sendOk(res, { preferences: updateUserPreferences(userId(req), body) });
  } catch (error) {
    sendError(res, 400, error.message || "保存偏好失败");
  }
}

export async function handleFeedbackCreate(req, res) {
  try {
    const body = await readJsonBody(req, { maxBytes: 32_000 });
    const message = String(body.message || "").trim();
    if (message.length < 2) { sendError(res, 400, "请至少写两个字"); return; }
    const context = body.context && typeof body.context === "object" ? body.context : null;
    const id = insertFeedback(userId(req), message, context);
    sendOk(res, { id, received: true });
  } catch (error) {
    sendError(res, 400, error.message || "提交反馈失败");
  }
}
