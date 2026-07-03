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
  sendChat, runComparison, switchAndResearch, researchSuggested, forceResearch, returnToCompany
} from "./ui/research.js";
import {
  renderWatchPage, refreshWatchDesk, addWatch, removeWatch, exportPortrait
} from "./ui/watch.js";
import { renderSettings, refreshStatus, loadSchedulerStatus } from "./ui/settings.js";
import { showPortfolio, deletePortfolioPosition } from "./ui/portfolio.js";

function render() {
  // 后台会话完成会触发 render() 重建视图——若用户正在 composer 里打字，full innerHTML 会清掉
  // 输入。渲染前抓住 textarea 内容/光标，渲染后还原，避免并行场景下"打字打一半被清空"。
  const ta = document.querySelector(".composer textarea");
  const preserved = ta ? { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, focused: document.activeElement === ta } : null;
  const route = currentRoute();
  if (route === "/settings") {
    if (!S.schedStatusLoaded && !S.schedStatusLoading) void loadSchedulerStatus();
    renderSettings();
  }
  else if (route === "/watch" || route.startsWith("/watch/")) renderWatchPage();
  else renderResearch(); // "/" 与 "/research" 都落到研究页（灵魂入口）
  if (preserved && preserved.value) {
    const next = document.querySelector(".composer textarea");
    if (next) {
      next.value = preserved.value;
      if (preserved.focused) {
        next.focus();
        try { next.setSelectionRange(preserved.start, preserved.end); } catch { /* ignore */ }
      }
    }
  }
}
setRenderFn(render); // 各模块通过 state.render() 触发重渲染

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form='chat']");
  if (!form) return;
  event.preventDefault();
  const input = form.elements.query;
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
  const form = event.target.closest("[data-form='watch-add']");
  if (!form) return;
  event.preventDefault();
  void addWatch(form.elements.q.value.trim());
});

document.addEventListener("click", async (event) => {
  // 通知面板：点面板外任意处收起（含点别的按钮——先收起再继续处理该按钮）。
  if (S.notifOpen && !event.target.closest(".notif-wrap")) {
    S.notifOpen = false;
    render();
  }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "toggle-notifs") { void toggleNotifPanel(); return; }
  if (action === "notif-read-all") { void markAllNotifsRead(); return; }
  if (action === "notif-open") { void markNotifRead(target.dataset.id, target.dataset.ticker); return; }
  if (action === "notif-test") { void sendTestNotification(); return; }
  if (action === "new") clearResearch();
  if (action === "toggle-theme") { toggleTheme(); return; }
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
  if (action === "watch-add-open") { S.watchAddOpen = true; S.watchAddError = ""; render(); setTimeout(() => document.querySelector(".wl-add input")?.focus(), 0); return; }
  if (action === "watch-add-close") { S.watchAddOpen = false; S.watchAddError = ""; render(); return; }
  if (action === "untrack-stock") { void removeWatch(target.dataset.ticker); return; }
  // 持仓管理沉在研究对话里（复用现成的自然语言记账 + 面板），从任意页点入都先切到研究页。
  if (action === "portfolio-view") { location.hash = "#/research"; render(); await showPortfolio(); return; }
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
  if (action === "toggle-history") {
    S.historyOpen = !S.historyOpen;
    render();
  }
  if (action === "settings") location.hash = "#/settings";
  if (action === "quick") {
    const input = document.querySelector(".composer textarea");
    if (input) {
      input.value = target.dataset.query || "";
      input.focus();
    }
  }
  if (action === "example") {
    if (isViewBusy()) return;
    const input = document.querySelector(".composer textarea");
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
    const input = document.querySelector(".composer textarea");
    if (input) {
      input.value = "<公司名或代码> 成本 <价> 持有 <股数> 股 止损 <价> 止盈 <价>";
      input.focus();
      input.select();
    }
  }
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("input[type='file'][name='documents']");
  if (input) void parseFiles(input);
});

document.addEventListener("keydown", (event) => {
  const input = event.target.closest(".composer textarea");
  if (!input) return;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    input.closest("form")?.requestSubmit();
  }
});

window.addEventListener("hashchange", () => {
  S.notifOpen = false; // 切页时收起通知面板，别悬在新页面上
  render();
});

// 首绘只等轻资源（状态/会话/未读数，各 <300ms）；看盘聚合是重活，后台跑，
// 落在 /watch 时由 refreshWatchDesk 内部分段 render（fast 先到先画）。
await Promise.all([refreshStatus(), refreshSessions(), refreshNotifUnread()]);
render();
void refreshWatchDesk();
// 未读通知轮询：60s 一次，只做角标局部更新（renderNotifBadge），不打扰输入/滚动。
setInterval(() => void refreshNotifUnread(), 60_000);
