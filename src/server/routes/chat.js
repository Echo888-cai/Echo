import { readJsonBody, sendJson } from "../utils/async.js";
import { runAgent } from "../services/agentService.js";
import { RESEARCH_STATUS_LABELS } from "../schemas/agentPanel.js";
import { callModel, getProviderStatus } from "../services/modelGateway.js";
import { withTimeout } from "../utils/async.js";

function formatBeijingMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function driver(panel, name) {
  return (panel?.keyDrivers || []).find((item) => item.name === name) || null;
}

function usefulSummary(item, fallback) {
  const text = String(item?.summary || "").trim();
  if (!text) return fallback;
  if (/^(新闻源不可用|缺|缺失|未接入|暂不评分)/.test(text) || /缺失，|缺失$/.test(text)) return fallback;
  return text;
}

function sourceLines(panel, dataSources = {}) {
  const explicit = Array.isArray(panel?.sources)
    ? panel.sources
        .filter((source) => source?.label || source?.url)
        .slice(0, 6)
        .map((source) => `- ${source.label || source.type || "来源"}${source.timestamp ? `（${source.timestamp}）` : ""}${source.url ? `：${source.url}` : ""}`)
    : [];
  if (explicit.length) return explicit;
  return [
    `- 行情：${dataSources.market?.provider || panel?.price?.source || "未接入"}${dataSources.market?.asOf ? `（${dataSources.market.asOf}）` : ""}`,
    `- 财务：${dataSources.financials?.provider || "未接入"}${dataSources.financials?.asOf ? `（${dataSources.financials.asOf}）` : ""}`,
    `- 公告：${dataSources.filings?.provider || "未接入"}${dataSources.filings?.asOf ? `（${dataSources.filings.asOf}）` : ""}`,
    `- 新闻：${dataSources.news?.provider || "未接入"}${Number.isFinite(dataSources.news?.count) ? `（${dataSources.news.count} 条）` : ""}`
  ];
}

