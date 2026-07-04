// D3：从 src/server/routes/chat.js 内化进工具层的核心编排逻辑（~400 行，纯代码搬迁，
// 行为逐字节不变）。路由层 chat.js 现在只负责解析请求体、调用 runChat；agentTools.js 的
// compareCompanies 直接复用这里的 buildCompareSummary，不再反向依赖路由层。
import { sendJson, withTimeout } from "../utils/async.js";
import { runAgent } from "./agentService.js";
import { getProviderStatus } from "./modelGateway.js";
import { companyByTicker } from "../../data.js";
import { saveResearchSession } from "../repositories/researchSessions.js";
import { classifyResearchIntent } from "./intentClassifier.js";
import { researchWebEvidence } from "./webEvidenceService.js";
import { researchReplyFromPanel, normalizeResearchAnswer, mergeEvidenceIntoPanel } from "./answerComposer.js";
import { displayValuation } from "./valuationEngine.js";
import { computeFinancialQuality } from "./financialQuality.js";
import { PROMPTS } from "../../prompts.js";
import { loadPortraitContext, updatePortraitFromPanel } from "./companyPortrait.js";
import { addToWatch, getHiddenTickers, listWatchAdds } from "../repositories/watchlist.js";
import { runTwoStageChat, runTwoStageChatStream } from "./twoStageChat.js";
import { upsertPosition } from "../repositories/portfolio.js";
import { extractOtherHoldings } from "./entityExtractor.js";
import { getMarketSnapshot, getRangeReturns } from "../../marketData.js";
import { getFinancials, getAnalystEstimates } from "../../financialData.js";
import { getNewsSnapshot } from "../../newsData.js";

// 对话内对比：只拉"对比对象"做并排比较真正需要的几项（行情/区间回报/财报/评级），
// 不跑 news/filings/segments——精简后更快，避免和主公司的全量管道并发争抢时超时拿不到数据
// （之前用 collectDataSources 全量跑，并发下常超时→对比块为空，模型只能说"未核到对方数据"）。
export async function buildCompareSummary(compareWith) {
  const company = companyByTicker(compareWith.ticker) || compareWith;
  if (!company?.ticker) return null;
  const t = company.ticker;
  // A-P1.2：对比对象也并发拉新闻（带超时护栏）。A-P0.1 修完后新闻管线不会再崩，可安全补——
  // 之前为避超时故意没拉，导致对比回答只有行情/财报、缺一手事件。整块仍在外层 12s 预算内。
  const [ms, ranges, fin, est, news] = await Promise.all([
    withTimeout(getMarketSnapshot(t), 6000, null),
    withTimeout(getRangeReturns(t), 6000, { providerStatus: "missing" }),
    withTimeout(getFinancials(t), 8000, { providerStatus: "missing" }),
    withTimeout(getAnalystEstimates(t), 6000, { providerStatus: "missing" }),
    withTimeout(getNewsSnapshot({ ticker: t, nameZh: company.nameZh, nameEn: company.nameEn }), 6000, { providerStatus: "missing", articles: [] })
  ]);
  if (!ms || ms.providerStatus !== "ok") return null; // 连行情都没有就别给半截对比
  if (ranges?.providerStatus === "ok") ms.ranges = ranges;
  const valuation = displayValuation(companyByTicker(t) || company, ms, fin, est);
  const analyst = buildAnalystSummary(est, ms.price);
  return {
    ticker: t,
    name: company.nameZh || company.name || t,
    marketSnapshot: ms,
    financialsData: fin,
    valuation: valuation.cannotValueReason ? null : valuation,
    analyst,
    newsSnapshot: news
  };
}

// P0 对话内多标的：抽取问句里"当前公司之外"的其他标的，逐个拉轻量真实数据（复用 buildCompareSummary）。
// 这样作答 agent 能看到 SpaceX/第二只股的**真实行情**，根除"凭模型旧知识说某股没上市"的幻觉。
// 连行情都没拿到的标的也保留壳（summary=null），让回答能说"已识别但本轮未核到 X 实时数据"，而非装作没提过。
async function buildOtherHoldings(question, sessionCompany) {
  if (!sessionCompany?.ticker) return [];
  const others = await extractOtherHoldings(question, sessionCompany);
  if (!others.length) return [];
  return Promise.all(
    others.slice(0, 4).map(async (h) => ({
      company: h.company,
      shares: h.shares,
      cost: h.cost,
      summary: await withTimeout(buildCompareSummary({ ticker: h.company.ticker, nameZh: h.company.nameZh }), 8000, null)
    }))
  );
}

