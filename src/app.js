// ── App 入口：路由分发 + 全局事件委托 + 初始化 ──────────────
// P5 前端模块化（ARCH-1）：状态/API/格式化/渲染都在 src/ui/*；本文件只做三件事：
// 1) render() 按路由分发到页面模块；2) 全局事件委托（data-action / data-form）；3) 启动加载。
import { S, setRenderFn, currentRoute, isViewBusy, appendMessage, toggleTheme } from "./ui/state.js";
import {
  refreshNotifUnread, toggleNotifPanel, markNotifRead, markAllNotifsRead, sendTestNotification
} from "./ui/notifications.js";
import {
  renderResearch, refreshSessions, loadSession, deleteSession, clearAllSessions,
  clearResearch, exportResearch, copyMessage, generateDeepResearch, parseFiles,
  sendChat, runComparison, switchAndResearch, researchSuggested, forceResearch, returnToCompany,
  searchSessionHistory, clearSessionHistorySearch
} from "./ui/research.js";
import {
  renderWatchPage, refreshWatchDesk, addWatch, removeWatch, exportPortrait, exportPortraitImage
} from "./ui/watch.js";
import { renderSettings, refreshStatus, loadSchedulerStatus, loadResearchScorecard } from "./ui/settings.js";
import { renderPortfolioPage, deletePortfolioPosition } from "./ui/portfolioPage.js";
import { renderLogin, submitAuth, logout } from "./ui/login.js";
import { api } from "./ui/api.js";
import { loadPreferences, completeOnboarding, submitFeedback, setPreference } from "./ui/beta.js";

function render() {
  // U-1：多用户模式且未登录 → 整页登录卡，不渲染任何研究内容。
  if (S.authRequired) { renderLogin(); return; }
  // 后台会话完成会触发 render() 重建视图——若用户正在 composer 里打字，full innerHTML 会清掉
  // 输入。渲染前抓住 textarea 内容/光标，渲染后还原，避免并行场景下"打字打一半被清空"。
  const ta = /** @type {HTMLTextAreaElement|null} */ (document.querySelector(".composer textarea"));
  const preserved = ta ? { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, focused: document.activeElement === ta } : null;
  // P7：搜索结果异步回来时（用户可能已经在继续打字）同样要保住输入框的焦点/光标，
  // 跟 composer textarea 同一个问题、同一个解法。
  const hs = /** @type {HTMLInputElement|null} */ (document.querySelector(".history-search-input"));
  const preservedSearch = hs ? { value: hs.value, start: hs.selectionStart, end: hs.selectionEnd, focused: document.activeElement === hs } : null;
  const route = currentRoute();
  if (route === "/settings") {
    if (!S.schedStatusLoaded && !S.schedStatusLoading) void loadSchedulerStatus();
    if (!S.researchScorecardLoaded && !S.researchScorecardLoading) void loadResearchScorecard();
    renderSettings();
  }
  else if (route === "/watch" || route.startsWith("/watch/")) renderWatchPage();
  else if (route === "/portfolio") renderPortfolioPage(); // M-1：持仓一级页面
  else renderResearch(); // "/" 与 "/research" 都落到研究页（灵魂入口）
  if (preserved && preserved.value) {
    const next = /** @type {HTMLTextAreaElement|null} */ (document.querySelector(".composer textarea"));
    if (next) {
      next.value = preserved.value;
      if (preserved.focused) {
        next.focus();
        try { next.setSelectionRange(preserved.start, preserved.end); } catch { /* ignore */ }
      }
    }
  }
  if (preservedSearch && preservedSearch.focused) {
    const nextSearch = /** @type {HTMLInputElement|null} */ (document.querySelector(".history-search-input"));
    if (nextSearch) {
      nextSearch.focus();
      try { nextSearch.setSelectionRange(preservedSearch.start, preservedSearch.end); } catch { /* ignore */ }
    }
  }
}
setRenderFn(render); // 各模块通过 state.render() 触发重渲染

document.addEventListener("submit", async (event) => {
  const form = /** @type {HTMLFormElement|null} */ (/** @type {Element} */ (event.target).closest("[data-form='chat']"));
  if (!form) return;
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ (/** @type {any} */ (form.elements).query);
  const question = input.value.trim();
  // 只挡"当前会话正忙"——别的会话在后台跑不影响在这条/新建里发问（并行）。
  if (!question || isViewBusy()) return;
  input.value = "";
  appendMessage("user", question);
  S.resolving = true; S.resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(question);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    S.resolving = false;
    render();
  }
});