function researchReplyFromPanel(panel, question = "", dataSources = {}) {
  if (!panel) return "我还没有拿到足够上下文。先告诉我公司名称或港股代码，我会先做阶段判断。";

  const status = RESEARCH_STATUS_LABELS[panel.researchStatus] || panel.researchStatus || "待判断";
  const missing = Array.isArray(panel.missingData) ? panel.missingData : [];
  const connected = Array.isArray(panel.connectedData) ? panel.connectedData : [];
  const price = panel.price?.value && panel.price.value !== "暂不可用" ? panel.price.value : "暂不可用";
  const priceTime = panel.price?.timestamp || dataSources.market?.asOf || "时间待核";
  const fundamental = driver(panel, "基本面");
  const valuation = driver(panel, "估值");
  const risk = driver(panel, "风险信号");
  const shareholder = driver(panel, "股东回报");
  const name = panel.companyName || panel.ticker || "这家公司";
  const fundamentalText = usefulSummary(
    fundamental,
    "结构化财务字段还不完整，先按商业模式、行业位置和后续财报验证做低置信度判断"
  );
  const valuationText = usefulSummary(
    valuation,
    "估值口径还没补齐，不能只用当前股价或单一倍数判断便宜"
  );
  const riskText = usefulSummary(
    risk,
    "外部新闻源本轮不足，风险先看行业竞争、监管、客户结构、利润率和公告缺口"
  );
  const shareholderText = usefulSummary(
    shareholder,
    "股东回报需要看回购、分红和自由现金流是否能持续"
  );
  const holding = panel.userContext?.cost || panel.userContext?.shares
    ? `你提供的持仓是成本 ${panel.userContext?.cost || "未提供"}，持股 ${panel.userContext?.shares || "未提供"}，这会影响回本赔率和仓位风险。`
    : "你还没有提供成本、持股和周期，所以我先按公司质量和研究赔率判断。";

  const lines = [
    `北京时间 ${formatBeijingMinute()}，${name} 最近的状态是：${String(panel.oneLineView || `研究状态为${status}`).replace(/。$/, "")}。我不会因为数据缺口就停止判断，但会把置信度和证据缺口说清楚。`,
    "",
    "结论",
    `${name} 当前更适合归为“${status}”，不是一句买或卖能解决的问题。核心矛盾是：${fundamentalText}；同时 ${valuationText}。${holding}`,
    "",
    "事实",
    `1. 行情：当前可用价格口径是 ${price}，来源 ${panel.price?.source || dataSources.market?.provider || "未接入"}，时间 ${priceTime}。这只能说明市场状态，不能直接等同于公司价值。`,
    `2. 基本面：${fundamental?.status || "待验证"}。${fundamentalText}。`,
    `3. 估值：${valuation?.status || "待验证"}。${valuationText}。`,
    `4. 股东回报：${shareholder?.status || "待验证"}。${shareholderText}。`,
    `5. 风险：${risk?.status || "待验证"}。${riskText}。`,
    "",
    "推断",
    `${name} 的投资判断要拆成两层：第一层是商业模式有没有赚钱机制，第二层是利润和现金流能不能稳定兑现。${/赚|盈利|利润|现金流/.test(question) ? "如果只是问“赚不赚钱”，我会先看收入质量、毛利率、经营利润率、自由现金流和资本开支，而不是只看净利润。" : "如果只是看短期涨跌，容易忽略真正驱动股价重估的是基本面兑现和风险收敛。"}`,
    "",
    "估值 / 风险",
    "Bull Thesis：如果后续财报证明收入恢复、利润率稳定、自由现金流没有继续恶化，同时估值口径补齐后仍有安全边际，市场会重新给它研究价值。",
    "Bear Thesis：如果竞争、监管、投入周期或客户需求继续压低利润和现金流，所谓便宜可能只是逻辑重估，而不是赔率改善。",
    `Base Case：在数据完整度 ${panel.dataCompleteness ?? 0}% 的情况下，我会把它放在观察/补充材料区间，先验证关键指标，再谈更强结论。`,
    "",
    "动作",
    "以下内容仅供分析参考，不构成投资建议。",
    "1. 先补最新财报和公告，确认收入、利润率、现金流是否同向改善。",
    "2. 如果有持仓，记录成本、股数、可承受回撤和计划周期，避免只按股价波动做判断。",
    "3. 如果需要更完整的材料，点击输入框里的“深度研究”，系统会把本轮对话、来源和证据缺口直接补进当前对话流。",
    "",
    "证伪条件",
    `1. ${fundamental?.summary ? "基本面指标与当前判断相反" : "收入、利润率或现金流继续走弱"}。`,
    `2. ${risk?.summary || "行业竞争、监管、客户集中或资产负债风险持续扩大"}。`,
    `3. ${valuation?.summary ? "估值修复没有基本面支撑" : "估值口径补齐后发现并不便宜"}。`,
    `4. ${missing.length ? `关键缺口长期补不上：${missing.slice(0, 4).join("、")}` : "新增公告出现与当前判断相反的信息"}。`,
    "",
    `我的判断：${name} 现在是“${status}、置信度${panel.confidence || "低"}、需要用下一组财报和公告验证”的标的。关键不是赌一个反弹，而是确认业务增长、利润质量和现金流能不能穿透当前风险。`,
    "",
    "来源：",
    ...sourceLines(panel, dataSources),
    connected.length ? `\n已接入：${connected.slice(0, 6).join("、")}` : "",
    missing.length ? `证据缺口：${missing.slice(0, 6).join("、")}` : ""
  ];

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

export async function handleChatApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = await runAgent(payload);
    const fallback = researchReplyFromPanel(result.decisionPanel, payload.question || "", result.dataSources);
    let content = fallback;
    let chatModel = null;
    if (getProviderStatus().configured && result.decisionPanel) {
      chatModel = await withTimeout(callModel({
        system: "你是 Luvio 的港股研究助理，风格像资深买方研究员：直接、克制、可证伪。普通对话也要给高质量判断，但不要伪装成完整正式报告，不给买卖指令。即使公开数据不完整，也必须基于公司档案、商业模式、行业常识、当前可得行情/财务/公告和模型推理给阶段判断；缺数据只影响置信度，不能只回答“需要接入数据”。",
        user: buildChatPrompt(payload.question || "", result.decisionPanel, result.dataSources)
      }), 45000, null);
      if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
    }
    content = normalizeResearchAnswer(content, result.decisionPanel, result.dataSources);
    sendJson(res, 200, {
      mode: chatModel?.content ? "chat_model" : "chat_local",
      provider: chatModel?.provider || result.provider,
      model: chatModel?.model || result.model,
      content,
      decisionPanel: result.decisionPanel,
      userContext: result.userContext,
      dataSources: result.dataSources,
      marketSnapshot: result.marketSnapshot,
      newsSnapshot: result.newsSnapshot
    });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, { error: error.message || "聊天失败" });
  }
}

