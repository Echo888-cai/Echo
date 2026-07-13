import { sendJson } from "../utils/async.js";
import { buildStatusSnapshot } from "../services/statusSnapshot.js";

export function handleStatusApi(req, res) {
  const userId = req.echoUser?.id || "local";
  sendJson(res, 200, buildStatusSnapshot(userId));
}
