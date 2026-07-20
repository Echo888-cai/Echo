// Research actions operate on shared session state. They stay plain functions because they
// run across component lifecycles — a research run keeps streaming after the
// user switches to another session/page.
import {
  getThread,
  setThread,
  getCompany,
  setCompany,
  setPanel,
  getDocuments,
  setDocuments,
  getSessionId,
  setSessionId,
  setConversationId,
  ensureSessionId,
  ensureConversationId,
  genSessionId,
  optimisticSession,
  appendMessage,
  setResolving,
  setStreaming,
  addReasoningChars,
  setStage,
  startRun,
  endRun,
  runKey,
  activeRunKey,
  running,
  isViewBusy,
  getRecentSessions,
  setRecentSessions,
  setSessionsLoaded,
  type ResearchCompany,
  type Message
} from "./researchStore";
import { askApi, reportsApi, researchSessionsApi, documentsApi, chatStream, ApiError } from "./api";
import {
  resolveCompany,
  dualLegCompany,
  stripCompanyMentions,
  isComparisonQuestion,
  isMultiHoldingQuestion,
  mentionsNewCompanyStrong,
  discoveryKindOf,
  type DualListingHit
} from "./resolve";
import { provenanceFromPanel, dataSourceLabels, dataSourceGrounding } from "./answerMeta";
import { marketLabelOf } from "./format";
import { showToast } from "./toast";
import { queryClient } from "./queryClient";

function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 用户主动取消 vs 真的出错——两者的收尾文案完全不同，不能都写成"研究失败"。
 *
 * 两条路径抛的都是 DOMException("AbortError")：`chatStream` 走原生 fetch 直接抛；
 * 深度报告走 tRPC，由 api.ts 的 rpc() 负责让 abort 原样穿过（它会把别的 tRPC 错误
 * 转成 ApiError 并丢掉 cause 链，abort 必须在那之前放行）。所以这里只认这一种形状，
 * 不去猜 message 文本——靠 message 匹配来识别控制流是会随依赖升级而无声失效的。
 */
function isAbort(error: unknown): boolean {
  for (let e: any = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e instanceof DOMException && e.name === "AbortError") return true;
    if (e?.name === "AbortError") return true;
  }
  return false;
}

function refreshWatchDesk() {
  void queryClient.invalidateQueries({ queryKey: ["watch", "desk"] });
}

// ── session list ─────────────────────────────────────────────────────────
export async function refreshSessions() {
  try {
    const data = await researchSessionsApi.conversations(30);
    const groups = data.conversations || [];
    const server = groups.flatMap((g: any) => g.sessions.map((s: any) => ({ ...s, conversationId: g.conversationId })));
    const serverIds = new Set(server.map((s: any) => s.id));
    const pending = getRecentSessions().filter((s) => s.optimistic && running.has(s.id) && !serverIds.has(s.id));
    setRecentSessions([...pending, ...server]);
    const activeId = getSessionId();
    if (activeId && server.length && !serverIds.has(activeId) && !running.has(activeId)) {
      setSessionId(null);
    }
  } catch {
    // fetch failed: keep the existing list (incl. in-flight optimistic entries).
  } finally {
    setSessionsLoaded(true);
  }
}

export async function copyMessage(id: string) {
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
  showToast("已复制回答。");
}

export function clearResearch(navigate: () => void) {
  // Doesn't touch runs still going in the background (parallel). Just switches
  // the current view to a clean new research.
  setThread([]);
  setPanel(null);
  setCompany(null);
  setDocuments([]);
  setSessionId(null);
  setConversationId(null); // new research = new conversation group; switching company alone keeps the group
  showToast("已新建研究。");
  navigate();
  refreshWatchDesk();
}

function apiHistory(question = "") {
  const thread = getThread();
  const last = thread[thread.length - 1];
  const samePendingQuestion = last?.role === "user" && String(last.content || "").trim() === String(question || "").trim();
  return (samePendingQuestion ? thread.slice(0, -1) : thread).slice(-16).map((m) => ({ role: m.role, content: m.content, meta: m.meta || {}, createdAt: m.createdAt }));
}

function sessionTitle(fallbackQuestion = ""): string {
  const firstUser = getThread().find((message) => message.role === "user");
  return String(firstUser?.content || fallbackQuestion || "新研究").slice(0, 80);
}