document.addEventListener("submit", (event) => {
  const form = /** @type {HTMLFormElement|null} */ (/** @type {Element} */ (event.target).closest("[data-form='watch-add']"));
  if (!form) return;
  event.preventDefault();
  void addWatch(/** @type {HTMLInputElement} */ (/** @type {any} */ (form.elements).q).value.trim());
});

document.addEventListener("submit", (event) => {
  const form = /** @type {HTMLFormElement|null} */ (/** @type {Element} */ (event.target).closest("[data-form='feedback']"));
  if (!form) return;
  event.preventDefault();
  void submitFeedback(form);
});

// U-1：登录 / 邀请注册表单。
document.addEventListener("submit", (event) => {
  const form = /** @type {HTMLFormElement|null} */ (/** @type {Element} */ (event.target).closest("[data-form='auth']"));
  if (!form) return;
  event.preventDefault();
  void submitAuth(form);
});

document.addEventListener("click", async (event) => {
  // 通知面板：点面板外任意处收起（含点别的按钮——先收起再继续处理该按钮）。
  if (S.notifOpen && !(/** @type {Element} */ (event.target).closest(".notif-wrap"))) {
    S.notifOpen = false;
    render();
  }
  const target = /** @type {HTMLElement|null} */ (/** @type {Element} */ (event.target).closest("[data-action]"));
  if (!target) return;
  const action = target.dataset.action;
  if (action === "toggle-notifs") { void toggleNotifPanel(); return; }
  if (action === "notif-read-all") { void markAllNotifsRead(); return; }
  if (action === "notif-open") { void markNotifRead(target.dataset.id, target.dataset.ticker, target.dataset.session); return; }
  if (action === "notif-test") { void sendTestNotification(); return; }
  if (action === "new") clearResearch();
  if (action === "toggle-theme") { toggleTheme(); return; }
  if (action === "auth-mode") { S.authMode = target.dataset.mode || "login"; S.authError = ""; render(); return; }
  if (action === "logout") { void logout(); return; }
  if (action === "feedback-open") { S.feedbackOpen = true; render(); return; }
  if (action === "feedback-card") return;
  if (action === "feedback-close") {
    S.feedbackOpen = false; render(); return;
  }
  if (action === "onboarding-complete") { void completeOnboarding(); return; }
  if (action === "export") exportResearch();
  if (action === "open-stock") { location.hash = `#/watch/${target.dataset.ticker}`; render(); return; }
  if (action === "watch-filter") { S.watchFilter = target.dataset.v || "all"; render(); return; }
  if (action === "watch-sort") { S.watchSort = target.dataset.v || "urgency"; render(); return; }
  if (action === "watch-refresh") {
    if (!S.wdRefreshing) { S.wdRefreshing = true; render(); void refreshWatchDesk().finally(() => { S.wdRefreshing = false; render(); }); }
    return;
  }
  if (action === "chart-range") { S.chartRange = target.dataset.range || "3m"; render(); return; }
  if (action === "stock-tab") { S.stockTab = target.dataset.tab || "overview"; render(); return; }
  if (action === "export-portrait") { exportPortrait(); return; }
  if (action === "export-portrait-image") { exportPortraitImage(); return; }
  if (action === "watch-add-open") { S.watchAddOpen = true; S.watchAddError = ""; render(); setTimeout(() => /** @type {HTMLElement|null} */ (document.querySelector(".wl-add input"))?.focus(), 0); return; }
  if (action === "watch-add-close") { S.watchAddOpen = false; S.watchAddError = ""; render(); return; }
  if (action === "untrack-stock") { void removeWatch(target.dataset.ticker); return; }
  // 持仓管理沉在研究对话里（复用现成的自然语言记账 + 面板），从任意页点入都先切到研究页。
  if (action === "portfolio-view") { location.hash = "#/portfolio"; render(); return; }
  if (action === "load-session") await loadSession(target.dataset.id);
  if (action === "choice-act") {
    const { act, ticker, name } = target.dataset;
    if (act === "compare") await runComparison({ ticker, name });
    else if (act === "switch") await switchAndResearch({ ticker, name });
    else if (act === "research") await researchSuggested(ticker, name);
    else if (act === "force") await forceResearch(ticker);
    return;
  }
  if (action === "return-company") { await returnToCompany(target.dataset.ticker, target.dataset.name); return; }
  if (action === "delete-session") await deleteSession(target.dataset.id);
  if (action === "clear-sessions") await clearAllSessions();
  if (action === "clear-history-search") { clearSessionHistorySearch(); return; }
  if (action === "toggle-history") {
    S.historyOpen = !S.historyOpen;
    render();
  }
  if (action === "settings") location.hash = "#/settings";
  if (action === "quick") {
    const input = /** @type {HTMLTextAreaElement|null} */ (document.querySelector(".composer textarea"));
    if (input) {
      input.value = target.dataset.query || "";
      input.focus();
    }
  }
  if (action === "example") {
    if (isViewBusy()) return;
    const input = /** @type {HTMLTextAreaElement|null} */ (document.querySelector(".composer textarea"));
    if (input) {
      input.value = target.dataset.query || "";
      input.focus();
      input.closest("form")?.requestSubmit();
    }
  }
  if (action === "copy-message") await copyMessage(target.dataset.id);
  if (action === "report") await generateDeepResearch();
  if (action === "delete-position") await deletePortfolioPosition(target.dataset.ticker);
  if (action === "portfolio-add") {
    // 记账走对话（自然语言解析），composer 只活在研究页——从持仓页点进来时先跳过去。
    const onResearch = currentRoute() === "/" || currentRoute() === "/research";
    if (!onResearch) { location.hash = "#/research"; render(); }
    const input = /** @type {HTMLTextAreaElement|null} */ (document.querySelector(".composer textarea"));
    if (input) {
      input.value = "<公司名或代码> 成本 <价> 持有 <股数> 股 止损 <价> 止盈 <价>";
      input.focus();
      input.select();
    }
  }
});

