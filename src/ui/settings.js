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

// G-1：canary 状态字（source health）→ 面板展示的 mark + 语气类名。
function canaryMark(status) {
  if (status === "ok") return { mark: "✓", tone: "" };
  if (status === "missing" || status === "limited") return { mark: "△", tone: " is-degraded" };
  return { mark: "✗", tone: " is-down" };
}

function renderCanaryCard() {
  const canary = S.apiStatus?.canary;
  const rows = canary?.sources || [];
  if (!canary?.batchId) {
    return `<article class="settings-card"><h2>数据源健康（canary）</h2>
      <p>还没跑过 <code>npm run canary</code>——本机执行一次即可看到每个数据源的真实探测状态（不是配置态）。</p>
    </article>`;
  }
  return `<article class="settings-card"><h2>数据源健康（canary）</h2>
    <p>最近一批探测：${notifWhen(rows[0]?.latestCheckedAt || "")}。状态来自真实数据调用，不是配置检查。</p>
    ${rows.map((r) => {
      const { mark, tone } = canaryMark(r.latestStatus);
      const failure = r.latestStatus !== "ok" && r.lastFailureDetail ? `<div class="setting-sub">最近失败：${esc(r.lastFailureDetail)}（${notifWhen(r.lastFailureAt || "")}）</div>` : "";
      return `<div class="setting-row${tone}" title="${esc(r.latestDetail || "")}">
        <span>${mark} ${esc(r.label)}</span>
        <strong>${r.lastSuccessAt ? `最近成功 ${notifWhen(r.lastSuccessAt)}` : "从未成功"}</strong>
      </div>${failure}`;
    }).join("")}
  </article>`;
}

// E4：模型网关调用留痕面板——谁在接、各自延迟/失败率、最近失败原因，取代此前纯 console 的运维盲区。
function renderLlmAuditCard() {
  const rows = S.apiStatus?.llmAudit || [];
  if (!rows.length) {
    return `<article class="settings-card"><h2>模型调用（近 7 天）</h2>
      <p>还没有调用留痕——发起一轮研究后，每次 provider 尝试（含 failover）都会记一行。</p>
    </article>`;
  }
  return `<article class="settings-card"><h2>模型调用（近 7 天）</h2>
    ${rows.map((r) => {
      const total = r.attempts || 0;
      const failRate = total ? Math.round((r.failures / total) * 100) : 0;
      const tone = r.failures > 0 && r.failures === total ? " is-down" : failRate >= 30 ? " is-degraded" : "";
      const failure = r.failures > 0 && r.lastFailureDetail ? `<div class="setting-sub">最近失败：${esc(r.lastFailureDetail)}（${notifWhen(r.lastFailureAt || "")}）</div>` : "";
      return `<div class="setting-row${tone}">
        <span>${esc(r.provider)} · ${total} 次调用（${r.failures} 次失败）</span>
        <strong>${r.avgLatencyMs != null ? `均延迟 ${r.avgLatencyMs}ms` : "无成功记录"}</strong>
      </div>${failure}`;
    }).join("")}
  </article>`;
}

function renderHkCoverageCard() {
  const cov = S.apiStatus?.hkFilingCoverage;
  if (!cov) return "";
  const pct = cov.totalHk ? Math.round((cov.withFirstParty / cov.totalHk) * 100) : 0;
  return `<article class="settings-card"><h2>港股一手 filing 覆盖率</h2>
    <p>${cov.withFirstParty}/${cov.totalHk} 支港股有 HKEX 一手三表数据（约 ${pct}%），已检查 ${cov.checked} 支，${cov.uncheckedCount} 支尚未检查。</p>
    <p>本机跑 <code>npm run hk-coverage -- --limit=20</code> 增量扩大覆盖（速率友好，可反复跑）。</p>
    ${cov.failed?.length ? `<div class="setting-sub">最近失败（最多显示 5 条）：</div>
      ${cov.failed.slice(0, 5).map((f) => `<div class="setting-row is-degraded" title="${esc(f.detail || "")}">
        <span>${esc(f.ticker)} ${esc(f.company_name || "")}</span>
        <strong>${esc(f.status)}</strong>
      </div>`).join("")}` : ""}
  </article>`;
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
      ${renderCanaryCard()}
      ${renderLlmAuditCard()}
      ${renderHkCoverageCard()}
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
  </section>`, { sidebar: false });
}