function fallbackThreadFromSession(session: any): Message[] {
  const thread = Array.isArray(session.thread) ? session.thread.filter((m: any) => m?.role && m?.content) : [];
  if (thread.length) return thread.slice(-80);
  const restored: Message[] = [];
  if (session.question) restored.push({ id: uid("msg"), role: "user", content: session.question, createdAt: session.createdAt });
  const content = session.reportMarkdown || session.fullResearch || "";
  if (content) restored.push({ id: uid("msg"), role: "assistant", content, createdAt: session.updatedAt });
  return restored;
}

export async function loadSession(id: string, navigate: () => void) {
  if (!id) return;
  // Switching to a session still being generated: restore from the run's
  // snapshot (incl. the pending question + waiting/streaming card) rather than
  // pulling stale server state — so "leave mid-run, switch back" shows it still
  // running, not empty.
  const run = running.get(id);
  if (run?.snapshot) {
    const s = run.snapshot;
    setSessionId(s.sessionId || id);
    setConversationId(s.conversationId || s.sessionId || id);
    setCompany(s.company);
    setPanel(s.panel);
    setThread(s.thread);
    navigate();
    return;
  }
  try {
    const data = await researchSessionsApi.get(id);
    const session = data.session;
    if (!session) throw new Error("未找到研究会话");
    const panel: any = session.decisionPanel || null;
    let company: ResearchCompany | null = null;
    if (session.ticker) {
      const resolved = await resolveCompany(session.ticker);
      if (resolved && !("unresolved" in resolved) && !("unverifiedTicker" in resolved) && !("dualChoice" in resolved)) company = resolved;
    }
    if (!company && panel?.ticker) company = { ticker: panel.ticker, nameZh: panel.companyName || panel.ticker };
    setSessionId(session.id);
    setConversationId(session.conversationId || session.id);
    setCompany(company);
    setPanel(panel);
    setThread(fallbackThreadFromSession(session));
    navigate();
    showToast("已恢复历史研究。");
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : "恢复历史失败。");
  }
}

export async function deleteSession(id: string) {
  if (!id) return false;
  if (running.has(id)) {
    showToast("这条研究正在生成，完成后再删。");
    return false;
  }
  try {
    await researchSessionsApi.remove(id);
    if (getSessionId() === id) {
      setThread([]);
      setPanel(null);
      setCompany(null);
      setDocuments([]);
      setSessionId(null);
      setConversationId(null);
    }
    await refreshSessions();
    showToast("已删除历史研究。");
    return true;
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : "删除失败。");
    return false;
  }
}

export async function clearAllSessions() {
  if (!getRecentSessions().length) return false;
  if (running.size) {
    showToast("有研究正在生成，完成后再清空。");
    return false;
  }
  try {
    await researchSessionsApi.clearAll();
    setThread([]);
    setPanel(null);
    setCompany(null);
    setDocuments([]);
    setSessionId(null);
    setConversationId(null);
    await refreshSessions();
    showToast("已清空全部历史研究。");
    return true;
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : "清空失败。");
    return false;
  }
}

// ── research flow: ask / compare / switch / correct ─────────────────────

function answerMetaFromResult(result: any) {
  return {
    mode: result.mode,
    intent: result.intent || null,
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    grounding: dataSourceGrounding(result.dataSources),
    completeness: typeof result.decisionPanel?.dataCompleteness === "number" ? result.decisionPanel.dataCompleteness : null,
    missing: Array.isArray(result.decisionPanel?.missingData) ? result.decisionPanel.missingData : [],
    confidence: result.decisionPanel?.confidence || null,
    confidenceNote: result.decisionPanel?.confidenceNote || null,
    valuation: result.valuation || null,
    valuationNote: result.valuationNote || result.valuation?.cannotValueReason || null,
    valuationName: result.valuationName || null,
    analyst: result.analyst || null,
    comparison: result.comparison || null,
    otherHoldings: Array.isArray(result.otherHoldings) ? result.otherHoldings : null,
    dualQuote: result.dualQuote || null,
    evidence: provenanceFromPanel(result.decisionPanel),
    dataSources: result.dataSources || null
  };
}