document.addEventListener("change", (event) => {
  const pref = /** @type {HTMLInputElement|null} */ (/** @type {Element} */ (event.target).closest(".pref-toggle[data-pref]"));
  if (pref) { void setPreference(pref.dataset.pref, pref.checked); return; }
  const input = /** @type {HTMLInputElement|null} */ (/** @type {Element} */ (event.target).closest("input[type='file'][name='documents']"));
  if (input) void parseFiles(input);
});

// P7：历史研究搜索框——300ms 防抖，避免每敲一个字就发一次请求；render() 里的焦点/光标
// 保留逻辑（见上面 preservedSearch）保证防抖触发的重渲染不会打断正在输入。
let historySearchTimer = null;
document.addEventListener("input", (event) => {
  const input = /** @type {HTMLInputElement|null} */ (/** @type {Element} */ (event.target).closest(".history-search-input"));
  if (!input) return;
  const value = input.value;
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => void searchSessionHistory(value), 300);
});

document.addEventListener("keydown", (event) => {
  const input = /** @type {HTMLTextAreaElement|null} */ (/** @type {Element} */ (event.target).closest(".composer textarea"));
  if (!input) return;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    input.closest("form")?.requestSubmit();
  }
});

// M-1：非原生按钮但带 data-action 的可点击元素（如 .pf-card，整卡可点但删除键要留独立
// 点击区）——补上键盘可达性，Enter/空格等价于点击，行为与鼠标点击完全复用同一条 action 分发。
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const el = /** @type {HTMLElement|null} */ (event.target);
  if (!el || !el.matches?.("[data-action][tabindex]")) return;
  event.preventDefault();
  el.click();
});

window.addEventListener("hashchange", () => {
  S.notifOpen = false; // 切页时收起通知面板，别悬在新页面上
  render();
});

// U-1：先问一次身份——多用户模式且未登录时直接渲染登录卡，别的都不拉
// （拉了也全是 401）。单用户 legacy 模式（服务端没建 owner）行为与从前完全一致。
try {
  const me = await api("/api/auth/me");
  S.multiUser = !!me.multiUser;
  S.authUser = me.user || null;
  if (S.multiUser && !S.authUser) S.authRequired = true;
} catch { /* 身份接口失败按单用户处理，后续 401 拦截器会兜底 */ }
if (S.authRequired) {
  render();
} else {
  // 首绘只等轻资源（状态/会话/未读数，各 <300ms）；看盘聚合是重活，后台跑，
  // 落在 /watch 时由 refreshWatchDesk 内部分段 render（fast 先到先画）。
  await Promise.all([refreshStatus(), refreshSessions(), refreshNotifUnread(), loadPreferences()]);
  render();
  void refreshWatchDesk();
}
// 未读通知轮询：60s 一次，只做角标局部更新（renderNotifBadge），不打扰输入/滚动。
// 登录卡状态下不轮询（每次都是 401，白打）。
setInterval(() => { if (!S.authRequired) void refreshNotifUnread(); }, 60_000);
