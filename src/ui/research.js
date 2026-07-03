// ── 研究页：连续对话（产品灵魂）+ 会话管理 + 深度研究 + 导出 ──
import {
  S, render, running, runKey, activeRunKey, activeRun, isViewBusy,
  getThread, setThread, getCompany, setCompany, getPanel, setPanel,
  getDocuments, setDocuments, getSessionId, setSessionId, genSessionId, ensureSessionId,
  optimisticSession, appendMessage, busyElapsedSeconds, waitPhase, startRun, endRun
} from "./state.js";
import { api, chatStream } from "./api.js";
import { esc, uid, toast, marketLabelOf, isNum, fmtSigned, dirClass } from "./format.js";
import { markdownToHtml } from "./markdown.js";
import {
  resolveCompany, stripCompanyMentions, isComparisonQuestion, isMultiHoldingQuestion,
  mentionsNewCompanyStrong, discoveryKindOf
} from "./resolve.js";
import { provenanceFromPanel, dataSourceLabels, dataSourceGrounding, renderMessage } from "./components.js";
import { shell } from "./shell.js";
import { refreshWatchDesk } from "./watch.js";

// ── 会话列表 ─────────────────────────────────────────────

export async function refreshSessions() {
  try {
    const data = await api("/api/research/sessions?limit=30");
    const server = data.sessions || [];
    const serverIds = new Set(server.map((s) => s.id));
    // 按 id 合并：仍在跑、服务端还没落库的乐观条目（在途新研究）留在最前并继续转圈；
    // 服务端版覆盖同 id 乐观版（跑完即被真实数据替换）。
    const pending = S.recentSessions.filter((s) => s.optimistic && running.has(s.id) && !serverIds.has(s.id));
    S.recentSessions = [...pending, ...server];
    // Only reset if our active session was explicitly deleted server-side:既不在服务端、
    // 也不在跑（不是在途乐观）才算被删。绝不因列表为空或在途未落库就清掉在研线程。
    const activeId = getSessionId();
    if (activeId && server.length && !serverIds.has(activeId) && !running.has(activeId)) {
      setSessionId(null);
    }
  } catch {
    // 拉取失败：保留现有列表（含在途乐观条目），别让侧栏闪没。
  } finally {
    S.sessionsLoaded = true;
  }
}

export async function copyMessage(id) {
  const message = getThread().find((item) => item.id === id);
  if (!message?.content) return;
  try {
    await navigator.clipboard.writeText(message.content);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = message.content;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  toast("已复制回答。");
}

export function exportResearch() {
  const thread = getThread();
  if (!thread.length) {
    toast("还没有可导出的研究。");
    return;
  }
  const company = getCompany();
  const panel = getPanel();
  const heading = company ? `${company.nameZh || ""} ${company.ticker || ""}`.trim() : panel?.companyName || "Echo 研究";
  const lines = [`# ${heading} · 研究记录`, ""];
  if (panel?.confidence) {
    lines.push(`> 研究状态：${panel.researchStatus || "持续观察"} · 置信度：${panel.confidence}`, "");
  }
  for (const message of thread) {
    lines.push(message.role === "user" ? `## 提问\n\n${message.content}` : `## Echo\n\n${message.content}`, "");
  }
  const sources = Array.isArray(panel?.sources) ? panel.sources.filter((s) => s.url) : [];
  if (sources.length) {
    lines.push("## 来源", "", ...sources.map((s) => `- ${s.label || s.type || "来源"}：${s.url}`), "");
  }
  lines.push("---", "> 由 Echo Research 生成 · Seek signal. Ignore noise. 仅供研究学习，不构成投资建议。");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(company?.ticker || panel?.ticker || "echo").replace(/[^\w.-]/g, "")}-research.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("已导出 Markdown 研究记录。");
}

export function clearResearch() {
  // 不动后台在跑的 run（并行）。只把当前视图切到一个干净的新研究。
  setThread([]);
  setPanel(null);
  setCompany(null);
  setDocuments([]);
  setSessionId(null);
  toast("已新建研究。");
  location.hash = "#/research";
  render();
  // 后台刷新盯盘台，让刚结束的那轮研究即时出现在首页/看盘台。
  void refreshWatchDesk();
}

function apiHistory(question = "") {
  const thread = getThread();
  const last = thread[thread.length - 1];
  const samePendingQuestion = last?.role === "user" && String(last.content || "").trim() === String(question || "").trim();
  return (samePendingQuestion ? thread.slice(0, -1) : thread)
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content, meta: m.meta || {}, createdAt: m.createdAt }));
}

function sessionTitle(fallbackQuestion = "") {
  const firstUser = getThread().find((message) => message.role === "user");
  return String(firstUser?.content || fallbackQuestion || "新研究").slice(0, 80);
}

function fallbackThreadFromSession(session) {
  const thread = Array.isArray(session.thread) ? session.thread.filter((m) => m?.role && m?.content) : [];
  if (thread.length) return thread.slice(-80);
  const restored = [];
  if (session.question) restored.push({ id: uid("msg"), role: "user", content: session.question, createdAt: session.createdAt });
  const content = session.reportMarkdown || session.fullResearch || "";
  if (content) restored.push({ id: uid("msg"), role: "assistant", content, createdAt: session.updatedAt });
  return restored;
}