// Lands one result: if this run is still in the foreground (current session) →
// update the view + appendMessage; otherwise it finished in the background
// (server already has it) → toast + refresh the sidebar only, don't touch the
// current view (the core routing for parallel conversations).
function applyChatResult(result: any, key: string, company: ResearchCompany | null): boolean {
  const label = company?.nameZh || company?.ticker || "研究";
  if (key === activeRunKey()) {
    // 先移除临时流式卡，再落最终消息，避免一次外部 store 通知中同时出现两张答案卡。
    setStreaming(null, "");
    if (result.sessionId) setSessionId(result.sessionId);
    if (result.decisionPanel) setPanel(result.decisionPanel);
    const enrichedName = result.decisionPanel?.companyName;
    if (company && enrichedName && company.nameZh === company.ticker && enrichedName !== company.ticker) {
      setCompany({ ...company, nameZh: enrichedName });
    }
    appendMessage("assistant", result.content || "本轮没有生成有效回复。", answerMetaFromResult(result));
    if (result.positionSaved) showToast(`已记账 ${label} 的持仓信息。`);
    else if (result.portrait?.created) showToast(`已为 ${label} 建立长期画像，并加入看盘。`);
    else if (result.watchRestored) showToast(`${label} 已重新加入看盘。`);
    else if (result.portrait?.changed) showToast(`已更新 ${label} 的长期画像（判断有变化）。`);
    if (result.portrait) {
      void queryClient.invalidateQueries({ queryKey: ["company", "profile", result.portrait.ticker] });
      // watchDesk is built from the company-profile union, so any create/update
      // of a profile — not just the multi-holding newlyWatched case below —
      // must invalidate it, or the freshly-researched company only shows up in
      // 看盘 after some unrelated refetch.
      refreshWatchDesk();
    }
    if (Array.isArray(result.newlyWatched) && result.newlyWatched.length) {
      const mainTicker = result.decisionPanel?.ticker || company?.ticker;
      const extras = result.newlyWatched.filter((w: any) => w.ticker !== mainTicker);
      if (extras.length) showToast(`已加入看盘：${extras.map((w: any) => w.name || w.ticker).join("、")}`);
    }
    return true;
  }
  showToast(`${label} 的研究完成了，点左侧查看。`);
  return false;
}

function appendCompareChoice(current: ResearchCompany, target: { ticker: string; name: string }) {
  const cName = current.nameZh || current.ticker;
  const tName = target.name;
  appendMessage("assistant", "", {
    type: "choice",
    choice: {
      prompt: `你是想把 ${cName} 和 ${tName} 做对比，还是改为只研究 ${tName}？`,
      options: [
        { label: `在本对话里对比：${cName} vs ${tName}`, hint: "拉两家真实数据并排比，不跳走", act: "compare", ticker: target.ticker, name: tName, recommended: true },
        { label: `只研究 ${tName}`, hint: "切换到新公司、开新研究", act: "switch", ticker: target.ticker, name: tName, recommended: false }
      ]
    }
  });
}

// 双重上市且用户没显式指定市场：问一次按哪条腿分析。两条腿的币种、行情、
// 估值口径、盈亏算法都不同，替用户默默选一边等于把口径问题藏起来。
function appendMarketChoice(question: string, dual: DualListingHit) {
  appendMessage("assistant", "", {
    type: "choice",
    choice: {
      prompt: `${dual.nameZh} 在港美两地双重上市（港股 ${dual.hk}｜美股 ${dual.us}）。你想按哪边的口径分析？行情、币种与估值都会跟着这条腿走，另一边会给实时对照。`,
      options: [
        { label: `按港股 ${dual.hk} 分析`, hint: "港币计价 · HKEX 一手披露口径", act: "market", leg: "hk", hk: dual.hk, us: dual.us, name: dual.nameZh, question, recommended: false },
        { label: `按美股 ${dual.us} 分析`, hint: "美元计价 · 美股财报口径", act: "market", leg: "us", hk: dual.hk, us: dual.us, name: dual.nameZh, question, recommended: false }
      ]
    }
  });
}

/** 选择卡回调：按选定腿开始研究。原问题已在对话里，不重复落用户消息。 */
export async function researchDualLeg(option: { leg: "hk" | "us"; hk: string; us: string; name: string; question?: string }) {
  if (isViewBusy()) return;
  const company = dualLegCompany({ nameZh: option.name, hk: option.hk, us: option.us, explicitLeg: option.leg }, option.leg);
  const q = option.question || `${option.name}最近怎么样？`;
  setResolving(true, "正在检索和思考");
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
  } finally {
    setResolving(false);
  }
}

