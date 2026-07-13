// React port of src/ui/notifications.js — bell badge (60s unread poll) +
// dropdown panel (list / mark-read / mark-all-read). Same DOM/classes as the
// legacy renderNotifPanel() so 01-shell.css applies unmodified.
//
// Deviation from legacy (intentional, scope-limited): markNotifRead() in the
// old app deep-links back to the research session or watch page that the
// notification is about. Those routes don't exist yet in this slice (R-3
// ships shell + settings only), so clicking a notification here only marks
// it read — the session/ticker jump returns once the research/watch pages
// are migrated.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, type NotificationItem } from "../lib/api";
import { notifWhen } from "../lib/format";

const NOTIF_KIND_META: Record<string, { label: string; cls: string }> = {
  digest: { label: "速报", cls: "nk-digest" },
  position_alert: { label: "触线", cls: "nk-alert" },
  falsify_alert: { label: "证伪", cls: "nk-falsify" },
  review_reminder: { label: "复盘", cls: "nk-falsify" },
  system: { label: "系统", cls: "nk-system" }
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const queryClient = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => notificationsApi.unread(),
    refetchInterval: 60_000
  });
  const unread = unreadQuery.data?.unread ?? 0;

  const listQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => notificationsApi.list(20),
    enabled: open
  });

  // Close on outside click, matching the legacy panel's implicit dismiss behavior.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  async function handleMarkRead(id: number) {
    try {
      const data = await notificationsApi.markRead(id);
      queryClient.setQueryData(["notifications", "unread"], data);
      queryClient.setQueryData(["notifications", "list"], (prev: typeof listQuery.data) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) =>
                n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n
              )
            }
          : prev
      );
    } catch {
      /* 已读失败不阻断关闭面板 */
    }
    setOpen(false);
  }

  async function handleMarkAllRead() {
    try {
      await notificationsApi.markAllRead();
    } catch {
      /* ignore */
    }
    queryClient.setQueryData(["notifications", "unread"], { unread: 0 });
    queryClient.setQueryData(["notifications", "list"], (prev: typeof listQuery.data) =>
      prev
        ? { ...prev, unread: 0, notifications: prev.notifications.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })) }
        : prev
    );
  }

  const items: NotificationItem[] = listQuery.data?.notifications ?? [];

  return (
    <span className="notif-wrap" ref={wrapRef}>
      <button
        className="notif-bell"
        type="button"
        aria-label="通知"
        title="通知"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? <i className="notif-dot">{unread > 99 ? "99+" : unread}</i> : null}
      </button>
      {open ? (
        <div className="notif-panel" role="dialog" aria-label="通知中心">
          <div className="notif-head">
            <strong>通知</strong>
            {unread > 0 ? (
              <button type="button" className="notif-readall" onClick={handleMarkAllRead}>
                全部已读
              </button>
            ) : null}
          </div>
          <div className="notif-list">
            {listQuery.isLoading ? (
              <div className="notif-empty">加载中…</div>
            ) : !items.length ? (
              <div className="notif-empty">
                暂无通知。盘前速报、持仓触线提醒会出现在这里——服务在跑就会自动送达，不用手动查。
              </div>
            ) : (
              items.map((n) => {
                const meta = NOTIF_KIND_META[n.kind] || NOTIF_KIND_META.system;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`notif-item ${n.readAt ? "" : "is-unread"}`}
                    onClick={() => handleMarkRead(n.id)}
                  >
                    <span className={`notif-kind ${meta.cls}`}>{meta.label}</span>
                    <span className="notif-main">
                      <span className="notif-title">{n.title}</span>
                      {n.body ? <span className="notif-body">{n.body}</span> : null}
                    </span>
                    <span className="notif-when">{notifWhen(n.createdAt)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}
