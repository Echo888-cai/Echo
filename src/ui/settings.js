// ── 设置页：模型 / 数据源 / 调度与推送状态 ──────────────────
import { S, render, currentRoute } from "./state.js";
import { api } from "./api.js";
import { esc, notifWhen } from "./format.js";
import { shell } from "./shell.js";

export async function refreshStatus() {
  try {
    S.apiStatus = await api("/api/status");
  } catch {
    S.apiStatus = null;
  }
}

export async function loadSchedulerStatus() {
  if (S.schedStatusLoading) return;
  S.schedStatusLoading = true;
  try {
    S.schedStatus = await api("/api/scheduler/status");
  } catch {
    S.schedStatus = null;
  }
  S.schedStatusLoading = false;
  S.schedStatusLoaded = true;
  if (currentRoute() === "/settings") render();
}

export function renderSettings() {
  const sources = S.apiStatus?.sources || [];
  const providers = S.apiStatus?.ai?.providers || [];
  shell(`<section class="simple-page settings-page">
    <div class="page-head"><p class="eyebrow">Settings</p><h1>后台设置与状态</h1><span>模型、数据源、隐藏功能都放在这里，不打扰研究主流程。</span></div>
    <div class="settings-grid">
      <article class="settings-card"><h2>模型</h2>
        <p>${S.apiStatus?.ai?.configured ? "已配置模型网关。" : "未配置模型 Key，系统会使用本地模板。"}</p>
        ${providers.map((p) => `<div class="setting-row"><span>${esc(p.label)}</span><strong>${esc(p.model)}</strong></div>`).join("") || `<div class="setting-row"><span>Provider</span><strong>未配置</strong></div>`}
      </article>
      <article class="settings-card"><h2>数据源</h2>
        ${sources.map((s) => `<div class="setting-row"><span>${esc(s.name)}</span><strong>${esc(s.status)}</strong></div>`).join("")}
      </article>
      <article class="settings-card"><h2>前台策略</h2>
        <p>研究 / 看盘 / 设置三个分区各司其职：落地即研究（连续对话，产品灵魂）；看盘是精简关注列表，点进公司页看真价格曲线（美股日线收盘价）、研究状况、基本面、证伪条件与事件。港股曲线预留付费源，暂标"待接入"。</p>
      </article>
      <article class="settings-card"><h2>数据怎么来的</h2>
        <p>你不需要自己接任何接口。行情、财报、公告、新闻和网页证据都由平台统一接入，回答里会标注本轮用到了哪些来源、有没有上网。</p>
        <div class="setting-row"><span>研究会话</span><strong>本地自动保存</strong></div>
        <div class="setting-row"><span>证据来源</span><strong>行情 / 财报 / 公告 / 网页</strong></div>
      </article>
      <article class="settings-card"><h2>通知与推送</h2>
        <p>服务在跑时自动执行：盘前速报（港股 09:00 / 美股 21:15，北京时间）与交易时段每 30 分钟的持仓触线巡检。结果进右上角通知中心${S.schedStatus?.telegram ? "，并推送到 Telegram" : "；配置 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID（见 .env.example）可推到手机"}。</p>
        ${S.schedStatus ? `
          <div class="setting-row"><span>Telegram 推送</span><strong>${S.schedStatus.telegram ? "已配置" : "未配置"}</strong></div>
          ${(S.schedStatus.scheduler?.jobs || []).map((j) => `
            <div class="setting-row" title="${esc(j.lastDetail || "")}">
              <span>${esc(j.label)} · ${esc(j.schedule)}</span>
              <strong>${j.lastStatus === "never" ? "未运行" : `${j.lastStatus === "ok" ? "✓" : "✗"} ${notifWhen(j.lastRunAt || "")}`}</strong>
            </div>`).join("")}
        ` : `<div class="setting-row"><span>调度状态</span><strong>${S.schedStatusLoaded ? "读取失败" : "加载中…"}</strong></div>`}
        <button type="button" class="ghost-btn" data-action="notif-test">发送测试通知</button>
      </article>
    </div>
  </section>`);
}