function appendDidYouMeanChoice(badTicker: string, suggestions: { ticker: string; name: string }[] = []) {
  const options = suggestions.slice(0, 4).map((s, i) => ({
    label: `研究 ${s.ticker}${s.name && s.name !== s.ticker ? ` · ${s.name}` : ""}`,
    hint: "你可能想找这家",
    act: "research",
    ticker: s.ticker,
    name: s.name || s.ticker,
    recommended: i === 0
  }));
  options.push({ label: `仍按 ${badTicker} 研究`, hint: "冷门 / 刚 IPO 的票数据源可能还没收录", act: "force", ticker: badTicker, name: badTicker, recommended: false });
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

export async function researchSuggested(ticker: string, name: string) {
  if (!ticker || isViewBusy()) return;
  const company: ResearchCompany = { ticker, nameZh: name || ticker, nameEn: name || "", industry: "美股" };
  const q = `${name || ticker}最近怎么样？`;
  appendMessage("user", q);
  setResolving(true, "正在检索和思考");
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
  } finally {
    setResolving(false);
  }
}

export async function forceResearch(ticker: string) {
  if (!ticker || isViewBusy()) return;
  const company: ResearchCompany = { ticker, nameZh: ticker, nameEn: ticker, industry: "美股" };
  const q = `研究 ${ticker}`;
  appendMessage("user", q);
  setResolving(true, "正在检索和思考");
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
  } finally {
    setResolving(false);
  }
}

export async function runComparison(target: { ticker: string; name: string }) {
  const current = getCompany();
  if (!current?.ticker || isViewBusy()) return;
  const question = `把 ${current.nameZh || current.ticker} 和 ${target.name} 做个对比`;
  appendMessage("user", question);
  const sessionId = ensureSessionId();
  const conversationId = ensureConversationId();
  optimisticSession(sessionId, { company: current, question, conversationId });
  const key = runKey(sessionId, current.ticker);
  const controller = new AbortController();
  const stream = streamCallbacks(key);
  startRun(key, "正在对比两家公司", controller);
  try {
    const result = await chatStream(
      {
        question,
        company: current,
        compareWith: { ticker: target.ticker, nameZh: target.name },
        sessionId,
        conversationId,
        sessionTitle: sessionTitle(question),
        history: apiHistory(question),
        documents: getDocuments(),
        memory: {}
      },
      stream.callbacks,
      controller.signal
    );
    stream.stop();
    if (result) applyChatResult(result, key, current);
    else if (key === activeRunKey()) appendMessage("assistant", "本轮没有生成对比。");
  } catch (error) {
    if (isAbort(error)) {
      if (key === activeRunKey()) appendMessage("assistant", "已停止这轮对比。", { type: "aborted" });
    } else if (key === activeRunKey()) {
      appendMessage("assistant", `这轮对比失败：${error instanceof Error ? error.message : "未知错误"}。`);
    }
  } finally {
    stream.stop();
    endRun(key);
    await refreshSessions();
  }
}

export async function switchAndResearch(target: { ticker: string; name: string }) {
  if (isViewBusy()) return;
  const q = `${target.name}最近怎么样？`;
  appendMessage("user", q);
  setResolving(true, "正在检索和思考");
  try {
    await sendChat(q);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
  } finally {
    setResolving(false);
  }
}

export async function returnToCompany(ticker: string, name: string, navigate: () => void) {
  if (!ticker) return;
  const sess = getRecentSessions().find((s) => s.ticker === ticker);
  if (sess) {
    await loadSession(sess.id, navigate);
    return;
  }
  // No history for it → explicitly start a clean new research (stable id) so a
  // follow-up doesn't land on a null sessionId and INSERT a duplicate row.
  setSessionId(genSessionId());
  setPanel(null);
  setThread([]);
  setCompany({ ticker, nameZh: name || ticker, industry: marketLabelOf(ticker) });
  navigate();
}

async function runDiscovery(question: string, kind: "screener" | "macro") {
  const sessionId = ensureSessionId();
  const key = runKey(sessionId, getCompany()?.ticker);
  startRun(key, kind === "screener" ? "正在按条件筛选" : "正在梳理宏观信号");
  try {
    const result = await askApi.ask({ question, kind });
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
    appendMessage("assistant", `这轮查询失败：${error instanceof Error ? error.message : "未知错误"}。`);
  } finally {
    endRun(key);
  }
}