export async function loadSession(id) {
  if (!id) return;
  // 切到一个仍在生成的会话：从 run 快照恢复（含待答问题 + 等待/流式卡），不去拉服务端旧状态
  // （服务端要等它完成才有新答案）。这让"推理中切走再切回"看到的是正在跑、而不是空。
  const run = running.get(id);
  if (run?.snapshot) {
    const s = run.snapshot;
    setSessionId(s.sessionId || id);
    setCompany(s.company);
    setPanel(s.panel);
    setThread(s.thread);
    location.hash = "#/research";
    render();
    return;
  }
  try {
    const data = await api(`/api/research/sessions/${encodeURIComponent(id)}`);
    const session = data.session;
    if (!session) throw new Error("未找到研究会话");
    const panel = session.decisionPanel || null;
    let company = null;
    if (session.ticker) {
      const resolved = await resolveCompany(session.ticker);
      if (resolved && !resolved.unresolved && !resolved.unsupported) company = resolved;
    }
    if (!company && panel?.ticker) company = { ticker: panel.ticker, nameZh: panel.companyName || panel.ticker };
    setSessionId(session.id);
    setCompany(company);
    setPanel(panel);
    setThread(fallbackThreadFromSession(session));
    location.hash = "#/research";
    toast("已恢复历史研究。");
    render();
  } catch (error) {
    toast(error.message || "恢复历史失败。");
  }
}

