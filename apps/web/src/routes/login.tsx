// Login and invite registration entry point.
import { useState, type FormEvent } from "react";
import { authApi, ApiError } from "../lib/api";

// Auth styles are route-scoped because no other page needs them.
import "@echo/ui/styles/09-auth.css";

type AuthMode = "login" | "register";

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const elements = form.elements as typeof form.elements & {
      username: HTMLInputElement;
      password: HTMLInputElement;
      invite?: HTMLInputElement;
    };
    try {
      const username = elements.username.value.trim();
      const password = elements.password.value;
      if (isRegister) {
        const invite = elements.invite?.value.trim() ?? "";
        await authApi.register({ invite, username, password });
      } else {
        await authApi.login({ username, password });
      }
      // 登录态就绪，最干净的方式是整页重启（首绘会重新拉状态/会话/通知）。
      // 必须换地址而不是原地 reload——当前就停在 /login，reload 只会把
      // 登录页刷新出来，看起来像“什么都没发生”，其实已经登录成功了。
      location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失败了，再试一次");
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isRegister ? "login" : "register");
    setError("");
  }

  return (
    <div className="auth-page">
      <section className="auth-card" aria-label={isRegister ? "注册" : "登录"}>
        <div className="auth-brand">
          <span className="echo-mark">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7.7 17 C9.6 17 10.9 12.5 12 6.8 C13.1 12.5 14.4 17 16.3 17" />
              <path
                d="M4.2 17 L5.2 15.9 L6.2 17.3 L7 16.4"
                strokeWidth={1.4}
                opacity={0.5}
              />
              <path
                d="M17 16.4 L17.8 17.3 L18.8 15.9 L19.8 17"
                strokeWidth={1.4}
                opacity={0.5}
              />
            </svg>
          </span>
          <strong>Echo</strong>
          <em>Research</em>
        </div>
        <p className="auth-tagline">喧声之外，见真知</p>
        <form data-form="auth" autoComplete="on" onSubmit={handleSubmit}>
          {isRegister ? (
            <label>
              邀请码
              <input
                name="invite"
                type="text"
                required
                placeholder="echo-xxxxxxxx"
                autoComplete="off"
              />
            </label>
          ) : null}
          <label>
            用户名
            <input
              name="username"
              type="text"
              required
              minLength={3}
              maxLength={24}
              pattern="[a-zA-Z0-9_-]+"
              placeholder="小写字母 / 数字 / _-"
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="至少 8 位"
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "请稍候…" : isRegister ? "凭邀请码注册" : "登录"}
          </button>
        </form>
        <button type="button" className="auth-switch" onClick={switchMode}>
          {isRegister ? "已有账号？去登录" : "有邀请码？注册新账号"}
        </button>
        <p className="auth-note">内测阶段邀请制。研究判断仅供参考，不构成买卖建议。</p>
      </section>
    </div>
  );
}