// Accumulates streamed tokens for the run keyed by `key` and pushes the
// running text into the store, but only while that run is in the foreground —
// a backgrounded run's tokens still accumulate (closure-local `text`) so if
// the user switches back mid-stream nothing is lost, they just don't repaint
// the (currently invisible) view on every token.
function streamCallbacks(key: string) {
  let text = "";
  let frame: number | null = null;
  let active = true;

  function paint() {
    frame = null;
    if (!active || key !== activeRunKey()) return;
    // 服务端会截断 FALSIFIERS_JSON；这里再挡一层，避免旧 API / 半截包把机器行刷进气泡。
    const cut = text.indexOf("FALSIFIERS_JSON:");
    setStreaming(key, cut >= 0 ? text.slice(0, cut).replace(/\s+$/, "") : text);
  }

  return {
    callbacks: {
      onToken: (t: string) => {
        text += t;
        // SSE 往往在一个网络包里连续给出多个 token。合并到浏览器下一帧再画，
        // 把高频全局 store 通知限制到屏幕刷新率以内。
        if (frame === null) frame = requestAnimationFrame(paint);
      },
      onReasoning: (n: number) => addReasoningChars(key, n),
      onStage: (stage: string, plan?: string[]) => setStage(key, stage, plan)
    },
    stop: () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
  };
}