const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// B2 港美双上市：用户问的是港股那一边吗？是 → 返回港股代码（拉港股实时价用），否则 null。
function askedHkTickerOf(dualListing) {
  if (!dualListing?.hk || !dualListing?.asked) return null;
  return /\.HK$/i.test(String(dualListing.asked)) ? dualListing.hk : null;
}

// B2：把港股快照 + 用户成本/持股收成"港股口径"的盈亏锚（注入作答 prompt + 前端小卡片）。
// 港股价拿不到（providerStatus≠ok / 缺价）就返回 null，落回 B1（只说口径、不硬算）。
function buildDualQuote(hkTicker, hkSnapshot, userContext) {
  if (!hkTicker || !hkSnapshot || hkSnapshot.providerStatus !== "ok") return null;
  const price = numOrNull(hkSnapshot.price);
  if (price == null) return null;
  const cost = numOrNull(userContext?.cost);
  const shares = numOrNull(userContext?.shares);
  const pnlPct = cost ? Number((((price - cost) / cost) * 100).toFixed(1)) : null;
  return {
    ticker: hkTicker,
    price,
    currency: hkSnapshot.currency || "HKD",
    changePct: numOrNull(hkSnapshot.changePercent),
    cost,
    shares,
    pnlPct
  };
}

// 回报:风险赔率（bull 上行 vs bear 下行），与前端估值条/answerComposer 口径一致。
function oddsFromValuation(v) {
  if (!v) return null;
  const price = Number(v.currentPrice), bear = Number(v.bear), bull = Number(v.bull);
  if (![price, bear, bull].every(Number.isFinite) || price <= bear) return null;
  const o = (bull - price) / (price - bear);
  return o > 0 ? Number(o.toFixed(1)) : null;
}

// 把一家公司收口成对照表一列：现价/涨跌/PE/利润质量/赔率/区间回报/目标价/上行。
function comparisonSide({ name, ticker, marketSnapshot, financialsData, valuation, analyst }) {
  const ms = marketSnapshot || {};
  const q = computeFinancialQuality(financialsData);
  return {
    name,
    ticker,
    price: numOrNull(ms.price),
    changePct: numOrNull(ms.changePercent),
    pe: numOrNull(ms.pe ?? financialsData?.pe),
    qualityScore: q.quality?.qualityScore ?? null,
    odds: oddsFromValuation(valuation),
    oneMonthPct: numOrNull(ms.ranges?.oneMonthPct),
    ytdPct: numOrNull(ms.ranges?.ytdPct),
    target: analyst?.target ?? null,
    upsidePct: analyst?.upsidePct ?? null
  };
}