export async function deleteSession(id) {
  if (!id) return;
  if (running.has(id)) { toast("这条研究正在生成，完成后再删。"); return; }
  const item = S.recentSessions.find((session) => session.id === id);
  const title = item?.title || item?.question || "这条研究";
  const ok = window.confirm(`删除“${title}”？\n\n这会从本地 SQLite 里移除这条历史研究。`);
  if (!ok) return;
  try {
    await api(`/api/research/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (getSessionId() === id) {
      setThread([]);
      setPanel(null);
      setCompany(null);
      setDocuments([]);
      setSessionId(null);
    }
    await refreshSessions();
    toast("已删除历史研究。");
    render();
  } catch (error) {
    toast(error.message || "删除失败。");
  }
}

export async function clearAllSessions() {
  if (!S.recentSessions.length) return;
  if (running.size) { toast("有研究正在生成，完成后再清空。"); return; }
  const ok = window.confirm("清空全部历史研究？\n\n这会删除本地 SQLite 里的所有历史记录。");
  if (!ok) return;
  try {
    await api("/api/research/sessions", { method: "DELETE" });
    setThread([]);
    setPanel(null);
    setCompany(null);
    setDocuments([]);
    setSessionId(null);
    await refreshSessions();
    toast("已清空全部历史研究。");
    render();
  } catch (error) {
    toast(error.message || "清空失败。");
  }
}

// ── 研究流程：发问 / 对比 / 切换 / 纠错 ───────────────────

// 从一次 chat 结果构造助手消息的 meta（接地条/估值/分析师/证据卡/置信度）。
// sendChat 与对话内对比 runComparison 共用，保证两条路径渲染一致。
function answerMetaFromResult(result) {
  return {
    mode: result.mode,
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    grounding: dataSourceGrounding(result.dataSources),
    completeness: typeof result.decisionPanel?.dataCompleteness === "number" ? result.decisionPanel.dataCompleteness : null,
    missing: Array.isArray(result.decisionPanel?.missingData) ? result.decisionPanel.missingData : [],
    confidence: result.decisionPanel?.confidence || null,
    valuation: result.valuation || null,
    // ① 估值被护栏抑制时的诚实说明（前端出一行"数据不足"，而非静默无卡）。
    valuationNote: result.valuationNote || null,
    // ② 底部主估值条归属的公司名（多公司轮里消歧）。
    valuationName: result.valuationName || null,
    analyst: result.analyst || null,
    comparison: result.comparison || null,
    // ② 本轮识别到的其他标的（各带紧凑估值/盈亏），用于"本轮聚焦"多卡渲染。
    otherHoldings: Array.isArray(result.otherHoldings) ? result.otherHoldings : null,
    // B2 港美双上市：港股口径实时价 + HKD 盈亏（asked=HK 且拉到才有）。
    dualQuote: result.dualQuote || null,
    evidence: provenanceFromPanel(result.decisionPanel)
  };
}

// 把一次结果落地：若这条 run 仍在前台（当前会话）→ 更新视图并 appendMessage；否则它已在
// 后台完成、服务端已存 → 只提示+刷新侧栏，不动当前视图（并行对话的核心路由）。
function applyChatResult(result, key, company) {
  const label = company?.nameZh || company?.ticker || "研究";
  if (key === activeRunKey()) {
    if (result.sessionId) setSessionId(result.sessionId);
    if (result.decisionPanel) setPanel(result.decisionPanel);
    const enrichedName = result.decisionPanel?.companyName;
    if (company && enrichedName && company.nameZh === company.ticker && enrichedName !== company.ticker) {
      setCompany({ ...company, nameZh: enrichedName });
    }
    appendMessage("assistant", result.content || "本轮没有生成有效回复。", answerMetaFromResult(result), { keepScroll: true });
    if (result.positionSaved) toast(`已记账 ${label} 的持仓信息。`);
    else if (result.portrait?.created) toast(`已为 ${label} 建立长期画像，并加入看盘。`);
    else if (result.watchRestored) toast(`${label} 已重新加入看盘。`);
    else if (result.portrait?.changed) toast(`已更新 ${label} 的长期画像（判断有变化）。`);
    // 画像变了就作废公司页的画像缓存，下次切"画像"Tab 拉到最新时间线。
    if (result.portrait && result.portrait.ticker === S.watchStockTicker) S.stockPortrait = null;
    return true;
  }
  toast(`${label} 的研究完成了，点左侧查看。`);
  return false;
}

// 推荐选项消息：检测到对比意图时，不直接切换/直接答，弹一条带按钮的助手消息让用户选。
function appendCompareChoice(current, target) {
  const cName = current.nameZh || current.ticker;
  const tName = target.nameZh || target.ticker;
  appendMessage("assistant", "", {
    type: "choice",
    choice: {
      prompt: `你是想把 ${cName} 和 ${tName} 做对比，还是改为只研究 ${tName}？`,
      options: [
        { label: `在本对话里对比：${cName} vs ${tName}`, hint: "拉两家真实数据并排比，不跳走", act: "compare", ticker: target.ticker, name: tName, recommended: true },
        { label: `只研究 ${tName}`, hint: "切换到新公司、开新研究", act: "switch", ticker: target.ticker, name: tName }
      ]
    }
  });
}

// did-you-mean 纠错卡：裸代码没在美股主板查到（打错的码）→ 不硬研究，弹候选 + 退路。
// 候选按钮研究确认过的真票；退路"仍按 X 研究"兜冷门/刚 IPO 还没被收录的票。
function appendDidYouMeanChoice(badTicker, suggestions = []) {
  const options = suggestions.slice(0, 4).map((s, i) => ({
    label: `研究 ${s.ticker}${s.name && s.name !== s.ticker ? ` · ${s.name}` : ""}`,
    hint: "你可能想找这家",
    act: "research",
    ticker: s.ticker,
    name: s.name || s.ticker,
    recommended: i === 0
  }));
  options.push({ label: `仍按 ${badTicker} 研究`, hint: "冷门 / 刚 IPO 的票数据源可能还没收录", act: "force", ticker: badTicker, name: badTicker });
  appendMessage("assistant", "", {
    type: "choice",
    choice: {
      prompt: suggestions.length
        ? `我没在美股主板查到代码 ${badTicker}，你是不是想找下面这些？也可以直接输更完整的公司名，或港股 xxxx.HK / 正确的美股代码。`
        : `我没在美股主板查到代码 ${badTicker}。可以换个写法：输更完整的公司名，或港股 xxxx.HK / 正确的美股代码；确认没打错就点"仍按 ${badTicker} 研究"。`,
      options
    }
  });
}

// 纠错卡"研究某候选"：候选是确认过的真票，直接带已知公司进研究（跳过再 verify）。
export async function researchSuggested(ticker, name) {
  if (!ticker || isViewBusy()) return;
  const company = { ticker, nameZh: name || ticker, nameEn: name || "", industry: "美股" };
  const q = `${name || ticker}最近怎么样？`;
  appendMessage("user", q);
  S.resolving = true; S.resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    S.resolving = false;
    render();
  }
}

// 纠错卡"仍按 X 研究"：用户坚持研究这个未校验代码（冷门/新票）→ 绕过 verify 闸门直接研究。
export async function forceResearch(ticker) {
  if (!ticker || isViewBusy()) return;
  const company = { ticker, nameZh: ticker, nameEn: ticker, industry: "美股" };
  const q = `研究 ${ticker}`;
  appendMessage("user", q);
  S.resolving = true; S.resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    S.resolving = false;
    render();
  }
}

// 对话内对比：在当前对话里把当前公司与目标公司并排比较（带 compareWith，后端会把目标
// 那家也跑一遍数据塞进 prompt）。答案落在当前线程，不跳页、不新开对话。
export async function runComparison(target) {
  const current = getCompany();
  if (!current?.ticker || isViewBusy()) return;
  const question = `把 ${current.nameZh || current.ticker} 和 ${target.name} 做个对比`;
  appendMessage("user", question);
  const sessionId = ensureSessionId();
  optimisticSession(sessionId, { company: current, question });
  const key = runKey(sessionId, current.ticker);
  startRun(key, "正在对比两家公司");
  render();
  try {
    const result = await chatStream({
      question,
      company: current,
      compareWith: { ticker: target.ticker, nameZh: target.name },
      sessionId,
      sessionTitle: sessionTitle(question),
      history: apiHistory(question),
      documents: getDocuments(),
      memory: {}
    }, key);
    if (result) applyChatResult(result, key, current);
    else if (key === activeRunKey()) appendMessage("assistant", "本轮没有生成对比。");
  } catch (error) {
    if (key === activeRunKey()) appendMessage("assistant", `这轮对比失败：${error.message || "未知错误"}。`);
  } finally {
    endRun(key);
    await refreshSessions();
    render();
  }
}

// "只研究新公司"：走正常 sendChat 切换路径（会触发软分隔+留退路；sendChat 自己管 run 生命周期）。
export async function switchAndResearch(target) {
  if (isViewBusy()) return;
  const q = `${target.name}最近怎么样？`;
  appendMessage("user", q);
  S.resolving = true; S.resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(q);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    S.resolving = false;
    render();
  }
}

// 软分隔上的"回到上一家"：优先恢复那家最近的历史会话，没有就直接切回开新研究。
export async function returnToCompany(ticker, name) {
  if (!ticker) return;
  const sess = S.recentSessions.find((s) => s.ticker === ticker);
  if (sess) { await loadSession(sess.id); return; }
  // 找不到历史会话 → 明确新建一条干净研究（稳定 id），不再遗留 null。否则下一句追问会以
  // null 落库另起一条重复行（问题 3 的 returnToCompany 分支根因）。
  setSessionId(genSessionId());
  setPanel(null);
  setThread([]);
  setCompany({ ticker, nameZh: name || ticker, industry: marketLabelOf(ticker) });
  location.hash = "#/research";
  render();
}

// P6 发现层：筛选/宏观问题不进公司管道，直接打 /api/discover，结果落回当前线程。
// 即使当前有在研公司也优先分流——"美股今晚有什么关键事件"不该被当成对当前公司的追问。
async function runDiscovery(question, kind) {
  const sessionId = ensureSessionId();
  const key = runKey(sessionId, getCompany()?.ticker);
  startRun(key, kind === "screener" ? "正在按条件筛选" : "正在梳理宏观信号");
  render();
  try {
    const result = await api("/api/ask", { method: "POST", body: JSON.stringify({ question, kind }) });
    if (result.kind === "screener") {
      appendMessage("assistant", "", { type: "screener", screener: result });
    } else {
      appendMessage("assistant", result.content || "本轮没有生成宏观观察。", {
        type: "macro",
        indices: result.indices || [],
        evidence: result.evidence || [],
        mode: result.mode || null
      });
    }
  } catch (error) {
    appendMessage("assistant", `这轮查询失败：${error.message || "未知错误"}。`);
  } finally {
    endRun(key);
    render();
  }
}

// preResolved：已确定的公司（did-you-mean 选了候选 / "仍按 X 研究"），跳过解析与 verify 闸门，
// 直接进研究流程。普通调用 preResolved=null，照常解析。
export async function sendChat(question, preResolved = null) {
  // 发现层分流（P6）：筛选/宏观且没点名公司 → /api/discover，不进公司解析。
  if (!preResolved) {
    const kind = discoveryKindOf(question);
    if (kind) { await runDiscovery(question, kind); return; }
  }
  const prevCompany = getCompany();
  let company = preResolved || prevCompany;
  if (!preResolved) {
  const multiHolding = Boolean(prevCompany?.ticker) && isMultiHoldingQuestion(question);
  // 多持仓/多标的问句（"我持有 A 和 B…能赚钱吗"）：保持当前在研公司为主，跳过切换/对比选择卡，
  // 直接当作对当前公司的追问发送；后端 extractOtherHoldings 会补齐其他标的（otherHoldings）。
  if (!multiHolding) {
  // 对比意图：已有在研公司 + 句子在做对比 + 点名了另一家公司 → 不直接切换/不直接答，
  // 弹推荐选项，让用户选"在本对话里对比"还是"只研究新公司"（避免突然跳走/张冠李戴）。
  if (prevCompany?.ticker && isComparisonQuestion(question) && mentionsNewCompanyStrong(question)) {
    S.resolving = true; S.resolvingLabel = "正在识别对比对象"; render();
    // 关键：要解析的是**另一家**公司，不是当前这家。先把当前公司的名字/代码从问句里抠掉，
    // 否则 "苹果和英伟达比" 会先命中"苹果"(=当前公司) → 误判成非对比、落回普通追问。
    const target = await resolveCompany(stripCompanyMentions(question, prevCompany));
    if (target?.ticker && target.ticker !== prevCompany.ticker) {
      appendCompareChoice(prevCompany, target);
      return;
    }
    // 解析不出 / 就是当前公司 → 落回常规流程（当作对当前公司的追问）。
  }
  // 没公司时必解析；已有在研公司时只在"强信号"（明确点名另一家公司）下才切换标的。
  // 否则"经营质量怎么样""现金流呢"这类追问会被误判成新公司、解析失败后整轮拒答——
  // 这正是"同一对话没有上下文、连续对话断掉"的根因。强信号涵盖代码/别名/双重上市/
  // 私人公司/带后缀公司名/英文专名，"美光科技怎么样"仍能正常切换。
  const shouldResolve = !company || mentionsNewCompanyStrong(question);
  if (shouldResolve) {
    // 中文名要走一轮 LLM 解析（2–5s），给个明确的"正在识别公司…"微状态，
    // 而不是让用户对着"正在检索和思考"干等、以为卡住了。
    S.resolving = true; S.resolvingLabel = "正在识别公司"; render();
    const resolved = await resolveCompany(question, { verify: true });
    // A 股（沪深）暂不支持：给专门提示，而不是泛泛的"没识别出"。
    if (resolved?.unsupported) {
      appendMessage(
        "assistant",
        `「${resolved.name}」是 A 股（沪深）。目前只覆盖**港股和美股**，这家暂时研究不了。\n\n` +
        `如果它同时在港股或美股上市（很多中概股是双重上市），可以用对应代码再问我，比如港股 **xxxx.HK** 或美股代码。`
      );
      return;
    }
    // 点名了一家公司却解析不出：明确说"没识别出"，绝不拿上一家公司硬答。
    if (resolved?.unresolved) {
      appendMessage(
        "assistant",
        `我去权威数据源（FMP/交易所）查了「${resolved.name}」，没拿到能对上的上市代码，这轮就不硬答了，免得张冠李戴答成别的公司。\n\n` +
        `可以这样再问我一次：\n` +
        `- 美股：直接输代码，如 **MU**、**HOOD**，或写 **$MU**\n` +
        `- 港股：用代码，如 **0700.HK**\n` +
        `- 如果它**刚 IPO**、或是冷门标的（数据源可能还没收录），直接把股票代码发我最稳\n` +
        `- 也可以写更完整、更标准的公司名`
      );
      return;
    }
    // 裸代码没在美股主板查到（DRUM 这种打错的）→ 弹纠错卡（候选 + 退路），不硬研究、不崩。
    if (resolved?.unverifiedTicker) {
      appendDidYouMeanChoice(resolved.unverifiedTicker, resolved.suggestions);
      return;
    }
    if (resolved) company = resolved;
  }
  } // end if (!multiHolding)
  } // end if (!preResolved)
  if (!company) {
    appendMessage("assistant", "我还没有识别出公司。请补充公司名、港股代码或美股代码，例如 0700.HK 腾讯、AAPL 苹果。");
    return;
  }

  // Company switch → start a fresh research session. Each company keeps its own
  // clean history entry, and context never bleeds from the previous company.
  const switched = Boolean(prevCompany?.ticker && company.ticker && company.ticker !== prevCompany.ticker);
  if (switched) {
    const thread = getThread();
    const pending = thread[thread.length - 1];
    setSessionId(null);
    setPanel(null);
    // 软分隔：新线程顶部放一条"已从 X 切到 Y · 点此回到 X"，切换不突兀且留退路。
    const divider = {
      id: uid("msg"), role: "assistant", content: "",
      meta: { type: "switch-divider", from: { ticker: prevCompany.ticker, name: prevCompany.nameZh || prevCompany.ticker }, to: { name: company.nameZh || company.ticker } },
      createdAt: new Date().toISOString()
    };
    setThread(pending?.role === "user" ? [divider, pending] : [divider]);
  }
  setCompany(company);
  // 双重上市：首次选中时说清楚——同一家公司，基本面走美股 ADR，两地代码都给。
  if (company.dualListing && (switched || !prevCompany?.ticker)) {
    toast(`${company.nameZh} 双重上市：港股 ${company.dualListing.hk}｜美股 ${company.dualListing.us}，基本面按美股 ADR 口径。`);
  }
  // 识别完成 → 研究开始前先落地稳定 sessionId（新研究/切换后都是全新一条），run 全程用它当键、
  // chat 体带上它 → 后端 upsert 同一行；并乐观插入侧栏 → 新研究立刻出现（转圈），不等服务端。
  // 推理中可切到别的对话、并行再发；结果按 key 落回对应会话（见 applyChatResult）。
  const sessionId = ensureSessionId();
  optimisticSession(sessionId, { company, question });
  const key = runKey(sessionId, company.ticker);
  startRun(key, "正在检索和思考");
  render();
  try {
    const result = await chatStream({
      question,
      company,
      sessionId,
      sessionTitle: sessionTitle(question),
      history: apiHistory(question),
      documents: getDocuments(),
      memory: {}
    }, key);
    if (result) applyChatResult(result, key, company);
    else if (key === activeRunKey()) appendMessage("assistant", "本轮没有生成有效回复。");
  } finally {
    endRun(key);
    // 统一对账侧栏：成功→服务端真实条目替换乐观版；失败（纯新研究没落库）→死乐观条目被剪掉。
    // 放在 endRun 之后、render 之前——一次 render 直接到位，无中间闪动。
    await refreshSessions();
    render();
  }
}

export async function generateDeepResearch() {
  if (isViewBusy()) return;
  const company = getCompany();
  const thread = getThread();
  if (!company) {
    toast("先输入公司或股票代码。");
    return;
  }

  const lastQuestion = [...thread].reverse().find((m) => m.role === "user")?.content || `分析 ${company.ticker}`;
  const sessionId = ensureSessionId();
  optimisticSession(sessionId, { company, question: lastQuestion });
  const key = runKey(sessionId, company.ticker);
  startRun(key, "正在生成深度研究");
  render();
  try {
    const result = await api("/api/report/generate", {
      method: "POST",
      body: JSON.stringify({
        question: lastQuestion,
        company,
        sessionId,
        sessionTitle: sessionTitle(lastQuestion),
        documents: getDocuments(),
        history: thread.slice(-16).map((m) => ({ role: m.role, content: m.content })),
        memory: {}
      })
    });
    if (key === activeRunKey()) {
      if (result.sessionId) setSessionId(result.sessionId);
      if (result.decisionPanel) setPanel(result.decisionPanel);
      appendMessage("assistant", result.markdown || "深度研究没有生成有效内容。", { type: "deep_research", mode: result.mode, model: result.model }, { keepScroll: true });
    } else {
      toast(`${company.nameZh || company.ticker} 的深度研究完成了，点左侧查看。`);
    }
  } catch (error) {
    if (key === activeRunKey()) appendMessage("assistant", `深度研究失败：${error.message || "未知错误"}。`);
  } finally {
    endRun(key);
    await refreshSessions();
    render();
  }
}

export async function parseFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const docs = [];
  for (const file of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await api("/api/parse-document", {
      method: "POST",
      body: JSON.stringify({ name: file.name, type: file.type, dataUrl, ticker: getCompany()?.ticker || null })
    });
    docs.push(response.document || response);
  }
  setDocuments([...getDocuments(), ...docs]);
  toast(`已上传 ${docs.length} 个资料。`);
  render();
}

// ── 研究页渲染 ───────────────────────────────────────────

const EXPORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19.5h14"/></svg>';

// desk-head 副标题：永远给可读信息，绝不显示占位的"待补充"。优先市场标签，
// 再补真实行业（排除"美股/港股/待补充"这类占位）。
const PLACEHOLDER_INDUSTRY = new Set(["美股", "港股", "待补充", "待定", ""]);
function companySubtitle(company) {
  if (!company) return "问一句就开始，复杂研究再沉到底层。";
  const mkt = marketLabelOf(company.ticker);
  const ind = company.industry || company.sector || "";
  const realInd = PLACEHOLDER_INDUSTRY.has(ind) ? "" : ind;
  return [mkt, realInd].filter(Boolean).join(" · ") || mkt || company.ticker || "美股";
}

function renderSnapshotCard(company, panel, thread) {
  const name = panel?.companyName || company?.nameZh || "未选择公司";
  const ticker = company?.ticker || panel?.ticker || "";
  const marketLabel = marketLabelOf(ticker);
  const confLevel = panel?.confidence === "高" ? "high" : panel?.confidence === "低" ? "low" : "mid";
  const confChip = panel?.confidence
    ? `<span class="conf conf-${confLevel}">置信度 ${esc(panel.confidence)}</span>`
    : "";

  // ② 对话化侧栏：从最近一条带多标的的回答里取"本轮聚焦"，把"研究公司（单一）"软化为"本轮聚焦（1/N）"。
  const focusOthers = (() => {
    if (!Array.isArray(thread)) return [];
    for (let i = thread.length - 1; i >= 0; i--) {
      const m = thread[i];
      if (m?.role === "assistant" && Array.isArray(m.meta?.otherHoldings) && m.meta.otherHoldings.length) return m.meta.otherHoldings;
    }
    return [];
  })();
  const focusLabel = focusOthers.length ? "本轮聚焦" : "研究公司";
  const focusChips = focusOthers.length
    ? `<div class="focus-mini">
        <span class="fm-chip fm-main">${esc(ticker || name)}</span>
        ${focusOthers.map((h) => {
          const pnl = isNum(h.pnlPct) ? ` <em class="${dirClass(h.pnlPct)}">${fmtSigned(h.pnlPct)}</em>` : "";
          return `<span class="fm-chip">${esc(h.ticker || h.name)}${pnl}</span>`;
        }).join("")}
      </div>`
    : "";

  const priceRaw = panel?.price?.value && panel.price.value !== "暂不可用" ? String(panel.price.value) : "";
  const [priceNum, ...ccyParts] = priceRaw.split(" ");
  const ccy = ccyParts.join(" ");
  const changeRaw = panel?.price?.change && panel.price.change !== "暂不可用" ? String(panel.price.change) : "";
  const chgNum = parseFloat(changeRaw);
  const chgDir = !changeRaw || Number.isNaN(chgNum) ? "is-flat" : chgNum > 0 ? "is-up" : chgNum < 0 ? "is-down" : "is-flat";
  const chgText = changeRaw ? (chgNum > 0 && !changeRaw.startsWith("+") ? `+${changeRaw}` : changeRaw) : "";

  const metricValue = (metricName) => {
    const found = (panel?.metrics || []).find((item) => item.name === metricName);
    const value = found?.value;
    return value && value !== "暂不可用" ? String(value) : "";
  };
  const pe = metricValue("PE");
  const cap = metricValue("市值");
  // 区间回报（近1月/年初至今）——美股可得，港股缺则不显示。带涨跌色。
  const ranges = panel?.price?.ranges || null;
  const pctChip = (label, pct) => {
    if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return "";
    const n = Number(pct);
    const dir = n > 0 ? "is-up" : n < 0 ? "is-down" : "is-flat";
    return `<div class="snapshot-metric"><span>${label}</span><strong class="rng ${dir}">${n > 0 ? "+" : ""}${n}%</strong></div>`;
  };
  const rangeChips = ranges ? `${pctChip("近1月", ranges.oneMonthPct)}${pctChip("年初至今", ranges.ytdPct)}` : "";

  const quoteBlock = priceNum
    ? `<div class="snapshot-quote">
        <span class="price">${esc(priceNum)}</span>${ccy ? `<span class="ccy">${esc(ccy)}</span>` : ""}
        ${chgText ? `<span class="chg ${chgDir}">${esc(chgText)}</span>` : ""}
      </div>`
    : "";

  const metricChips = (pe || cap || rangeChips)
    ? `<div class="snapshot-metrics">
        ${pe ? `<div class="snapshot-metric"><span>TTM PE</span><strong>${esc(pe)}</strong></div>` : ""}
        ${cap ? `<div class="snapshot-metric"><span>市值</span><strong>${esc(cap)}</strong></div>` : ""}
        ${rangeChips}
      </div>`
    : "";

  const dual = company?.dualListing;
  // 智能默认：基本面/估值始终走美股 ADR（数据全）；用户问的若是港股代码，则点明盈亏按港股口径。
  const askedHk = !!(dual && dual.asked && /\.HK$/i.test(dual.asked));
  const dualNote = dual
    ? `<div class="snapshot-dual" title="同一家公司在港股和美股双重上市；FMP 免费档只覆盖美股 ADR，所以基本面与估值统一按美股口径。${askedHk ? "你问的是港股，盈亏请按港股价 + HKD 成本算。" : "行情两地可分别查。"}">
        <span class="dual-badge">双重上市</span>
        <span class="dual-text">港股 ${esc(dual.hk)}｜美股 ${esc(dual.us)} · 基本面按美股 ADR 口径${askedHk ? "；你问港股 → 盈亏按港股口径" : ""}</span>
      </div>`
    : "";

  return `<section class="research-snapshot">
    <div class="snapshot-head">
      <div class="snapshot-id">
        <p>${focusLabel}</p>
        <h2>${esc(name)}</h2>
        <span>${ticker ? `${esc(ticker)}${marketLabel ? ` · ${marketLabel}` : ""}` : "输入公司名、港股或美股代码"}</span>
      </div>
      ${confChip}
    </div>
    ${focusChips}
    ${dualNote}
    ${quoteBlock}
    ${metricChips}
  </section>`;
}

export function renderResearch() {
  const company = getCompany();
  const panel = getPanel();
  const thread = getThread();
  const activeSessionId = getSessionId();
  const hasResearch = Boolean(company || thread.length);

  shell(`
    <section class="workspace">
      <aside class="sidebar">
        <button class="primary wide" data-action="new">新建研究</button>
        ${renderSnapshotCard(company, panel, thread)}
        ${renderSessionHistory(activeSessionId)}
        <div class="sidebar-tagline"><b>Seek signal. Ignore noise.</b>喧声之外，见真知。研究参考，非投资建议。</div>
      </aside>

      <section class="desk">
        ${hasResearch ? `<div class="desk-head">
          <div>
            <p>Echo Research</p>
            <h1>${company ? `${esc(company.nameZh)} ${esc(company.ticker)}` : "输入公司，开始判断"}</h1>
            <span>${esc(companySubtitle(company))} </span>
          </div>
          ${thread.length ? `<button class="desk-export-btn" type="button" data-action="export" aria-label="导出研究" title="导出研究">${EXPORT_ICON}</button>` : ""}
        </div>` : ""}
        <div class="conversation ${hasResearch ? "" : "is-empty"}">
          ${thread.length ? thread.map(renderMessage).join("") : renderEmptyState()}
          ${(S.streamingKey && S.streamingKey === activeRunKey()) ? renderStreamingCard() : (isViewBusy() ? renderWaitingCard() : "")}
        </div>
        ${renderComposer(company)}
      </section>
    </section>`);
}

function renderSessionHistory(activeSessionId) {
  const count = S.recentSessions.length;
  const toggle = `<button class="history-toggle ${S.historyOpen ? "is-open" : ""}" type="button" data-action="toggle-history" aria-expanded="${S.historyOpen}">
      <span>历史研究${count ? ` · ${count}` : ""}</span>
      <i>${S.historyOpen ? "收起" : "展开"}</i>
    </button>`;
  if (!S.historyOpen) {
    return `<section class="history-panel collapsed">${toggle}</section>`;
  }
  const body = !S.sessionsLoaded
    ? `<div class="history-empty">正在读取历史...</div>`
    : count
      ? `<div class="session-list">${S.recentSessions.map((session) => renderSessionItem(session, activeSessionId)).join("")}</div>`
      : `<div class="history-empty">还没有历史研究。完成第一轮回答后会自动保存。</div>`;
  return `<section class="history-panel">
    ${toggle}
    ${count ? `<div class="history-actions"><button type="button" data-action="clear-sessions">清空全部</button></div>` : ""}
    ${body}
  </section>`;
}

function renderSessionItem(session, activeSessionId) {
  const active = session.id === activeSessionId;
  const title = session.title || session.question || session.companyName || session.ticker || "未命名研究";
  const company = session.companyName || session.company_name || session.ticker || "研究对象";
  const isRunning = running.has(session.id); // 这条会话正在后台生成 → 显示转圈
  return `<div class="session-item ${active ? "is-active" : ""} ${isRunning ? "is-running" : ""}">
    <button class="session-open" type="button" data-action="load-session" data-id="${esc(session.id)}">
      <strong>${esc(title)}</strong>
      <span>${isRunning ? '<i class="session-spin" aria-hidden="true"></i>正在生成…' : esc(company)}</span>
    </button>
    ${isRunning ? "" : `<button class="session-delete" type="button" data-action="delete-session" data-id="${esc(session.id)}" aria-label="删除历史研究">×</button>`}
  </div>`;
}

function renderWaitingCard() {
  return `<article class="message assistant">
    <div class="bubble answer-card wait-card">
      <div class="answer-brand">
        <div class="answer-mark"><i></i><span>ECHO</span></div>
      </div>
      <div class="wait-row">
        <span class="wait-orb" aria-hidden="true"></span>
        <strong>${esc(activeRun()?.label || S.resolvingLabel)}</strong>
        <em>已等待 <span data-busy-seconds>${busyElapsedSeconds()}</span>s</em>
      </div>
      <p class="wait-phase" data-busy-phase>${esc(waitPhase())}</p>
      <div class="skeleton" aria-hidden="true">
        <div class="sk-line w-95"></div>
        <div class="sk-line w-75"></div>
        <div class="sk-card">
          <div class="sk-line sk-strong w-30"></div>
          <div class="sk-line w-90"></div>
          <div class="sk-line w-65"></div>
        </div>
        <div class="sk-line w-85"></div>
        <div class="sk-line w-55"></div>
      </div>
    </div>
  </article>`;
}

// 接地条骨架：流式期先占住接地条的位置（同结构、同高度，灰色 pending 态）。final 到达后
// 真接地条原地替换它——高度不变，正文不会被往下顶，消除"看着看着卡片闪到下面"。
const GROUNDING_PENDING_SLOTS = ["行情", "财报", "新闻", "预期"];
function renderGroundingSkeleton() {
  const chips = GROUNDING_PENDING_SLOTS
    .map((label) => `<span class="ground-chip pending">${label}<i>·</i></span>`)
    .join("");
  return `<div class="grounding-bar grounding-pending" aria-hidden="true">${chips}<span class="ground-complete pending">完整度 —</span></div>`;
}

// 流式作答卡：token 边到边写进 #stream-body，末尾跟一个闪烁光标。final 到达后由
// appendMessage 渲染成带估值/分析师/接地条的正式回答卡，本卡随之消失。顶部预留接地条骨架。
function renderStreamingCard() {
  return `<article class="message assistant">
    <div class="bubble answer-card stream-card">
      <div class="answer-brand"><div class="answer-mark"><i></i><span>ECHO</span></div></div>
      ${renderGroundingSkeleton()}
      <div class="ans-stream" id="stream-body">${markdownToHtml(S.streamingText)}<span class="stream-caret"></span></div>
    </div>
  </article>`;
}

function renderComposer(company) {
  const status = isViewBusy()
    ? `${esc(activeRun()?.label || S.resolvingLabel)} · 已等待 <b data-busy-seconds>${busyElapsedSeconds()}</b>s`
    : company
      ? `${esc(company.nameZh || company.ticker)} · ${esc(company.ticker)}`
      : "先输入公司名、港股或美股代码";
  return `<form class="composer" data-form="chat">
    <div class="composer-panel">
      <textarea name="query" rows="2" maxlength="1200" placeholder="${company ? "继续追问：利润、护城河、估值或证伪条件" : "输入公司名、港股或美股代码，例如：阿里巴巴最近怎么样？AAPL 赚钱吗？"}"></textarea>
      <div class="composer-footer">
        <div class="composer-left-tools">
          <label class="tool-chip icon-chip file-label" title="上传资料">+<input type="file" name="documents" multiple accept=".pdf,.txt,.md,.csv,.json,image/*"></label>
          <button class="tool-chip" type="button" data-action="quick" data-query="它主要靠什么赚钱？">赚钱方式</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="竞争对手有哪些？">竞争格局</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="经营质量怎么样？">经营质量</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="什么情况会证伪？">证伪条件</button>
          <button class="tool-chip emphasis" type="button" data-action="report" ${company ? "" : "disabled"}>深度研究</button>
        </div>
        <div class="composer-status">${status}</div>
        <button class="send-button" type="submit" aria-label="发送">↑</button>
      </div>
    </div>
  </form>`;
}

function renderEmptyState() {
  const examples = [
    { name: "腾讯", ticker: "0700.HK", market: "港股", q: "腾讯最近怎么样？" },
    { name: "苹果", ticker: "AAPL", market: "美股", q: "苹果赚钱吗？" },
    { name: "英伟达", ticker: "NVDA", market: "美股", q: "英伟达的护城河在哪？" },
    { name: "比亚迪", ticker: "1211.HK", market: "港股", q: "比亚迪靠什么赚钱？" }
  ];
  const caps = ["赚钱机制", "护城河", "竞争格局", "估值赔率", "什么会证伪"];
  return `<div class="empty-chat">
    <div class="hero-head">
      <p class="hero-eyebrow"><span class="hero-spark"></span>ECHO RESEARCH · 发现真正的价值</p>
      <h2>喧声之外，<br>见真知。<span class="hero-slogan-en">Seek signal. Ignore noise.</span></h2>
      <p class="hero-sub">港美股与全球科技资产的 AI 价值研究。从财报、估值、新闻与行业趋势里提取真正有价值的信号，一句话就开始，复杂研究再沉到底层。</p>
      <div class="hero-caps">${caps.map((c) => `<span class="cap-pill">${esc(c)}</span>`).join("")}</div>
    </div>
    <div class="example-grid">
      ${examples
        .map(
          (item) => `<button class="example-card" type="button" data-action="example" data-query="${esc(item.q)}">
        <span class="ex-head"><strong>${esc(item.name)}</strong><span class="ex-badge ${item.market === "美股" ? "us" : "hk"}">${esc(item.market)}</span></span>
        <span class="ex-ticker">${esc(item.ticker)}</span>
        <span class="ex-q">${esc(item.q)}</span>
      </button>`
        )
        .join("")}
    </div>
  </div>`;
}
