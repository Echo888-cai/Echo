// Login and invite registration entry point.
import { useState, type FormEvent } from "react";
import { authApi, ApiError } from "../lib/api";
import { EvidenceWaves } from "../components/EvidenceWaves";

// Auth styles are route-scoped because no other page needs them.
import "@echo/ui/styles/09-auth.css";

type AuthMode = "login" | "register";

function EchoMark() {
  return (
    <span className="echo-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.7 17 C9.6 17 10.9 12.5 12 6.8 C13.1 12.5 14.4 17 16.3 17" />
        <path d="M4.2 17 L5.2 15.9 L6.2 17.3 L7 16.4" strokeWidth={1.4} opacity={0.5} />
        <path d="M17 16.4 L17.8 17.3 L18.8 15.9 L19.8 17" strokeWidth={1.4} opacity={0.5} />
      </svg>
    </span>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失败了，再试一次");
      setBusy(false);
    }
  }

  function selectMode(next: AuthMode) {
    setMode(next);
    setError("");
  }

  return (
    <div className="auth-page">
      <EvidenceWaves variant="dark" />
      <span className="auth-orbit" aria-hidden="true" />

      <header className="auth-mast">
        <div className="auth-brand" aria-label="Echo Research">
          <EchoMark />
          <strong>Echo</strong>
          <em>Research</em>
        </div>
      </header>

      <main className="auth-stage">
        <section className="auth-copy" aria-label="Echo Research 主张">
          <h1>
            <span className="auth-title-line">让噪音退场，</span>
            <span className="auth-title-line auth-title-emphasis">让证据发声。</span>
          </h1>
          <p className="auth-lede">
            以证据为核心，连接公告、财报、产业与市场信号，<br />
            帮助研究回归清晰判断。
          </p>
        </section>

        <section className="auth-panel" aria-label={isRegister ? "注册" : "登录"}>
          <div className="auth-panel-head">
            <p>ACCESS / ECHO</p>
            <h2>{isRegister ? "申请研究席位" : "进入研究工作台"}</h2>
            {isRegister ? <span>内测邀请制。使用邀请码激活独立席位。</span> : null}
          </div>

          <div className="auth-mode" role="tablist" aria-label="账号入口">
            <button id="auth-tab-login" type="button" role="tab" aria-selected={!isRegister} aria-controls="auth-form" tabIndex={!isRegister ? 0 : -1} className={!isRegister ? "is-active" : ""} onClick={() => selectMode("login")}>登录</button>
            <button id="auth-tab-register" type="button" role="tab" aria-selected={isRegister} aria-controls="auth-form" tabIndex={isRegister ? 0 : -1} className={isRegister ? "is-active" : ""} onClick={() => selectMode("register")}>申请试用</button>
          </div>

          <form id="auth-form" role="tabpanel" aria-labelledby={isRegister ? "auth-tab-register" : "auth-tab-login"} data-form="auth" autoComplete="on" onSubmit={handleSubmit}>
            {isRegister ? (
              <label>
                <span>邀请码 <small>INVITATION</small></span>
                <input name="invite" type="text" required placeholder="echo-xxxxxxxx" autoComplete="off" />
              </label>
            ) : null}
            <label>
              <span>邮箱 <small>ACCOUNT</small></span>
              <input name="username" type="email" required maxLength={254} placeholder="name@company.com" autoComplete="username" />
            </label>
            <label>
              <span>密码 <small>PASSWORD</small></span>
              <div className="auth-password">
                <input name="password" type={showPassword ? "text" : "password"} required minLength={8} placeholder="至少 8 位" autoComplete={isRegister ? "new-password" : "current-password"} />
                <button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button type="submit" className="auth-submit" disabled={busy}>
              <span>{busy ? "正在验证…" : isRegister ? "激活席位" : "进入 Echo"}</span>
              <i aria-hidden="true">→</i>
            </button>
          </form>

          <p className="auth-note">研究判断仅供参考，不构成任何投资或交易建议。</p>
        </section>
      </main>

      <footer className="auth-foot">
        <span>© {new Date().getFullYear()} ECHO RESEARCH</span>
        <span>LET EVIDENCE SPEAK</span>
      </footer>
    </div>
  );
}
