// ── 全局 UI 状态 + localStorage store + run 生命周期 ────────
// S：所有跨模块的可变 UI 状态收口在一个对象上（模块间共享引用，避免 export let 不能改的坑）。
import { uid } from "./format.js";

export const storeKeys = {
  thread: "luvio.v3.thread",
  company: "luvio.v3.company",
  panel: "luvio.v3.panel",
  documents: "luvio.v3.documents",
  sessionId: "luvio.v3.sessionId",
  conversationId: "luvio.v3.conversationId",
  theme: "luvio.v3.theme"
};

// ── render 注册表：app.js 启动时注册真正的 render；其它模块统一 import { render } 调用 ──
let renderFn = () => {};
export function setRenderFn(fn) { renderFn = fn; }
export function render() { renderFn(); }

// ── 主题：尽早应用，减少浅→深闪烁 ──
export function getTheme() {
  return localStorage.getItem(storeKeys.theme) === "dark" ? "dark" : "light";
}
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}
export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(storeKeys.theme, next);
  applyTheme(next);
  render();
}
applyTheme(getTheme());

export const S = {
  apiStatus: null,
  // U-1 鉴权：authRequired=true 时整页渲染登录卡（多用户模式且无有效会话）。
  // 单用户 legacy 模式（服务端没建 owner）下 multiUser=false，一切与从前一致。
  authUser: null,       // {id, username, displayName, role} | null
  authRequired: false,
  multiUser: false,
  authMode: "login",    // 登录卡的形态：login | register
  authError: "",
  authBusy: false,
  // P14：新用户引导、通知偏好与应用内反馈。
  preferences: null,
  preferencesLoaded: false,
  feedbackOpen: false,
  feedbackBusy: false,
  recentSessions: [],
  conversationGroups: [],
  sessionsLoaded: false,
  historyOpen: true,
  // P7：历史研究全文检索——查询串为空时侧栏显示原有分组列表，非空时显示这里的扁平搜索结果。
  historySearchQuery: "",
  historySearchResults: [],
  historySearchLoading: false,
  historySearchTooShort: false,
  // 看盘：研究过的公司 ∪ 持仓，聚合成关注列表（画像主线 + 今日最重事件 + 价格/盈亏 + 状态）。
  watchDesk: null,
  watchDeskLoaded: false,
  // 看盘台个股详情页（/watch/:ticker）：单只股票的完整聚合（卡片 + 画像 + 基本面）。
  watchStock: null,
  watchStockTicker: "",
  watchStockLoading: false,
  // 公司页双 Tab（P4 画像文档化）：总览 = 原四卡；画像 = 主档案 + 判断变化时间线 + 导出。
  stockTab: "overview",
  stockPortrait: null, // { profile, markdown } 来自 /api/company/profile
  stockPortraitLoading: false,
  // R7：该票的研究复盘（快照 vs 现价），跟画像一起加载。
  stockReview: null, // { ticker, scorecard } 来自 /api/company/review
  stockReviewLoading: false,
  // 公司页价格曲线的区间：1月 / 3月 / 1年。切换只在前端切片已加载的序列，不再打后端。
  chartRange: "3m",
  // 公司页加载序号：用它（而非当前路由）判定"这次加载是否已被更新的加载取代"，
  // 避免"点开个股→未加载完就离开→loading 卡死永远转圈"。
  watchStockSeq: 0,
  // 看盘"添加关注"输入框状态。
  watchAddOpen: false,
  watchAddBusy: false,
  watchAddError: "",
  // 看盘列表筛选/排序（纯前端，对已加载的 cards 切片）。
  watchFilter: "all",   // all | hk | us | held | risk
  watchSort: "urgency", // urgency（服务端紧急度序）| change | name
  busyTimer: null,
  // 解析阶段（识别公司/对比对象，2-5s）的瞬时指示，不绑定具体 run。
  resolving: false,
  resolvingLabel: "正在检索和思考",
  // 流式作答：只渲染"前台（当前激活）"那条 run 的 tokens；切到别的会话后，后台 run 的
  // token 不再落到当前视图（避免把 A 的流写进 B）。streamingKey 标记当前在前台流的 run。
  streamingKey: null,
  streamingText: "",
  // 通知中心：未读数 60s 轮询（只做角标局部更新，不整页重渲）；面板打开时才拉列表。
  notifUnread: 0,
  notifOpen: false,
  notifItems: [],
  notifLoading: false,
  // 设置页的调度器/推送状态（进设置页时拉一次；loaded 标志防"失败→render→再拉"循环）。
  schedStatus: null,
  schedStatusLoading: false,
  schedStatusLoaded: false,
  // R7：设置页的全局研究记分卡（同样懒加载一次）。
  researchScorecard: null,
  researchScorecardLoading: false,
  researchScorecardLoaded: false,
  // M-1：持仓一级页面（#/portfolio）——持仓列表 + 组合体检 + 每日净值快照，一次性拉齐。
  portfolioPage: null, // { positions, review, snapshots }
  portfolioPageLoading: false,
  portfolioPageLoaded: false
};

