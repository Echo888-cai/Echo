/**
 * Agent routes:
 *   POST /api/agent           — main research orchestrator (full pipeline)
 *   POST /api/agent/followup  — contextual follow-up without re-fetching data
 */

import { readJsonBody, sendError, sendJson } from "../utils/async.js";
import { withTimeout } from "../utils/async.js";
import { callModel } from "../services/modelGateway.js";
import { PROMPTS } from "../../prompts.js";
import { runAgent } from "../services/agentService.js";

// ── Main research endpoint ───────────────────────────────────

export async function handleAgentApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = await runAgent(payload);
    sendJson(res, 200, result);
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, { error: error.message || "服务端错误" });
  }
}

// ── Follow-up endpoint (uses existing context, no re-fetch) ──

export async function handleAgentFollowup(req, res) {
  try {
    const payload = await readJsonBody(req);
    const { question = "", history = [], decisionPanel = null, dataSources = {} } = payload;
    const ticker = decisionPanel?.ticker || "";
    const companyName = decisionPanel?.companyName || "研究对象";

    if (!question.trim()) {
      sendJson(res, 200, { mode: "local", content: "请先输入问题。", decisionPanel });
      return;
    }

    const hasModelKey = Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.GLM_API_KEY || process.env.MODEL_API_KEY);

    if (!hasModelKey) {
      const localReply = generateLocalFollowup(question, decisionPanel);
      sendJson(res, 200, { mode: "local", content: localReply, decisionPanel });
      return;
    }

    const context = buildFollowupContext(question, decisionPanel, dataSources);
    const modelResult = await withTimeout(callModel({
      system: PROMPTS.cio.system,
      user: context
    }), 18000, null);

    if (modelResult?.content) {
      sendJson(res, 200, { mode: "model", provider: modelResult.provider, model: modelResult.model, content: modelResult.content, decisionPanel });
    } else {
      const localReply = generateLocalFollowup(question, decisionPanel);
      sendJson(res, 200, { mode: "local_fallback", content: localReply, decisionPanel });
    }
  } catch (error) {
    sendError(res, 500, error.message || "跟进问题响应失败");
  }
}

function buildFollowupContext(question, panel, ds) {
  const ticker = panel?.ticker || "";
  const name = panel?.companyName || "研究对象";
  const drivers = Array.isArray(panel?.keyDrivers) ? panel.keyDrivers : [];
  const missing = Array.isArray(panel?.missingData) ? panel.missingData : [];
  const evidence = Array.isArray(panel?.evidence) ? panel.evidence : [];
  const connected = Array.isArray(panel?.connectedData) ? panel.connectedData : [];
  const userCtx = panel?.userContext || {};

  return `你正在为 ${name}（${ticker}）回答用户跟进问题。

## 当前研究状态
- 研究状态：${panel?.researchStatus || "待定"}
- 信心：${panel?.confidence || "低"}
- 数据完整度：${panel?.dataCompleteness ?? 0}%
- 一句话判断：${panel?.oneLineView || "暂无"}

## 用户上下文
${userCtx.cost ? `- 成本价：${userCtx.cost}${userCtx.shares ? `，持股 ${userCtx.shares} 股` : ""}` : "- 未录入持仓"}
${userCtx.horizon ? `- 投资周期：${userCtx.horizon}` : ""}

## 数据源状态
已接入：${connected.join("、") || "无"}
缺失：${missing.join("、") || "无"}

## 关键判断
${drivers.map(d => `- ${d.name}：${d.status}。${d.summary}`).join("\n")}

## 证据
${evidence.slice(0, 5).map(e => `- 来源：${e.source}，可信度：${e.confidence}${e.missingReason !== "无" ? `，缺失：${e.missingReason}` : ""}`).join("\n") || "- 暂无证据"}

## 数据明细
${ds?.market ? `行情：${ds.market.provider || "未接入"}（${ds.market.status}）` : ""}
${ds?.news ? `新闻：${ds.news.provider || "未接入"}（${ds.news.status}，${ds.news.count ?? 0} 条）` : ""}
${ds?.financials ? `财务：${ds.financials.provider || "未接入"}（${ds.financials.status}）` : ""}

## 用户跟进问题
${question}

## 回答规则
- 使用简洁的自然语言，引用已有研究判断和缺失数据状态。
- 数据缺失时明确说明"暂不可评"并给出补数据建议。
- 禁止买入/卖出/持有建议，转换为"研究状态"和"验证动作"。
- 直接回答，不要开场白。如果问题超出当前数据范围，告诉用户需要补充什么。`;
}

function generateLocalFollowup(question, panel) {
  const name = panel?.companyName || "研究对象";
  const drivers = Array.isArray(panel?.keyDrivers) ? panel.keyDrivers : [];
  const missing = Array.isArray(panel?.missingData) ? panel.missingData : [];
  const missingStr = missing.length ? `缺失：${missing.join("、")}` : "无缺失项";
  const completeness = panel?.dataCompleteness ?? 0;

  const lines = [`**关于 ${name} 的跟进分析**`, ""];

  const lowerQ = question.toLowerCase();
  const driverMatch = drivers.find(d =>
    lowerQ.includes(d.name) ||
    (d.name === "基本面" && /利润|营收|增长|毛利|FCF/i.test(lowerQ)) ||
    (d.name === "估值" && /估|贵|便宜|PE|目标/i.test(lowerQ)) ||
    (d.name === "风险信号" && /风险|监管|竞争|安全/i.test(lowerQ)) ||
    (d.name === "股东回报" && /回购|分红|回报/i.test(lowerQ)) ||
    (d.name === "价格信号" && /价格|行情|涨跌/i.test(lowerQ))
  );

  if (driverMatch) {
    lines.push(`**${driverMatch.name}**：${driverMatch.status}。${driverMatch.summary}`);
    if (driverMatch.evidence?.length) {
      const missingEvidence = driverMatch.evidence.filter(e => e.missingReason !== "无");
      if (missingEvidence.length) {
        lines.push(`数据缺口：${missingEvidence.map(e => e.missingReason).filter(Boolean).join("；")}`);
      }
    }
  } else if (/对比|vs|versus/i.test(lowerQ)) {
    lines.push(`多公司对比暂未接入完整数据管道。建议先完成单家公司的独立研究。`);
  } else {
    lines.push(`数据完整度 ${completeness}%。${missingStr}`);
    if (drivers.length) {
      lines.push(`**关键判断**：`);
      drivers.slice(0, 3).forEach(d => {
        lines.push(`- ${d.name}：${d.status}。${d.summary}`);
      });
    }
  }

  lines.push("", "---", `> Luvio 不提供投资建议。以上是基于 ${completeness}% 数据完整度的研究回应。`);
  return lines.join("\n");
}
