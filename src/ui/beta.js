import { S, render, currentRoute } from "./state.js";
import { api } from "./api.js";
import { esc, toast } from "./format.js";

export async function loadPreferences() {
  try {
    const data = await api("/api/preferences");
    S.preferences = data.preferences || null;
  } catch {
    S.preferences = null;
  }
  S.preferencesLoaded = true;
}

export function renderOnboarding() {
  if (!S.preferencesLoaded || S.preferences?.onboardingCompleted) return "";
  const researched = S.recentSessions.length > 0;
  const watched = Boolean(S.watchDesk?.cards?.length);
  const held = Boolean(S.portfolioPage?.positions?.length);
  const step = (done, n, title, detail, href) => `<a class="onboard-step ${done ? "is-done" : ""}" href="${href}">
    <i>${done ? "✓" : n}</i><span><b>${esc(title)}</b><small>${esc(detail)}</small></span>
  </a>`;
  return `<section class="onboard" aria-label="首次使用引导">
    <div class="onboard-copy"><span>3 分钟上手</span><strong>把一个判断变成可持续跟踪的研究资产</strong></div>
    <div class="onboard-steps">
      ${step(researched, 1, "问一家公司", "先得到有证据的判断", "#/research")}
      ${step(watched, 2, "加入看盘", "让事件和证伪线持续更新", "#/watch")}
      ${step(held, 3, "记一笔持仓", "补上成本与纪律线", "#/portfolio")}
    </div>
    <button type="button" class="onboard-done" data-action="onboarding-complete">${researched && watched ? "完成引导" : "不再显示"}</button>
  </section>`;
}

export function renderFeedback() {
  return `<button type="button" class="feedback-fab" data-action="feedback-open" aria-label="提交反馈">反馈</button>
    ${S.feedbackOpen ? `<div class="feedback-backdrop" data-action="feedback-close">
      <section class="feedback-card" role="dialog" aria-modal="true" aria-label="提交反馈" data-feedback-card data-action="feedback-card">
        <button type="button" class="feedback-close" data-action="feedback-close" aria-label="关闭">×</button>
        <p class="eyebrow">Beta feedback</p><h2>哪里让你停顿了？</h2>
        <p>一句话就够。系统会附上当前页面与视口，不会附带研究正文或持仓数据。</p>
        <form data-form="feedback">
          <textarea name="message" minlength="2" maxlength="2000" required placeholder="例如：我不知道下一步该点哪里…"></textarea>
          <button class="primary" type="submit" ${S.feedbackBusy ? "disabled" : ""}>${S.feedbackBusy ? "提交中…" : "提交反馈"}</button>
        </form>
      </section>
    </div>` : ""}`;
}

export async function completeOnboarding() {
  const data = await api("/api/preferences", { method: "PATCH", body: JSON.stringify({ onboardingCompleted: true }) });
  S.preferences = data.preferences;
  render();
}

export async function setPreference(key, value) {
  const data = await api("/api/preferences", { method: "PATCH", body: JSON.stringify({ [key]: value }) });
  S.preferences = data.preferences;
  render();
}

export async function submitFeedback(form) {
  if (S.feedbackBusy) return;
  const message = /** @type {any} */ (form.elements).message.value.trim();
  if (!message) return;
  S.feedbackBusy = true;
  render();
  try {
    await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ message, context: { route: currentRoute(), width: window.innerWidth, theme: document.documentElement.dataset.theme || "light" } })
    });
    S.feedbackOpen = false;
    toast("谢谢，反馈已收到。");
  } catch (error) {
    toast(error.message || "提交失败，请稍后再试。");
  } finally {
    S.feedbackBusy = false;
    render();
  }
}

export function renderNotificationPreferences() {
  const p = S.preferences;
  if (!p) return "";
  const row = (key, label, detail) => `<label class="pref-row"><span><b>${esc(label)}</b><small>${esc(detail)}</small></span><input class="pref-toggle" type="checkbox" data-pref="${key}" ${p[key] ? "checked" : ""} /></label>`;
  return `<article class="settings-card"><h2>通知偏好</h2><p>每类提醒独立开关，关闭后不落应用内通知，也不会外推。</p>
    ${row("notifyDigest", "盘前速报", "港股 / 美股关注公司的重要事件")}
    ${row("notifyPositions", "持仓纪律", "止损、止盈与大幅回撤")}
    ${row("notifyFalsify", "证伪命中", "研究时设置的价格 / 基本面条件")}
    ${row("notifyReview", "研究复盘", "判断长期未更新时提醒")}
    ${row("notifyEarnings", "业绩后复核", "实际值与预期到货后的核对")}
  </article>`;
}