// B-3：公司对比不能只是并排数据表——专业分析师会说"谁更值得"，并且说清楚是因为哪几个数字。
// 只用两个可比、可解释的维度下判断：利润质量分（经营确定性）+ 回报风险赔率（当下值不值得买）。
// 两个维度都指向同一边才敢下"谁更优"的结论；一个维度都缺就诚实说"数据不足，判断不了"——
// 这是事实锚定护栏（B-1）在对比场景的延伸：不能因为要给结论就在证据不够时硬编一个赢家。
export function judgeComparison(left, right) {
  const hasQuality = Number.isFinite(left.qualityScore) && Number.isFinite(right.qualityScore);
  const hasOdds = Number.isFinite(left.odds) && Number.isFinite(right.odds);

  if (!hasQuality && !hasOdds) {
    return { winner: "insufficient", reason: `${left.name} 和 ${right.name} 的利润质量分与回报风险赔率都缺数据，暂时判断不了谁更值得。` };
  }

  const qualityWinner = hasQuality ? (left.qualityScore === right.qualityScore ? "tie" : left.qualityScore > right.qualityScore ? "left" : "right") : null;
  const oddsWinner = hasOdds ? (left.odds === right.odds ? "tie" : left.odds > right.odds ? "left" : "right") : null;

  const sideOf = (key) => (key === "left" ? left : right);
  const otherOf = (key) => (key === "left" ? right : left);

  if (hasQuality && hasOdds) {
    if (qualityWinner === oddsWinner) {
      if (qualityWinner === "tie") {
        return { winner: "tie", reason: `${left.name} 和 ${right.name} 的利润质量分（${left.qualityScore} vs ${right.qualityScore}）与赔率（${left.odds}:1 vs ${right.odds}:1）都接近，暂时难分高下。` };
      }
      const w = sideOf(qualityWinner), l = otherOf(qualityWinner);
      return { winner: qualityWinner, reason: `${w.name} 利润质量分更高（${w.qualityScore} vs ${l.qualityScore}）、回报风险赔率也更好（${w.odds}:1 vs ${l.odds}:1），两个维度一致占优。` };
    }
    // 两个维度的赢家不一致——先排掉"其中一个维度其实是平手"这种假冲突（不能把 tie
    // 误当成某一边真的"更好"，那是 B-1 事实锚定护栏要挡的那类虚假结论）。
    if (qualityWinner === "tie") {
      const w = sideOf(oddsWinner), l = otherOf(oddsWinner);
      return { winner: oddsWinner, reason: `${left.name} 和 ${right.name} 利润质量分接近（${left.qualityScore} vs ${right.qualityScore}），但 ${w.name} 回报风险赔率更好（${w.odds}:1 vs ${l.odds}:1），赔率上占优。` };
    }
    if (oddsWinner === "tie") {
      const w = sideOf(qualityWinner), l = otherOf(qualityWinner);
      return { winner: qualityWinner, reason: `${w.name} 利润质量分更高（${w.qualityScore} vs ${l.qualityScore}），赔率两者接近（${left.odds}:1 vs ${right.odds}:1），质量上占优。` };
    }
    // 两个维度都有决定性结果，但指向不同的一边——真正的取舍，不是假冲突。
    const qw = sideOf(qualityWinner), qwOther = otherOf(qualityWinner);
    const ow = sideOf(oddsWinner), owOther = otherOf(oddsWinner);
    return { winner: "mixed", reason: `${qw.name} 利润质量分更高（${qw.qualityScore} vs ${qwOther.qualityScore}），但 ${ow.name} 回报风险赔率更好（${ow.odds}:1 vs ${owOther.odds}:1）——质量和赔率指向不同方向，取决于你更看重经营确定性还是当下的赔率。` };
  }

  if (hasQuality) {
    if (qualityWinner === "tie") return { winner: "tie", reason: `两者利润质量分接近（${left.qualityScore} vs ${right.qualityScore}），且都缺赔率数据，暂时难分高下。` };
    const w = sideOf(qualityWinner), l = otherOf(qualityWinner);
    return { winner: qualityWinner, reason: `${w.name} 利润质量分更高（${w.qualityScore} vs ${l.qualityScore}），但两者都缺回报风险赔率数据，无法从赔率角度交叉验证。` };
  }

  if (oddsWinner === "tie") return { winner: "tie", reason: `两者回报风险赔率接近（${left.odds}:1 vs ${right.odds}:1），且都缺利润质量分，暂时难分高下。` };
  const w = sideOf(oddsWinner), l = otherOf(oddsWinner);
  return { winner: oddsWinner, reason: `${w.name} 回报风险赔率更好（${w.odds}:1 vs ${l.odds}:1），但两者都缺利润质量分，无法从盈利质量角度交叉验证。` };
}

// A-P1.1：把主公司与对比对象的结构化数据收口成 { left, right } 两列，前端 renderComparisonTable
// 直接渲染并排表（散文保留在表下）。只有带了 compareWith 且对比对象拿到行情时才有。
function buildComparison({ payload, result, valuation, analyst, compareData }) {
  if (!compareData?.ticker) return null;
  const left = comparisonSide({
    name: result.decisionPanel?.companyName || payload.company?.nameZh || payload.company?.ticker || "主公司",
    ticker: result.decisionPanel?.ticker || payload.company?.ticker,
    marketSnapshot: result.marketSnapshot,
    financialsData: result.financialsData,
    valuation: valuation?.cannotValueReason ? null : valuation,
    analyst
  });
  const right = comparisonSide({
    name: compareData.name,
    ticker: compareData.ticker,
    marketSnapshot: compareData.marketSnapshot,
    financialsData: compareData.financialsData,
    valuation: compareData.valuation,
    analyst: compareData.analyst
  });
  return { left, right, verdict: judgeComparison(left, right) };
}