// preResolved: an already-decided company (did-you-mean picked a candidate /
// "still research X anyway") — skips resolution and the verify gate. Normal
// calls pass preResolved=null and resolve as usual.
export async function sendChat(question: string, preResolved: ResearchCompany | null = null) {
  if (!preResolved) {
    const kind = discoveryKindOf(question);
    if (kind) {
      await runDiscovery(question, kind);
      return;
    }
  }
  const prevCompany = getCompany();
  let company: ResearchCompany | null = preResolved || prevCompany;
  if (!preResolved) {
    const multiHolding = Boolean(prevCompany?.ticker) && isMultiHoldingQuestion(question);
    if (!multiHolding) {
      if (prevCompany?.ticker && isComparisonQuestion(question) && mentionsNewCompanyStrong(question)) {
        setResolving(true, "正在识别对比对象");
        const target = await resolveCompany(stripCompanyMentions(question, prevCompany));
        if (target && "ticker" in target && target.ticker !== prevCompany.ticker) {
          appendCompareChoice(prevCompany, { ticker: target.ticker, name: (target as any).nameZh || target.ticker });
          setResolving(false);
          return;
        }
      }
      const shouldResolve = !company || mentionsNewCompanyStrong(question);
      if (shouldResolve) {
        setResolving(true, "正在识别公司");
        const resolved = await resolveCompany(question, { verify: true });
        if (resolved && "dualChoice" in resolved) {
          const dual = resolved.dualChoice;
          if (prevCompany && (prevCompany.ticker === dual.hk || prevCompany.ticker === dual.us)) {
            // 同一家公司已经在按某条腿研究：追问沿用当前腿，不重复问市场。
            company = prevCompany;
          } else {
            appendMarketChoice(question, dual);
            setResolving(false);
            return;
          }
        }
        if (resolved && "unresolved" in resolved) {
          appendMessage(
            "assistant",
            `我去权威数据源（FMP/交易所）查了「${resolved.name}」，没拿到能对上的上市代码，这轮就不硬答了，免得张冠李戴答成别的公司。\n\n` +
              `可以这样再问我一次：\n` +
              `- 美股：直接输代码，如 **MU**、**HOOD**，或写 **$MU**\n` +
              `- 港股：用代码，如 **0700.HK**\n` +
              `- 如果它**刚 IPO**、或是冷门标的（数据源可能还没收录），直接把股票代码发我最稳\n` +
              `- 也可以写更完整、更标准的公司名`
          );
          setResolving(false);
          return;
        }
        if (resolved && "unverifiedTicker" in resolved) {
          appendDidYouMeanChoice(resolved.unverifiedTicker, resolved.suggestions);
          setResolving(false);
          return;
        }
        if (resolved && "ticker" in resolved) company = resolved;
      }
    }
  }
  if (!company) {
    appendMessage("assistant", "我还没有识别出公司。请补充公司名、港股代码或美股代码，例如 0700.HK 腾讯、AAPL 苹果。");
    setResolving(false);
    return;
  }

  // Company change → start a fresh research session so context never bleeds.
  const switched = Boolean(prevCompany?.ticker && company.ticker && company.ticker !== prevCompany.ticker);
  if (switched) {
    const thread = getThread();
    const pending = thread[thread.length - 1];
    setSessionId(null);
    setPanel(null);
    setThread(pending?.role === "user" ? [pending] : []);
  }
  setCompany(company);
  if (company.dualListing && (switched || !prevCompany?.ticker)) {
    const other = company.dualListing.chosen === company.dualListing.hk ? `美股 ${company.dualListing.us}` : `港股 ${company.dualListing.hk}`;
    showToast(`${company.nameZh} 双重上市：本轮按 ${company.dualListing.chosen} 口径分析，${other} 仅作实时对照。`);
  }
  const sessionId = ensureSessionId();
  const conversationId = ensureConversationId();
  optimisticSession(sessionId, { company, question, conversationId });
  const key = runKey(sessionId, company.ticker);
  const controller = new AbortController();
  const stream = streamCallbacks(key);
  startRun(key, "正在检索和思考", controller);
  try {
    const result = await chatStream(
      {
        question,
        company,
        sessionId,
        conversationId,
        sessionTitle: sessionTitle(question),
        history: apiHistory(question),
        documents: getDocuments(),
        memory: {}
      },
      stream.callbacks,
      controller.signal
    );
    stream.stop();
    if (result) applyChatResult(result, key, company);
    else if (key === activeRunKey()) appendMessage("assistant", "本轮没有生成有效回复。");
  } catch (error) {
    if (isAbort(error)) {
      // 用户主动停的：不写错误气泡（那会读起来像"失败了"），只留一条中性痕迹说明这轮没有结论。
      if (key === activeRunKey()) appendMessage("assistant", "已停止这轮研究。可以改问题重新开始。", { type: "aborted" });
    } else if (key === activeRunKey()) {
      appendMessage("assistant", `这轮研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
    }
  } finally {
    stream.stop();
    endRun(key);
    await refreshSessions();
  }
}

export async function generateDeepResearch() {
  if (isViewBusy()) return;
  const company = getCompany();
  const thread = getThread();
  if (!company) {
    showToast("先输入公司或股票代码。");
    return;
  }
  const lastQuestion = [...thread].reverse().find((m) => m.role === "user")?.content || `分析 ${company.ticker}`;
  const sessionId = ensureSessionId();
  const conversationId = ensureConversationId();
  optimisticSession(sessionId, { company, question: lastQuestion, conversationId });
  const key = runKey(sessionId, company.ticker);
  const controller = new AbortController();
  startRun(key, "正在生成深度研究", controller);
  try {
    const result = await reportsApi.generate({
      question: lastQuestion,
      company,
      sessionId,
      conversationId,
      sessionTitle: sessionTitle(lastQuestion),
      documents: getDocuments(),
      history: thread.slice(-16).map((m) => ({ role: m.role, content: m.content })),
      memory: {}
    }, controller.signal);
    if (key === activeRunKey()) {
      if (result.sessionId) setSessionId(result.sessionId);
      if (result.decisionPanel) setPanel(result.decisionPanel);
      appendMessage("assistant", result.markdown || "深度研究没有生成有效内容。", { type: "deep_research", mode: result.mode, model: result.model });
      const label = company.nameZh || company.ticker;
      if (result.portrait?.created) showToast(`已为 ${label} 建立长期画像，并加入看盘。`);
      else if (result.portrait?.changed) showToast(`已更新 ${label} 的长期画像（判断有变化）。`);
      if (result.portrait) void queryClient.invalidateQueries({ queryKey: ["company", "profile", result.portrait.ticker] });
      if (result.engine === "inline-fallback") showToast(result.engineNote || "Temporal 未连接，本次报告已降级为同步生成。");
    } else {
      showToast(`${company.nameZh || company.ticker} 的深度研究完成了，点左侧查看。`);
    }
  } catch (error) {
    if (isAbort(error)) {
      if (key === activeRunKey()) appendMessage("assistant", "已停止这轮深度研究。", { type: "aborted" });
    } else if (key === activeRunKey()) {
      appendMessage("assistant", `深度研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
    }
  } finally {
    endRun(key);
    await refreshSessions();
  }
}

export async function parseFiles(files: FileList | File[]) {
  const list = [...files];
  if (!list.length) return;
  const docs = [];
  for (const file of list) {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await documentsApi.parse({ name: file.name, type: file.type, dataUrl, ticker: getCompany()?.ticker || null });
    docs.push(response.document);
  }
  setDocuments([...getDocuments(), ...docs]);
  showToast(`已上传 ${docs.length} 个资料。`);
}
