// P6 发现层路由：/api/discover —— 筛选器 + 宏观，两类"不绑定公司"的问题。
import { readJsonBody, sendJson } from "../utils/async.js";
import { classifyDiscoveryIntent } from "../services/intentClassifier.js";
import { runScreener, runMacro } from "../services/discovery.js";

// EA-0：从 handleDiscoverApi 抽出的可复用核心。/api/discover 与统一入口 /api/ask 共用它；
// 也是后续 EA-1 工具层 screenStocks()/macroRead() 的落点。payload 已解析，返回结果对象；
// 缺 question 或非发现层问题时抛带 statusCode 的错误，由调用方转成 HTTP 响应。
export async function runDiscover(payload) {
  const question = String(payload.question || "").trim();
  if (!question) {
    /** @type {Error & {statusCode?: number}} */
    const err = new Error("缺少 question");
    err.statusCode = 400;
    throw err;
  }
  const kind = payload.kind || classifyDiscoveryIntent(question);
  if (kind === "screener") return runScreener(question, payload.userId || "local");
  if (kind === "macro") return runMacro(question);
  /** @type {Error & {statusCode?: number}} */
  const err = new Error("这不是筛选或宏观问题，请走公司研究通道。");
  err.statusCode = 400;
  throw err;
}

export async function handleDiscoverApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    payload.userId = req.echoUser?.id || "local";
    sendJson(res, 200, await runDiscover(payload));
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "发现层查询失败" });
  }
}
