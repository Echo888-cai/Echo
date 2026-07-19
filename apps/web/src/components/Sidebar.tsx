// Conversation-first sidebar: new research, history, and account membership.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "../lib/auth-context";
import { useResearchStore, running, type RecentSession } from "../lib/researchStore";
import { refreshSessions, deleteSession, clearAllSessions, loadSession, clearResearch } from "../lib/researchActions";

function sessionTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function SessionItem({ session, active, onLoad, onDelete }: {
  session: RecentSession;
  active: boolean;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const inFlight = running.has(session.id);
  const title = session.title || session.question || session.companyName || session.ticker || "未命名对话";
  return (
    <div className={`session-item ${active ? "is-active" : ""} ${inFlight ? "is-running" : ""}`}>
      <button className="session-open" type="button" onClick={onLoad}>
        <strong>{title}<time>{sessionTime(session.updatedAt)}</time></strong>
        <span>{inFlight ? <><i className="session-spin" aria-hidden="true" />研究中</> : session.companyName || session.ticker || "持续对话"}</span>
      </button>
      {!inFlight ? <button className="session-delete" type="button" aria-label="删除对话" onClick={onDelete}>×</button> : null}
    </div>
  );
}

type DeleteIntent =
  | { kind: "single"; id: string; title: string }
  | { kind: "all"; count: number };

function DeleteConfirm({ intent, busy, onCancel, onConfirm }: {
  intent: DeleteIntent | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!intent) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, intent, onCancel]);

  if (!intent) return null;

  const isAll = intent.kind === "all";
  const title = isAll ? "清空全部研究对话？" : "删除这条研究对话？";
  const detail = isAll ? `将永久删除 ${intent.count} 条历史研究及其上下文。` : `“${intent.title}”`;

  return createPortal(
    <div
      className="echo-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="echo-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <div className="echo-dialog-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M8 10h16M13 10V7h6v3m-9 0 1 15h10l1-15M14 14v7m4-7v7" />
          </svg>
        </div>
        <p className="echo-dialog-eyebrow">ECHO / RESEARCH HISTORY</p>
        <h2 id="delete-dialog-title">{title}</h2>
        <p id="delete-dialog-description" className="echo-dialog-detail">{detail}</p>
        <p className="echo-dialog-warning">删除后无法恢复，相关追问也将一并移除。</p>
        <div className="echo-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>保留对话</button>
          <button className="is-danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "正在删除…" : isAll ? "确认清空" : "确认删除"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function SessionHistory() {
  const store = useResearchStore();
  const navigate = useNavigate();
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => { void refreshSessions(); }, []);

  async function confirmDelete() {
    if (!deleteIntent || deleteBusy) return;
    setDeleteBusy(true);
    const deleted = deleteIntent.kind === "all"
      ? await clearAllSessions()
      : await deleteSession(deleteIntent.id);
    setDeleteBusy(false);
    if (deleted) setDeleteIntent(null);
  }

  const count = store.recentSessions.length;
  const goto = (id: string) => void loadSession(id, () => navigate({ to: "/" }));

  return (
    <>
      <section className="history-panel">
        <header className="history-head">
          <h2 className="history-title">
            研究对话
            {count > 0 ? <span className="history-count" aria-label={`${count} 条对话`}>{count}</span> : null}
          </h2>
          {count > 0 ? (
            <button className="history-clear" type="button" onClick={() => setDeleteIntent({ kind: "all", count })}>
              清空
            </button>
          ) : null}
        </header>
        {!store.sessionsLoaded ? <div className="history-empty">正在读取对话…</div> : count ? (
          <div className="session-list">
            {store.recentSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === store.sessionId}
                onLoad={() => goto(session.id)}
                onDelete={() => setDeleteIntent({
                  kind: "single",
                  id: session.id,
                  title: session.title || session.question || session.companyName || session.ticker || "未命名研究"
                })}
              />
            ))}
          </div>
        ) : <div className="history-empty">完成第一轮研究后，可从这里继续追问。</div>}
      </section>
      <DeleteConfirm
        intent={deleteIntent}
        busy={deleteBusy}
        onCancel={() => { if (!deleteBusy) setDeleteIntent(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function AccountEntry() {
  const auth = useAuth();
  const label = auth.user?.displayName || auth.user?.username || "Echo Member";
  const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "E";
  return (
    <Link className="sidebar-account" to="/membership" aria-label="打开会员与账号">
      <span className="account-avatar">{initials}</span>
      <span className="account-copy"><strong>{label}</strong><small>FOUNDER ACCESS</small></span>
      <span className="account-arrow">↗</span>
    </Link>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  return (
    <aside className="sidebar conversation-sidebar">
      <button className="primary wide new-research" type="button" onClick={() => clearResearch(() => navigate({ to: "/" }))}>
        <span>＋</span> 新建研究对话
      </button>
      <SessionHistory />
      <AccountEntry />
    </aside>
  );
}
