// ── 通知中心：未读角标 + 面板 + 已读闭环 ────────────────────
import { S, render } from "./state.js";
import { api } from "./api.js";
import { esc, toast, notifWhen } from "./format.js";

export async function refreshNotifUnread() {
  try {
    const data = await api("/api/notifications/unread");
    const next = Number(data.unread) || 0;
    if (next !== S.notifUnread) {
      S.notifUnread = next;
      renderNotifBadge();
    }
  } catch { /* 通知不可用不打扰研究主流程 */ }
}

// 只动角标 DOM，不整页重渲（60s 轮询下整页重渲会打断输入/滚动）。
export function renderNotifBadge() {
  const bell = document.querySelector(".notif-bell");
  if (!bell) return;
  const dot = bell.querySelector(".notif-dot");
  if (S.notifUnread > 0) {
    const label = S.notifUnread > 99 ? "99+" : String(S.notifUnread);
    if (dot) dot.textContent = label;
    else bell.insertAdjacentHTML("beforeend", `<i class="notif-dot">${label}</i>`);
  } else if (dot) {
    dot.remove();
  }
}

export async function toggleNotifPanel() {
  S.notifOpen = !S.notifOpen;
  if (!S.notifOpen) { render(); return; }
  S.notifLoading = true;
  render();
  try {
    const data = await api("/api/notifications?limit=20");
    S.notifItems = data.notifications || [];
    S.notifUnread = Number(data.unread) || 0;
  } catch {
    S.notifItems = [];
  }
  S.notifLoading = false;
  render();
}

export async function markNotifRead(id, ticker) {
  try {
    const data = await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ id }) });
    S.notifUnread = Number(data.unread) || 0;
    const item = S.notifItems.find((n) => n.id === Number(id));
    if (item) item.readAt = item.readAt || new Date().toISOString();
  } catch { /* 已读失败不阻断跳转 */ }
  if (ticker) {
    S.notifOpen = false;
    location.hash = `#/watch/${encodeURIComponent(ticker)}`;
  }
  render();
}

export async function markAllNotifsRead() {
  try {
    await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) });
    S.notifUnread = 0;
    S.notifItems = S.notifItems.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }));
  } catch { /* ignore */ }
  render();
}

export async function sendTestNotification() {
  try {
    const r = await api("/api/notifications/test", { method: "POST", body: "{}" });
    toast(r.telegram === "sent" ? "测试通知已发送（含 Telegram）" : r.telegramConfigured ? `已落通知中心；Telegram：${r.telegram}` : "已落通知中心（Telegram 未配置）");
    void refreshNotifUnread();
  } catch (err) {
    toast(`发送失败：${err.message}`);
  }
}

const NOTIF_KIND_META = {
  digest: { label: "速报", cls: "nk-digest" },
  position_alert: { label: "触线", cls: "nk-alert" },
  falsify_alert: { label: "证伪", cls: "nk-falsify" },
  system: { label: "系统", cls: "nk-system" }
};

export function renderNotifPanel() {
  const head = `<div class="notif-head"><strong>通知</strong>
    ${S.notifUnread > 0 ? `<button type="button" class="notif-readall" data-action="notif-read-all">全部已读</button>` : ""}
  </div>`;
  let body;
  if (S.notifLoading) {
    body = `<div class="notif-empty">加载中…</div>`;
  } else if (!S.notifItems.length) {
    body = `<div class="notif-empty">暂无通知。盘前速报、持仓触线提醒会出现在这里——服务在跑就会自动送达，不用手动查。</div>`;
  } else {
    body = S.notifItems.map((n) => {
      const meta = NOTIF_KIND_META[n.kind] || NOTIF_KIND_META.system;
      return `<button type="button" class="notif-item ${n.readAt ? "" : "is-unread"}" data-action="notif-open" data-id="${n.id}" data-ticker="${esc(n.ticker || "")}">
        <span class="notif-kind ${meta.cls}">${meta.label}</span>
        <span class="notif-main">
          <span class="notif-title">${esc(n.title)}</span>
          ${n.body ? `<span class="notif-body">${esc(n.body)}</span>` : ""}
        </span>
        <span class="notif-when">${notifWhen(n.createdAt)}</span>
      </button>`;
    }).join("");
  }
  return `<div class="notif-panel" role="dialog" aria-label="通知中心">${head}<div class="notif-list">${body}</div></div>`;
}
