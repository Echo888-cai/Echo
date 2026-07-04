// EA-0 统一入口：/api/ask —— 一条对话里的所有问题都从这里进，服务端决定路由。
//
// 这是把散在前端的分流（src/ui/resolve.js 的 discoveryKindOf 镜像）收敛到服务端一处的第一步：
// 后续 EA-1 工具层、EA-2 受控规划器都挂在这个入口上。目前它只做"派发"，不改任何既有行为。
//
// 路由权威信号 = **是否带已解析的 company**：
//   - 带 company → 公司研究（runChat，可能 SSE 流式）。前端只在客户端解析成功后才会带 company，
//     所以"腾讯 PE<20 吗"这类点名公司的估值追问会带 company → 正确落公司管道，不被当成筛选。
//   - 不带 company → 发现层（screener/macro）。服务端用 classifyDiscoveryIntent 自行分类，
//     同时尊重前端已算好的 kind 提示（前端 discoveryKindOf 已先排除点名公司的情况）。
//
// 旧的 /api/chat、/api/discover 暂保留为内部实现（D3 阶段再逐步内化），对外主推 /api/ask。
import { readJsonBody, sendJson } from "../utils/async.js";
import { runChat } from "./chat.js";
import { runDiscover } from "./discover.js";
import { classifyDiscoveryIntent } from "../services/intentClassifier.js";
import { planCompare } from "../services/agentPlanner.js";

/**
 * 决定一条 /api/ask 请求走哪条路由。纯函数，可单测。
 * 返回 "company" | "screener" | "macro"。
 */
export function routeAsk(payload = {}) {
  // 带已解析公司 = 确定的公司问题（前端解析成功才会带），最可靠的信号，优先级最高。
  if (payload.company?.ticker) return "company";
  // 尊重前端已算好的 kind 提示（前端已先排除"点名了公司"的筛选/宏观误判）。
  const hint = payload.kind;
  if (hint === "screener" || hint === "macro" || hint === "company") return hint;
  // 无 company、无提示：服务端自行分类。命中筛选/宏观走发现层，否则兜底公司管道
  // （由公司管道给"未识别公司"的提示，而不是在入口 500）。
  return classifyDiscoveryIntent(String(payload.question || "")) || "company";
}

export async function handleAskApi(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "请求体解析失败" });
  }

  // EA-2：规则优先的受控规划——命中"两标的对比"句式（如"英伟达和 AMD 谁赔率好"）就
  // 自动补上 compareWith，复用既有公司管道；命中不了原样落回下面的既有路由，零行为变更。
  if (!payload.compareWith?.ticker) {
    try {
      const compare = await planCompare(payload.question, {
        primaryCompany: payload.company?.ticker ? payload.company : null
      });
      if (compare) {
        payload = {
          ...payload,
          company: payload.company?.ticker ? payload.company : compare.primary,
          compareWith: compare.secondary,
          plan: compare.plan
        };
      }
    } catch { /* 规划失败静默降级，交给下面既有路由 */ }
  }

  const route = routeAsk(payload);

  // 公司路由：交给 runChat，它自己写 JSON 或 SSE 流式响应（含自身的错误收尾）。
  if (route === "company") return runChat(payload, res);

  // 发现层路由：把服务端决定的 kind 注入 payload，复用 runDiscover。结果对象已带 .kind，
  // 前端 runDiscovery 按 result.kind 渲染 screener/macro，与直连 /api/discover 完全一致。
  try {
    const result = await runDiscover({ ...payload, kind: route });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "查询失败" });
  }
}