// 并行会话：每个在跑的请求一条 run（key=sessionId；新研究用 new:<ticker>）。这样推理中可以
// 切到别的对话、甚至并行再发；正在跑的会话在侧栏显示转圈，结果按 key 落回对应会话。
export const running = new Map(); // key -> { label, startedAt, reasoningChars, snapshot }

export function runKey(sessionId, ticker) { return sessionId || (ticker ? `new:${ticker}` : "new"); }
export function activeRunKey() { return runKey(getSessionId(), getCompany()?.ticker); }
export function activeRun() { return running.get(activeRunKey()) || null; }
export function isActiveBusy() { return running.has(activeRunKey()); }
// 当前视图是否在"忙"（解析阶段 或 当前会话有在跑的 run）——决定是否显示等待/流式卡。
export function isViewBusy() { return S.resolving || isActiveBusy(); }
export function snapshotActive() { return { thread: getThread(), company: getCompany(), panel: getPanel(), sessionId: getSessionId(), conversationId: getConversationId() }; }

export function startRun(key, label = "正在检索和思考") {
  running.set(key, { label, startedAt: Date.now(), reasoningChars: 0, snapshot: snapshotActive() });
  S.resolving = false;
  if (!S.busyTimer) S.busyTimer = setInterval(updateBusyClock, 1000);
}
export function endRun(key) {
  running.delete(key);
  if (S.streamingKey === key) { S.streamingKey = null; S.streamingText = ""; }
  if (!running.size && S.busyTimer) { clearInterval(S.busyTimer); S.busyTimer = null; }
}

export function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function clearStore(key) {
  localStorage.removeItem(key);
}

export function normalizeMessage(message) {
  return {
    ...message,
    id: message.id || uid("msg")
  };
}

export function getThread() {
  const thread = readStore(storeKeys.thread, []);
  if (!Array.isArray(thread)) return [];
  const normalized = thread.map(normalizeMessage);
  if (thread.some((message) => !message?.id)) writeStore(storeKeys.thread, normalized);
  return normalized;
}

export function setThread(thread) {
  writeStore(storeKeys.thread, thread.slice(-80).map(normalizeMessage));
}

export function getCompany() {
  return readStore(storeKeys.company, null);
}

export function setCompany(company) {
  writeStore(storeKeys.company, company);
}

export function getPanel() {
  return readStore(storeKeys.panel, null);
}

export function setPanel(panel) {
  writeStore(storeKeys.panel, panel);
}

export function getDocuments() {
  return readStore(storeKeys.documents, []);
}

export function setDocuments(documents) {
  writeStore(storeKeys.documents, documents.slice(-12));
}

export function getSessionId() {
  return readStore(storeKeys.sessionId, null);
}

export function setSessionId(id) {
  if (id) writeStore(storeKeys.sessionId, id);
  else clearStore(storeKeys.sessionId);
}

// EA-5.1：一次对话的分组键。和 sessionId 的区别——sessionId 每换一家公司就换新（每家公司
// 独立一行落库），conversationId 在同一次连续对话里换公司也不变（把这些行分到侧栏同一组）。
// 只在"新建研究"（clearResearch）时清空，公司切换（switch-divider）不动它。
export function getConversationId() {
  return readStore(storeKeys.conversationId, null);
}

export function setConversationId(id) {
  if (id) writeStore(storeKeys.conversationId, id);
  else clearStore(storeKeys.conversationId);
}

export function ensureConversationId() {
  let id = getConversationId();
  if (!id) { id = genSessionId(); setConversationId(id); }
  return id;
}