// EA-4 柱2：这一轮该进看盘的候选标的——会话主公司（有面板才算）+ 对比对象 + 对话里
// 顺带提到、且真拉到 summary（真实数据）的其他持仓。纯函数，不碰 DB，可单测；
// 实际的"是否已在看盘""写入"留在 finalizeChat 里做（那部分要读写 DB）。
export function watchCandidatesFrom({ portraitTicker, decisionPanel, companyName, compareData, otherHoldings }) {
  return [
    portraitTicker && decisionPanel
      ? { ticker: portraitTicker, name: decisionPanel.companyName || companyName }
      : null,
    compareData?.ticker ? { ticker: compareData.ticker, name: compareData.name } : null,
    ...(Array.isArray(otherHoldings) ? otherHoldings : [])
      .filter((h) => h.company?.ticker && h.summary)
      .map((h) => ({ ticker: h.company.ticker, name: h.company.nameZh || h.summary?.name }))
  ].filter(Boolean);
}

// EA-0：/api/chat 与统一入口 /api/ask 共用的可复用核心；也是 EA-1 工具层
// researchCompany()/compareCompanies() 的落点。payload 已解析，res 用于 JSON 或 SSE 流式。
export async function runChat(payload, res) {
  try {
    const question = payload.question || "";
    const intent = classifyResearchIntent(question);
    const companyForEvidence = companyByTicker(payload.company?.ticker) || payload.company || {};

    // 对话内对比：用户点了"在本对话里对比"时带上 compareWith，并行把对比对象也跑一遍。
    const compareWith = payload.compareWith?.ticker ? payload.compareWith : null;

    // B2 港美双上市：用户问的是港股那一边时，并行拉港股实时价（腾讯免费源），用于按港股口径
    // 算精确盈亏；基本面/估值仍走 ADR。拿不到就降级为 null（落回"只说口径、不硬算"的 B1 行为）。
    const askedHkTicker = askedHkTickerOf(payload.company?.dualListing);

    // Single pipeline: data + deterministic local panel (no model, no persist here) runs in
    // parallel with web-evidence retrieval. The model is only called once, for the prose below.
    const [result, webEvidence, compareData, otherHoldings, hkSnapshot] = await Promise.all([
      runAgent(payload, { persist: false, useModelPanel: false }),
      withTimeout(
        researchWebEvidence({ company: companyForEvidence, question, intent }),
        9000,
        { intent, queries: [], evidence: [], gaps: ["网页证据检索超时，本轮先使用本地档案和已接入数据。"], provider: "timeout", searchedAt: new Date().toISOString() }
      ),
      compareWith ? withTimeout(buildCompareSummary(compareWith), 12000, null) : Promise.resolve(null),
      // 对话内对比模式专注两列，不再叠加多标的抽取；其余场景才跑 otherHoldings（含超时降级为 []）。
      compareWith ? Promise.resolve([]) : withTimeout(buildOtherHoldings(question, payload.company), 12000, []),
      askedHkTicker ? withTimeout(getMarketSnapshot(askedHkTicker), 5000, null) : Promise.resolve(null)
    ]);

    // Compute valuation before the model call so the prose and the visual bar
    // speak the same odds.
    const valuationProfile = companyByTicker(result.decisionPanel?.ticker || payload.company?.ticker) || payload.company;
    const valuation = displayValuation(valuationProfile, result.marketSnapshot, result.financialsData, result.estimatesData);
    const analyst = buildAnalystSummary(result.estimatesData, result.marketSnapshot?.price);
    // 长期画像：研究同一公司时自动带上上次沉淀的投资主线/证伪条件，保持连贯。
    const portraitTicker = result.decisionPanel?.ticker || payload.company?.ticker;
    // B2：港股口径的实时价 + 按 HKD 成本算出的精确盈亏（拿到才有）。
    const dualQuote = buildDualQuote(askedHkTicker, hkSnapshot, result.userContext);
    const context = {
      newsSnapshot: result.newsSnapshot,
      webEvidence,
      financialsData: result.financialsData,
      marketSnapshot: result.marketSnapshot,
      valuation: valuation.cannotValueReason ? null : valuation,
      portraitContext: portraitTicker ? loadPortraitContext(portraitTicker) : "",
      // 最近几轮对话，注入作答 prompt 让追问能承接上文（连续对话能力）。
      history: Array.isArray(payload.history) ? payload.history : [],
      // 港美双重上市口径：基本面/估值走 ADR，盈亏按用户问的那一边——让作答明确口径、不算错币种盈亏。
      dualListing: payload.company?.dualListing || null,
      // B2：港股实时价 + HKD 口径精确盈亏（asked=HK 且拉到港股价才有；否则 null 落回 B1）。
      dualQuote,
      // 对话内对比对象（拿到才有；buildChatPrompt 会渲染并排比较块 + 切到对比作答规则）。
      compare: compareData,
      // P0 对话内多标的：当前公司之外、问句里提到的其他持仓/标的（已解析+拉到真实数据）。
      otherHoldings
    };
    const fallback = researchReplyFromPanel(result.decisionPanel, question, result.dataSources, context);
    const wantStream = payload.stream === true;
    const modelReady = getProviderStatus().configured && result.decisionPanel;
    let content = fallback;
    let chatModel = null;

    // ── 流式（SSE）：阶段2 答案逐字推送，收尾再发一个 final 事件携带完整面板/估值/接地 ──
    if (wantStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no" // 反代不缓冲，token 才能实时吐出
      });
      const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 客户端断开 */ } };
      send("status", { stage: modelReady ? "generating" : "local" });
      if (modelReady) {
        chatModel = await runTwoStageChatStream({
          question, panel: result.decisionPanel, dataSources: result.dataSources, context,
          system: PROMPTS.chat.system,
          onToken: (t) => send("token", { t }),
          onReasoning: (t) => send("reasoning", { n: t.length }) // 只送字数，不送思考原文
        });
        if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
      }
      const finalPayload = finalizeChat({ payload, result, webEvidence, valuation, analyst, portraitTicker, intent, content, chatModel, compareData, otherHoldings, dualQuote });
      send("final", finalPayload);
      try { res.write("event: done\ndata: {}\n\n"); res.end(); } catch { /* already closed */ }
      return;
    }

    // ── 非流式（JSON）：保留原行为，作为前端不支持流式时的回退 ──
    if (modelReady) {
      chatModel = await runTwoStageChat({
        question,
        panel: result.decisionPanel,
        dataSources: result.dataSources,
        context,
        system: PROMPTS.chat.system
      });
      if (chatModel?.content && chatModel.content.length < 9000) content = chatModel.content;
    }
    sendJson(res, 200, finalizeChat({ payload, result, webEvidence, valuation, analyst, portraitTicker, intent, content, chatModel, compareData, otherHoldings, dualQuote }));
  } catch (error) {
    // 流式已经开了头就不能再 sendJson —— 改发一个 error 事件收尾。
    if (res.headersSent) {
      try { res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || "聊天失败" })}\n\n`); res.end(); } catch { /* closed */ }
    } else {
      const status = error.statusCode || 500;
      sendJson(res, status, { error: error.message || "聊天失败" });
    }
  }
}

// 把 otherHoldings 收成前端可渲染的紧凑结构 + 算出每个标的的浮盈亏%（有成本/现价时）。
function lightHoldings(otherHoldings = []) {
  if (!Array.isArray(otherHoldings)) return [];
  return otherHoldings.map((h) => {
    const ms = h.summary?.marketSnapshot || {};
    const price = numOrNull(ms.price);
    const cost = numOrNull(h.cost);
    const pnlPct = price != null && cost ? Number((((price - cost) / cost) * 100).toFixed(1)) : null;
    // ② 每只 other 带上各自的紧凑估值（已走 ①护栏，脏的为 null）+ 赔率 + 分析师目标，供"本轮聚焦"多卡渲染。
    const val = h.summary?.valuation || null; // buildCompareSummary 已把 cannotValueReason 的置为 null
    const an = h.summary?.analyst || null;
    return {
      ticker: h.company.ticker,
      name: h.company.nameZh || h.summary?.name || h.company.ticker,
      price,
      changePct: numOrNull(ms.changePercent),
      shares: numOrNull(h.shares),
      cost,
      pnlPct,
      odds: oddsFromValuation(val),
      valuation: val ? { method: val.method, bear: numOrNull(val.bear), base: numOrNull(val.base), bull: numOrNull(val.bull), currentPrice: numOrNull(val.currentPrice) } : null,
      target: an?.target ?? null,
      upsidePct: an?.upsidePct ?? null
    };
  });
}

// 模型作答之后的统一收口：归一化 → 证据并入面板 → 估值挂载 → 自然语言记账 → 画像回写 →
// 落库，返回前端要的完整响应对象。流式 / 非流式共用，保证两条路径产物完全一致。
function finalizeChat({ payload, result, webEvidence, valuation, analyst, portraitTicker, intent, content, chatModel, compareData, otherHoldings, dualQuote }) {
  const question = payload.question || "";
  content = normalizeResearchAnswer(content, result.decisionPanel, result.dataSources);
  result.webEvidence = webEvidence;
  mergeEvidenceIntoPanel(result.decisionPanel, webEvidence);
  if (result.decisionPanel && !valuation.cannotValueReason) result.decisionPanel.valuation = valuation;

  // ① 估值因数据存疑被护栏抑制（如 SpaceX 新上市数据缺口）：诚实降级，绝不让脏估值挂"置信度高"。
  //    置信度封顶到"中"、原因并入数据缺口，并附 valuationNote 让前端出一行"数据不足"说明（而非静默隐藏）。
  const valuationSuspect = Boolean(valuation?.cannotValueReason && valuation?.dataSuspect);
  if (valuationSuspect && result.decisionPanel) {
    if (result.decisionPanel.confidence === "高") result.decisionPanel.confidence = "中";
    const miss = Array.isArray(result.decisionPanel.missingData) ? result.decisionPanel.missingData : [];
    if (!miss.includes(valuation.cannotValueReason)) miss.push(valuation.cannotValueReason);
    result.decisionPanel.missingData = miss;
  }

  // 自然语言记账：识别到成本/股数/止损/止盈就 upsert 到持仓账本（持久化）。
  let positionSaved = false;
  const uc = result.userContext || {};
  if (portraitTicker && (uc.cost || uc.shares || uc.stopLoss || uc.takeProfit)) {
    try {
      upsertPosition(portraitTicker, {
        companyName: result.decisionPanel?.companyName || payload.company?.nameZh,
        shares: uc.shares != null ? Number(uc.shares) : undefined,
        avgCost: uc.cost != null ? Number(uc.cost) : undefined,
        stopLoss: uc.stopLoss != null ? Number(uc.stopLoss) : undefined,
        takeProfit: uc.takeProfit != null ? Number(uc.takeProfit) : undefined
      });
      positionSaved = true;
    } catch (err) {
      console.warn("portfolio 记账失败:", err?.message || err);
    }
  }

  // P0 多笔记账：除会话公司外，把对话里识别到的其他持仓也各自入账（修"只记一笔、第二笔被丢弃"）。
  for (const h of Array.isArray(otherHoldings) ? otherHoldings : []) {
    if (!h?.company?.ticker || (h.shares == null && h.cost == null)) continue;
    try {
      upsertPosition(h.company.ticker, {
        companyName: h.company.nameZh || h.summary?.name,
        shares: h.shares != null ? Number(h.shares) : undefined,
        avgCost: h.cost != null ? Number(h.cost) : undefined
      });
      positionSaved = true;
    } catch (err) {
      console.warn("portfolio 多笔记账失败:", err?.message || err);
    }
  }

  // A-P1.1：结构化对比（带 compareWith 时）—— 前端渲染两列并排表，散文保留在表下。
  const comparison = buildComparison({ payload, result, valuation, analyst, compareData });

  const sessionId = persistFinalChatSession(payload, result, content, {
    valuation: valuation.cannotValueReason ? null : valuation,
    valuationNote: valuationSuspect ? valuation.cannotValueReason : null,
    valuationName: result.decisionPanel?.companyName || payload.company?.nameZh || payload.company?.ticker || null,
    analyst,
    comparison,
    otherHoldings: lightHoldings(otherHoldings),
    dualQuote: dualQuote || null,
    mode: chatModel?.content ? "chat_model" : "chat_local"
  });

  // 回写长期画像：判断变化时追加时间线事件（带理由/证据/会话链接），否则只累计研究轮次。
  // 放在会话落库之后，是为了把 sessionId 记进事件——复盘时能从时间线跳回当时那轮研究。
  let portrait = null;
  if (portraitTicker && result.decisionPanel) {
    try {
      portrait = updatePortraitFromPanel({
        ticker: portraitTicker,
        panel: result.decisionPanel,
        valuation: valuation.cannotValueReason ? null : valuation,
        question,
        answerContent: content, // 证伪段落里的量化条件（含价格线）从这里抽取沉淀
        sessionId
      });
    } catch (err) {
      console.warn("company_profile 回写失败:", err?.message || err);
    }
  }

  // EA-4 柱2：自动进看盘从"只加会话主公司"扩到"本轮所有拉到真实数据的标的"——
  // 对比对象（compareData）、对话里顺带提到的其他持仓（otherHoldings，只算真正拉到
  // summary 的，壳记录不算）都一起进看盘，不再只有主公司会出现在看盘里。
  // watchRestored 只跟踪主公司（前端已有的"重新关注"文案专属于它）；newlyWatched 是
  // 这一轮真正新增的（之前不在看盘里的），供前端判断要不要提示 + 刷新看盘数据。
  const alreadyWatched = new Set(listWatchAdds().map((w) => w.ticker));
  const watchCandidates = watchCandidatesFrom({
    portraitTicker,
    decisionPanel: result.decisionPanel,
    companyName: payload.company?.nameZh,
    compareData,
    otherHoldings
  });

  let watchRestored = false;
  const newlyWatched = [];
  for (const candidate of watchCandidates) {
    try {
      const wasHidden = getHiddenTickers().has(candidate.ticker);
      if (candidate.ticker === portraitTicker) watchRestored = wasHidden;
      addToWatch(candidate.ticker, candidate.name);
      if (!alreadyWatched.has(candidate.ticker)) newlyWatched.push({ ticker: candidate.ticker, name: candidate.name });
    } catch (err) {
      if (candidate.ticker === portraitTicker) watchRestored = false;
      console.warn("watchlist 回写失败:", candidate.ticker, err?.message || err);
    }
  }

  return {
    mode: chatModel?.content ? "chat_model" : "chat_local",
    stages: chatModel?.stages || "none",
    intent,
    provider: chatModel?.provider || result.provider,
    model: chatModel?.model || result.model,
    sessionId,
    content,
    decisionPanel: result.decisionPanel,
    userContext: result.userContext,
    dataSources: result.dataSources,
    marketSnapshot: result.marketSnapshot,
    newsSnapshot: result.newsSnapshot,
    valuation: valuation.cannotValueReason ? null : valuation,
    // ① 估值被护栏抑制时给前端一行诚实说明（"数据不足，暂不给可信估值"），而非静默隐藏。
    valuationNote: valuationSuspect ? valuation.cannotValueReason : null,
    // ② 底部主估值条的归属公司名（消歧：多公司轮里明确"这条带子是谁的"）。
    valuationName: result.decisionPanel?.companyName || payload.company?.nameZh || payload.company?.ticker || null,
    analyst,
    comparison,
    // EA-2：规划器命中"两标的对比"时回显执行步骤（可解释），前端可选择展示；无规划时为 null。
    plan: Array.isArray(payload.plan) ? payload.plan : null,
    webEvidence,
    portrait: portrait
      ? { ticker: portraitTicker, created: portrait.created, changed: portrait.changed, turnCount: portrait.profile?.turnCount || 0 }
      : null,
    // P0/②：对话里识别到的其他标的（紧凑结构 + 各自估值，前端渲染"本轮聚焦"多卡）。
    otherHoldings: lightHoldings(otherHoldings),
    // B2：港股口径实时价 + HKD 盈亏（asked=HK 且拉到才有），前端渲染"港股口径"小卡。
    dualQuote: dualQuote || null,
    positionSaved,
    // 本轮研究把此前手动隐藏的公司重新拉回了看盘（前端据此提示）。
    watchRestored,
    // EA-4 柱2：本轮真正新增进看盘的标的（含对比对象/其他持仓，去重后此前已在看盘的不算）。
    newlyWatched
  };
}

function persistFinalChatSession(payload, result, content, extra = {}) {
  const panel = result.decisionPanel;
  const ticker = panel?.ticker || payload.company?.ticker;
  if (!ticker) return payload.sessionId || result.sessionId || null;
  // Reconstruct the assistant message meta so a restored session renders exactly
  // like the live answer — including the valuation bar, evidence cards and chips.
  const assistantMeta = {
    mode: extra.mode || "chat_local",
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    grounding: dataSourceGrounding(result.dataSources),
    completeness: typeof panel?.dataCompleteness === "number" ? panel.dataCompleteness : null,
    missing: Array.isArray(panel?.missingData) ? panel.missingData : [],
    confidence: panel?.confidence || null,
    confidenceNote: panel?.confidenceNote || null,
    valuation: extra.valuation || null,
    valuationNote: extra.valuationNote || null,
    valuationName: extra.valuationName || null,
    analyst: extra.analyst || null,
    comparison: extra.comparison || null,
    otherHoldings: extra.otherHoldings || null,
    dualQuote: extra.dualQuote || null,
    evidence: provenanceFromPanel(panel)
  };
  const thread = buildFinalThread(payload.history, payload.question, content, assistantMeta);
  try {
    const saved = saveResearchSession({
      id: payload.sessionId || result.sessionId || undefined,
      ticker,
      conversationId: payload.conversationId || undefined,
      companyName: panel?.companyName || payload.company?.nameZh || payload.company?.name || ticker,
      title: payload.sessionTitle || payload.question || panel?.companyName || ticker,
      question: payload.question || "",
      status: "completed",
      decisionPanel: panel,
      fullResearch: content,
      reportMarkdown: content,
      dataSources: {
        ...result.dataSources,
        webEvidence: result.webEvidence
          ? {
              provider: result.webEvidence.provider,
              intent: result.webEvidence.intent,
              count: result.webEvidence.evidence?.length || 0,
              gaps: result.webEvidence.gaps || []
            }
          : null
      },
      researchStatus: panel?.researchStatus,
      confidence: panel?.confidence,
      thread
    });
    return saved.id;
  } catch (error) {
    console.warn("chat session 持久化失败:", error?.message || error);
    return payload.sessionId || result.sessionId || null;
  }
}

function buildFinalThread(history = [], question = "", assistantContent = "", assistantMeta = {}) {
  const thread = Array.isArray(history) ? [...history] : [];
  const normalizedQuestion = String(question || "").trim();
  const last = thread[thread.length - 1];
  if (!(last?.role === "user" && String(last.content || "").trim() === normalizedQuestion)) {
    thread.push({ role: "user", content: question, createdAt: new Date().toISOString() });
  }
  if (assistantContent) {
    thread.push({ role: "assistant", content: assistantContent, meta: assistantMeta, createdAt: new Date().toISOString() });
  }
  return thread.slice(-80);
}

// 服务端复刻前端的 provenance/数据源标签（app.js 同名函数），让恢复历史时
// assistant 消息的 meta（估值条/证据卡/置信度）与实时回答完全一致。
const TYPE_CRED_DEFAULT = { official: 0.9, industry_research: 0.82, financial_media: 0.72, cn_financial_media: 0.6, market: 0.7, news: 0.55, web: 0.45 };

function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function provenanceFromPanel(panel) {
  const sources = Array.isArray(panel?.sources) ? panel.sources : [];
  return sources
    .filter((s) => s.url)
    .slice(0, 6)
    .map((s) => ({
      title: s.label || hostFromUrl(s.url) || "来源",
      url: s.url,
      source: hostFromUrl(s.url) || s.type || "web",
      type: s.type || (s.origin === "web_evidence" ? "web" : "official"),
      cred: typeof s.credibility === "number" ? s.credibility : (TYPE_CRED_DEFAULT[s.type] ?? null),
      date: s.timestamp || ""
    }));
}

function dataSourceLabels(dataSources = {}) {
  const map = { market: "行情", financials: "财报", filings: "公告", news: "新闻", estimates: "预期" };
  return Object.entries(map)
    .filter(([key]) => dataSources?.[key]?.status === "ok")
    .map(([, label]) => label);
}

// 接地条用的逐槽 ✓/✗（前端 app.js 同名函数的服务端复刻，让恢复历史时一致）。
// 固定 4 个核心槽，公告只在接入时追加，避免美股恒显"公告✗"。
function dataSourceGrounding(dataSources = {}) {
  const core = [["market", "行情"], ["financials", "财报"], ["news", "新闻"], ["estimates", "预期"]];
  const slots = core.map(([key, label]) => ({ label, ok: dataSources?.[key]?.status === "ok" }));
  if (dataSources?.filings?.status === "ok") slots.push({ label: "公告", ok: true });
  return slots;
}

// 把分析师评级数据收成前端要的紧凑结构：买卖分布 + 共识方向 + 一致目标价/上行空间。
// 分布来自 Finnhub recommendation（免费稳定），目标价来自 Yahoo 兜底（尽力而为）。
function buildAnalystSummary(estimates, price) {
  if (!estimates || estimates.providerStatus !== "ok") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const counts = [estimates.strongBuy, estimates.buy, estimates.hold, estimates.sell, estimates.strongSell];
  const hasDist = counts.some((n) => typeof n === "number");
  const buy = (estimates.strongBuy || 0) + (estimates.buy || 0);
  const hold = estimates.hold || 0;
  const sell = (estimates.sell || 0) + (estimates.strongSell || 0);
  const total = buy + hold + sell;
  const target = num(estimates.consensusTargetPrice) ?? num(estimates.targetMedian);
  const p = num(price);
  const upsidePct = target && p ? Number((((target - p) / p) * 100).toFixed(1)) : null;
  if (!hasDist && !target) return null;
  return {
    distribution: hasDist && total ? { buy, hold, sell, total } : null,
    consensus: estimates.consensus || null,
    target,
    targetLow: num(estimates.targetLow),
    targetHigh: num(estimates.targetHigh),
    analysts: num(estimates.numberOfAnalysts),
    upsidePct,
    source: estimates.source || "评级源"
  };
}
