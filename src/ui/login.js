// ── 登录 / 邀请注册卡（U-1）：多用户模式下未登录时的整页视图 ──────────
// 品牌语言沿用研究札记的牛皮纸 + 墨色 + 陶土红（§3.5：不另起颜色语义）。
import { S, render } from "./state.js";
import { api } from "./api.js";
import { esc } from "./format.js";

const app = document.querySelector("#app");

export function renderLogin() {
  const isRegister = S.authMode === "register";
  app.innerHTML = `
  <div class="auth-page">
    <section class="auth-card" aria-label="${isRegister ? "注册" : "登录"}">
      <div class="auth-brand">
        <span class="echo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.7 17 C9.6 17 10.9 12.5 12 6.8 C13.1 12.5 14.4 17 16.3 17"/><path d="M4.2 17 L5.2 15.9 L6.2 17.3 L7 16.4" stroke-width="1.4" opacity="0.5"/><path d="M17 16.4 L17.8 17.3 L18.8 15.9 L19.8 17" stroke-width="1.4" opacity="0.5"/></svg></span>
        <strong>Echo</strong><em>Research</em>
      </div>
      <p class="auth-tagline">喧声之外，见真知</p>
      <form data-form="auth" autocomplete="on">
        ${isRegister ? `
        <label>邀请码
          <input name="invite" type="text" required placeholder="echo-xxxxxxxx" autocomplete="off" />
        </label>` : ""}
        <label>用户名
          <input name="username" type="text" required minlength="3" maxlength="24"
                 pattern="[a-zA-Z0-9_-]+" placeholder="小写字母 / 数字 / _-" autocomplete="username" />
        </label>
        <label>密码
          <input name="password" type="password" required minlength="8"
                 placeholder="至少 8 位" autocomplete="${isRegister ? "new-password" : "current-password"}" />
        </label>
        ${S.authError ? `<p class="auth-error" role="alert">${esc(S.authError)}</p>` : ""}
        <button type="submit" class="auth-submit" ${S.authBusy ? "disabled" : ""}>
          ${S.authBusy ? "请稍候…" : isRegister ? "凭邀请码注册" : "登录"}
        </button>
      </form>
      <button type="button" class="auth-switch" data-action="auth-mode" data-mode="${isRegister ? "login" : "register"}">
        ${isRegister ? "已有账号？去登录" : "有邀请码？注册新账号"}
      </button>
      <p class="auth-note">内测阶段邀请制。研究判断仅供参考，不构成买卖建议。</p>
    </section>
  </div>`;
}

/** 提交登录/注册（app.js 的 submit 委托调这里）。成功后整页刷新，干净拉起会话态。 */
export async function submitAuth(form) {
  if (S.authBusy) return;
  S.authBusy = true;
  S.authError = "";
  render();
  try {
    const el = /** @type {any} */ (form.elements);
    const payload = {
      username: el.username.value.trim(),
      password: el.password.value
    };
    if (S.authMode === "register") /** @type {any} */ (payload).invite = el.invite.value.trim();
    const path = S.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    await api(path, { method: "POST", body: JSON.stringify(payload) });
    location.reload(); // 登录态就绪，最干净的方式是整页重启（首绘会重新拉状态/会话/通知）
  } catch (error) {
    S.authError = error.message || "失败了，再试一次";
    S.authBusy = false;
    render();
  }
}

/** 退出登录（顶栏按钮）。 */
export async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* 会话可能已过期，无所谓 */ }
  location.reload();
}
