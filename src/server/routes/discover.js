// P6 发现层路由：/api/discover —— 筛选器 + 宏观，两类"不绑定公司"的问题。
import { readJsonBody, sendJson } from "../utils/async.js";
import { classifyDiscoveryIntent } from "../services/intentClassifier.js";
import { runScreener, runMacro } from "../services/discovery.js";

export async function handleDiscoverApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const question = String(payload.question || "").trim();
    if (!question) {
      sendJson(res, 400, { error: "缺少 question" });
      return;
    }
    const kind = payload.kind || classifyDiscoveryIntent(question);
    if (kind === "screener") {
      sendJson(res, 200, await runScreener(question));
      return;
    }
    if (kind === "macro") {
      sendJson(res, 200, await runMacro(question));
      return;
    }
    sendJson(res, 400, { error: "这不是筛选或宏观问题，请走公司研究通道。" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "发现层查询失败" });
  }
}
