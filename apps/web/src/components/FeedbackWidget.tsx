// React port of renderFeedback()/submitFeedback() in src/ui/beta.js — floating
// feedback button + modal form → POST /api/feedback.
import { useState, type FormEvent } from "react";
import { useRouterState } from "@tanstack/react-router";
import { feedbackApi, ApiError } from "../lib/api";
import { showToast } from "../lib/toast";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const routerState = useRouterState();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const message = (form.elements as typeof form.elements & { message: HTMLTextAreaElement }).message.value.trim();
    if (!message) return;
    setBusy(true);
    try {
      await feedbackApi.submit(message, {
        route: routerState.location.pathname,
        width: window.innerWidth,
        theme: document.documentElement.dataset.theme || "light"
      });
      setOpen(false);
      showToast("谢谢，反馈已收到。");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "提交失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="feedback-fab" aria-label="提交反馈" onClick={() => setOpen(true)}>
        反馈
      </button>
      {open ? (
        <div className="feedback-backdrop" onClick={() => setOpen(false)}>
          <section
            className="feedback-card"
            role="dialog"
            aria-modal="true"
            aria-label="提交反馈"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="feedback-close" aria-label="关闭" onClick={() => setOpen(false)}>
              ×
            </button>
            <p className="eyebrow">Beta feedback</p>
            <h2>哪里让你停顿了？</h2>
            <p>一句话就够。系统会附上当前页面与视口，不会附带研究正文或持仓数据。</p>
            <form onSubmit={handleSubmit}>
              <textarea
                name="message"
                minLength={2}
                maxLength={2000}
                required
                placeholder="例如：我不知道下一步该点哪里…"
              />
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "提交中…" : "提交反馈"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
