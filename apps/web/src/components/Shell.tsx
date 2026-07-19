// Global navigation, notifications, theme, sidebar and responsive layout.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { getTheme, toggleTheme, type Theme } from "../lib/theme";
import { NotificationBell } from "./NotificationBell";
import { Sidebar } from "./Sidebar";
import { Toast } from "./Toast";

// Shell imports the shared cascade once for every authenticated route.
import "@echo/ui/styles/00-foundation.css";
import "@echo/ui/styles/01-shell.css";
import "@echo/ui/styles/02-workspace.css";
import "@echo/ui/styles/04-components.css";
import "@echo/ui/styles/05-pages.css";
import "@echo/ui/styles/07-brand.css";
import "@echo/ui/styles/10-beta.css";
import "@echo/ui/styles/11-signal.css";
import "@echo/ui/styles/13-evidence-system.css";

const NAV_PRELOAD: Record<string, () => Promise<unknown>> = {
  "/": () => import("../routes/research"),
  "/watch": () => import("../routes/watch"),
  "/portfolio": () => import("../routes/portfolio"),
  "/settings": () => import("../routes/settings")
};

function ThemeIcon({ theme }: { theme: Theme }) {
  // 浅色时显示月亮（点了变深色），深色时显示太阳。
  return theme === "dark" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

type NavKind = "research" | "watch" | "portfolio" | "settings";

function NavIcon({ kind }: { kind: NavKind }) {
  if (kind === "research") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 18.5V8.8L12 4l8 4.8v9.7" /><path d="M8 14h8M9 18.5v-4M15 18.5v-4" /></svg>;
  }
  if (kind === "watch") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 16.5 8.2 11l3.3 3.2L20.5 5" /><path d="M15.5 5h5v5" /></svg>;
  }
  if (kind === "portfolio") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="13" rx="3" /><path d="M8.5 6.5V5A1.5 1.5 0 0 1 10 3.5h4A1.5 1.5 0 0 1 15.5 5v1.5M3.5 11.5h17" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>;
}

function navIsActive(to: string, pathname: string) {
  if (to === "/") return pathname === "/" || pathname === "/research";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavLink({ to, label, kind, pathname }: { to: string; label: string; kind: NavKind; pathname: string }) {
  const active = navIsActive(to, pathname);
  return (
    <Link
      to={to}
      className={active ? "active" : undefined}
      aria-current={active ? "page" : undefined}
      onPointerEnter={() => { void NAV_PRELOAD[to]?.(); }}
      onFocus={() => { void NAV_PRELOAD[to]?.(); }}
    >
      <span className="nav-icon"><NavIcon kind={kind} /></span>
      <span>{label}</span>
    </Link>
  );
}

const NAV_ITEMS: Array<{ to: string; label: string; kind: NavKind }> = [
  { to: "/", label: "研究", kind: "research" },
  { to: "/watch", label: "看盘", kind: "watch" },
  { to: "/portfolio", label: "持仓", kind: "portfolio" },
  { to: "/settings", label: "设置", kind: "settings" }
];

function PrimaryNav({ pathname }: { pathname: string }) {
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ x: 0, w: 0, ready: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>("a.active");
    if (!active) {
      setIndicator((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    const next = { x: active.offsetLeft, w: active.offsetWidth, ready: true };
    setIndicator((prev) => (prev.x === next.x && prev.w === next.w && prev.ready ? prev : next));
  }, [pathname]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const sync = () => {
      const active = nav.querySelector<HTMLElement>("a.active");
      if (!active) return;
      setIndicator({ x: active.offsetLeft, w: active.offsetWidth, ready: true });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="primary-nav" aria-label="主导航" ref={navRef}>
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} {...item} pathname={pathname} />
      ))}
      <span
        className={`nav-indicator${indicator.ready ? " is-ready" : ""}`}
        style={{ width: indicator.w, transform: `translate3d(${indicator.x}px, 0, 0)` }}
        aria-hidden="true"
      />
    </nav>
  );
}