function normalizeResearchAnswer(content, panel, dataSources = {}) {
  if (!panel) return content;
  let text = String(content || "").trim();
  if (!/^北京时间\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) {
    text = `北京时间 ${formatBeijingMinute()}，${panel.companyName || panel.ticker} 最近的状态是：${panel.oneLineView || "需要继续验证"}。\n\n${text}`;
  }
  if (!/来源[:：]/.test(text)) {
    text += `\n\n来源：\n${sourceLines(panel, dataSources).join("\n")}`;
  }
  return text;
}

function buildChatPrompt(question, panel, dataSources = {}) {
  const drivers = (panel.keyDrivers || []).map((d) => `- ${d.name}：${d.status}。${d.summary}`).join("\n");
  const missing = (panel.missingData || []).join("、") || "无";
  const connected = (panel.connectedData || []).join("、") || "无";
  const sources = sourceLines(panel, dataSources).join("\n");
  return `用户问题：${question}

当前研究对象：${panel.companyName}（${panel.ticker}）
研究状态：${RESEARCH_STATUS_LABELS[panel.researchStatus] || panel.researchStatus}
数据完整度：${panel.dataCompleteness}%
一句话判断：${panel.oneLineView}
用户上下文：成本 ${panel.userContext?.cost || "未提供"}，持股 ${panel.userContext?.shares || "未提供"}，周期 ${panel.userContext?.horizon || "未提供"}
北京时间：${formatBeijingMinute()}

关键卡片：
${drivers}

已接入数据：${connected}
缺失数据：${missing}
行情：${dataSources.market?.provider || panel.price?.source || "缺失"}，${panel.price?.value || "缺失"}
来源候选：
${sources}

回答规则：
- 输出中文纯文本，可以用短标题，但不要 Markdown 表格。
- 第一行必须严格使用：北京时间 ${formatBeijingMinute()}，${panel.companyName} 最近的状态是：……
- 保持像真实投研对话，不要写成产品说明，不要说“我将/我会获取”。
- 必须包含这些段落，顺序固定：结论、事实、推断、估值 / 风险、动作、证伪条件、我的判断、来源。
- “事实”尽量编号，引用当前可用数据；不能编造具体数值。若某项缺失，写“当前未核到/来源缺失”，但继续给推断。
- “推断”要把模型自己的商业判断讲出来：商业模式、利润质量、现金流、行业竞争、估值叙事。
- 对“赚不赚钱”，必须先回答赚钱机制和盈利质量：是否有收入来源、利润是否稳定、现金流是否支撑。
- 不允许只说数据不足；数据不足只能作为置信度和证伪条件的一部分。
- 禁止买入/卖出/持有建议，使用“观察、补充验证、赔率改善、逻辑重估”等研究语言。
- 长度控制在 900-1800 字，信息密度优先。`;
}
