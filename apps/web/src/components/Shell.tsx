// Global navigation, notifications, theme, sidebar and responsive layout.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { getTheme, toggleTheme, type Theme } from "../lib/theme";
import { NotificationBell } from "./NotificationBell";
import { Sidebar } from "./Sidebar";
import { Onboarding } from "./Onboarding";
import { FeedbackWidget } from "./FeedbackWidget";
import { Toast } from "./Toast";

// Shell imports the shared cascade once for every authenticated route.
import "@echo/ui/styles/00-foundation.css";
import "@echo/ui/styles/01-shell.css";
import "@echo/ui/styles/02-workspace.css";
import "@echo/ui/styles/04-components.css";
import "@echo/ui/styles/05-pages.css";
import "@echo/ui/styles/07-brand.css";
import "@echo/ui/styles/10-beta.css";

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

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} activeOptions={{ exact: to === "/" }} activeProps={{ className: "active" }}>
      {label}
    </Link>
  );
}

export function Shell({ children, sidebar = true }: { children: ReactNode; sidebar?: boolean }) {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const auth = useAuth();
  const navigate = useNavigate();
  const routerState = useRouterState();

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

  // A session-expired 401 redirects the whole app to login.
  useEffect(() => {
    if (auth.authRequired && routerState.location.pathname !== "/login") {
      navigate({ to: "/login" });
    }
  }, [auth.authRequired, routerState.location.pathname, navigate]);

  function handleThemeToggle() {
    setThemeState(toggleTheme());
  }

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      /* 会话可能已过期，无所谓 */
    }
    location.reload();
  }

  const main = sidebar ? (
    <section className="workspace">
      <Sidebar />
      {children}
    </section>
  ) : (
    children
  );

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Echo Research">
          <span className="echo-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7.7 17 C9.6 17 10.9 12.5 12 6.8 C13.1 12.5 14.4 17 16.3 17" />
              <path d="M4.2 17 L5.2 15.9 L6.2 17.3 L7 16.4" strokeWidth={1.4} opacity={0.5} />
              <path d="M17 16.4 L17.8 17.3 L18.8 15.9 L19.8 17" strokeWidth={1.4} opacity={0.5} />
            </svg>
          </span>
          <strong>Echo</strong>
          <em>Research</em>
        </Link>
        <nav>
          <NavLink to="/" label="研究" />
          <NavLink to="/watch" label="看盘" />
          <NavLink to="/portfolio" label="持仓" />
          <NavLink to="/settings" label="设置" />
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
            <button
              className="auth-chip"
              type="button"
              title={`退出登录（当前：${auth.user.displayName || auth.user.username}）`}
              onClick={handleLogout}
            >
              <span>{auth.user.displayName || auth.user.username}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          ) : null}
        </nav>
      </header>
      <main>
        <Onboarding />
        {main}
      </main>
      <FeedbackWidget />
      <Toast />
    </div>
  );
}