export function Shell({ children, sidebar = true }: { children: ReactNode; sidebar?: boolean }) {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const auth = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authApi.me(),
    retry: false
  });

  useEffect(() => {
    if (meQuery.data) {
      auth.setUser(meQuery.data.user);
      auth.setMultiUser(meQuery.data.multiUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.data]);

  // Redirect both an expired session and a cold unauthenticated page load.
  // `/api/auth/me` is intentionally public, so a first visit without a cookie
  // returns `{ user: null, multiUser: true }` rather than throwing a 401.
  useEffect(() => {
    const missingRequiredSession = meQuery.isSuccess && meQuery.data.multiUser && !meQuery.data.user;
    if ((auth.authRequired || missingRequiredSession) && pathname !== "/login") {
      // Use a document navigation here. A stale TanStack route tree can otherwise
      // remain interactive for one more render and submit requests without a cookie.
      window.location.replace("/login");
    }
  }, [auth.authRequired, meQuery.data, meQuery.isSuccess, pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  function handleThemeToggle() {
    setThemeState(toggleTheme());
  }

  const missingRequiredSession = meQuery.isSuccess && meQuery.data.multiUser && !meQuery.data.user;
  if (meQuery.isPending || auth.authRequired || missingRequiredSession) {
    return (
      <div className="session-gate" role="status" aria-live="polite">
        <span className="session-gate-mark" aria-hidden="true" />
        <p>正在确认研究席位</p>
      </div>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="session-gate is-error" role="alert">
        <span className="session-gate-mark" aria-hidden="true" />
        <p>暂时无法连接研究服务</p>
        <button type="button" onClick={() => window.location.reload()}>重新连接</button>
      </div>
    );
  }

  const main = sidebar ? (
    <section className={`workspace ${sidebarOpen ? "is-sidebar-open" : ""}`}>
      <Sidebar />
      <button className="sidebar-backdrop" type="button" aria-label="关闭研究上下文" aria-hidden={!sidebarOpen} tabIndex={sidebarOpen ? 0 : -1} onClick={() => setSidebarOpen(false)} />
      {children}
    </section>
  ) : (
    children
  );

  return (
    <div className={`app ${sidebar ? "app-research" : "app-standard"}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar">
        <div className="topbar-brand-zone">
          <Link className="brand" to="/" aria-label="Echo Research">
            <span className="echo-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7.7 17 C9.6 17 10.9 12.5 12 6.8 C13.1 12.5 14.4 17 16.3 17" />
                <path d="M4.2 17 L5.2 15.9 L6.2 17.3 L7 16.4" strokeWidth={1.4} opacity={0.5} />
                <path d="M17 16.4 L17.8 17.3 L18.8 15.9 L19.8 17" strokeWidth={1.4} opacity={0.5} />
              </svg>
            </span>
            <span className="brand-type">
              <strong>Echo</strong>
              <em>Evidence Research</em>
            </span>
          </Link>
        </div>
        <PrimaryNav pathname={pathname} />
        <div className="topbar-actions">
          {sidebar ? (
            <button className="context-toggle" type="button" aria-label={sidebarOpen ? "关闭研究上下文" : "打开研究上下文"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h13" /></svg>
            </button>
          ) : null}
          <NotificationBell />
          <button
            className="theme-toggle"
            type="button"
            aria-label="切换深色 / 浅色"
            title="切换深色 / 浅色"
            onClick={handleThemeToggle}
          >
            <ThemeIcon theme={theme} />
          </button>
          {auth.multiUser && auth.user ? (
            <Link
              className="auth-chip"
              to="/membership"
              title={`会员与账号（当前：${auth.user.displayName || auth.user.username}）`}
            >
              <span>{auth.user.displayName || auth.user.username}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main-content">
        {main}
      </main>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} {...item} pathname={pathname} />
        ))}
      </nav>
      <Toast />
    </div>
  );
}
