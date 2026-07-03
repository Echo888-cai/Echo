// ── 页面外壳：顶栏（品牌 / 导航 / 通知铃 / 主题切换）─────────
import { S, currentRoute, getTheme } from "./state.js";
import { renderNotifPanel } from "./notifications.js";

const app = document.querySelector("#app");

export function shell(content) {
  app.innerHTML = `
    <div class="app">
      <header class="topbar">
        <a class="brand" href="#/" aria-label="Echo Research"><span class="echo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.7 17 C9.6 17 10.9 12.5 12 6.8 C13.1 12.5 14.4 17 16.3 17"/><path d="M4.2 17 L5.2 15.9 L6.2 17.3 L7 16.4" stroke-width="1.4" opacity="0.5"/><path d="M17 16.4 L17.8 17.3 L18.8 15.9 L19.8 17" stroke-width="1.4" opacity="0.5"/></svg></span><strong>Echo</strong><em>Research</em></a>
        <nav>
          ${nav("/research", "研究")}
          ${nav("/watch", "看盘")}
          ${nav("/settings", "设置")}
          <span class="notif-wrap">
            <button class="notif-bell" type="button" data-action="toggle-notifs" aria-label="通知" title="通知">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
              ${S.notifUnread > 0 ? `<i class="notif-dot">${S.notifUnread > 99 ? "99+" : S.notifUnread}</i>` : ""}
            </button>
            ${S.notifOpen ? renderNotifPanel() : ""}
          </span>
          <button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="切换深色 / 浅色" title="切换深色 / 浅色">${themeIcon()}</button>
        </nav>
      </header>
      <main>${content}</main>
    </div>`;
}

function nav(path, label) {
  const route = currentRoute();
  // 落地页 "/" 就是研究页，所以研究 Tab 在 "/" 与 "/research" 都高亮。
  const active = path === "/research"
    ? route === "/" || route === "/research" || route.startsWith("/research/")
    : route === path || route.startsWith(`${path}/`);
  return `<a class="${active ? "active" : ""}" href="#${path}">${label}</a>`;
}

function themeIcon() {
  // 浅色时显示月亮（点了变深色），深色时显示太阳。
  return getTheme() === "dark"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
}