// 研究开始前生成稳定 sessionId（前缀 s_ 与后端 s_<uuid> 同形）。取代旧的"全程 null、跑完才落库"——
// 那会导致：生成期侧栏没条目、且每条 null 消息后端都 INSERT 新行 → 同公司重复。
export function genSessionId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? `s_${crypto.randomUUID()}` : uid("s");
}

// 确保当前视图有稳定 sessionId：有就复用、没有就新生成并落地。研究/对比/深研开始前都先调它，
// 这样 run 全程用真实 id 当键、chat 体带上它 → 后端 ON CONFLICT(id) upsert 同一行（不再重复）。
export function ensureSessionId() {
  let id = getSessionId();
  if (!id) { id = genSessionId(); setSessionId(id); }
  return id;
}

// 乐观插入/更新一条本地 session 到侧栏列表（不等服务端）。转圈靠 renderSessionItem 里的
// running.has(id)；服务端刷新时按 id 合并、服务端版覆盖乐观版（见 refreshSessions）。
// 已存在同 id（追问/深研）时保留原标题，只前置 + 标记 optimistic 让它转圈。
/**
 * @param {string} id
 * @param {{company?: {ticker?: string, nameZh?: string}, question?: string, conversationId?: string}} [opts]
 */
export function optimisticSession(id, { company, question, conversationId } = {}) {
  const existing = S.recentSessions.find((s) => s.id === id);
  const entry = {
    ...existing,
    id,
    title: existing?.title || String(question || "新研究").slice(0, 80),
    question: existing?.question || question || "",
    companyName: company?.nameZh || company?.ticker || existing?.companyName || "",
    ticker: company?.ticker || existing?.ticker || "",
    conversationId: conversationId || existing?.conversationId || id,
    updatedAt: new Date().toISOString(),
    optimistic: true
  };
  S.recentSessions = [entry, ...S.recentSessions.filter((s) => s.id !== id)];
}

export function busyElapsedSeconds() {
  const startedAt = activeRun()?.startedAt || 0;
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

const WAIT_PHASES = [
  "正在读取行情与公司档案",
  "正在检索公开网页证据",
  "正在校验来源、剔除失效链接",
  "正在综合判断与证据置信度"
];

export function waitPhase() {
  // 模型已经在推理（思考型模型出答案前的阶段）：显示活的推理字数，比静态骨架更诚实。
  const rc = activeRun()?.reasoningChars || 0;
  const streaming = S.streamingKey && S.streamingKey === activeRunKey();
  if (rc > 0 && !streaming) return `模型正在推理 · 已 ${rc} 字`;
  return WAIT_PHASES[Math.min(WAIT_PHASES.length - 1, Math.floor(busyElapsedSeconds() / 5))];
}

export function updateBusyClock() {
  const seconds = String(busyElapsedSeconds());
  document.querySelectorAll("[data-busy-seconds]").forEach((node) => {
    node.textContent = seconds;
  });
  const phase = waitPhase();
  document.querySelectorAll("[data-busy-phase]").forEach((node) => {
    if (node.textContent !== phase) node.textContent = phase;
  });
}

export function appendMessage(role, content, meta = {}, opts = {}) {
  const message = { id: uid("msg"), role, content, meta, createdAt: new Date().toISOString() };
  // 流式→最终切换时（keepScroll）：把已经流出来的文字原地定格，不要滚到底——否则用户正
  // 读着就被甩到下面（接地条骨架已占好高度，正文位置稳定，只需保住当前 scrollTop）。
  const conv = document.querySelector(".conversation");
  const prevTop = conv?.scrollTop ?? 0;
  setThread([...getThread(), message]);
  render();
  requestAnimationFrame(() => {
    const c = document.querySelector(".conversation");
    if (!c) return;
    if (opts.keepScroll) { c.scrollTop = prevTop; return; }
    c.scrollTo({ top: 999999, behavior: "smooth" });
    document.querySelector(".message:last-child")?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
}

export function currentRoute() {
  const hash = location.hash.replace(/^#/, "") || "/";
  return hash.split("?")[0] || "/";
}

// /watch/:ticker 里的 ticker（可能带 .HK 点号，hash 路径里不需要转义）。
export function routeTicker() {
  const route = currentRoute();
  const m = route.match(/^\/watch\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : "";
}
