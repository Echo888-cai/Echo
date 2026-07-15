// Preferences, research health, PWA controls and owner diagnostics.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  statusApi,
  schedulerApi,
  researchApi,
  preferencesApi,
  notificationsApi,
  ApiError,
  type PreferencesUpdateRequest,
  type UserPreferences
} from "../lib/api";
import { notifWhen } from "../lib/format";
import { showToast } from "../lib/toast";
import { useAuth } from "../lib/auth-context";
import { Shell } from "../components/Shell";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function PwaCard() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [permission, setPermission] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") showToast("Echo Research 已安装");
    setPrompt(null);
  }
  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const next = await Notification.requestPermission();
    setPermission(next);
    showToast(next === "granted" ? "浏览器通知已开启" : "浏览器通知未开启");
  }
  return (
    <article className="settings-card">
      <h2>离线与桌面安装</h2>
      <p>离线时仍可打开研究台外壳和最近访问页面；安装后可像独立应用一样从桌面启动。</p>
      <div className="setting-row"><span>离线壳</span><strong>{"serviceWorker" in navigator ? "可用" : "浏览器不支持"}</strong></div>
      <div className="setting-row"><span>浏览器通知</span><strong>{permission === "granted" ? "已允许" : permission === "denied" ? "已拒绝" : "未开启"}</strong></div>
      {prompt ? <button type="button" className="ghost-btn" onClick={install}>安装到桌面</button> : null}
      {permission === "default" ? <button type="button" className="ghost-btn" onClick={enableNotifications}>开启浏览器通知</button> : null}
    </article>
  );
}

// ── 通知偏好 ──────────────────────────────────────────────────────────────
function NotificationPreferencesCard() {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: () => preferencesApi.get()
  });
  const p = preferencesQuery.data?.preferences;
  if (!p) return null;

  async function setPreference(key: keyof PreferencesUpdateRequest, value: boolean) {
    const data = await preferencesApi.update({ [key]: value } as PreferencesUpdateRequest);
    queryClient.setQueryData(["preferences"], data);
  }

  // `pending` = 这类提醒还没有任何代码会发出（docs/PLAN.md P3 未建功能）。开关照常可存，
  // 功能落地即自动生效，但不能让它看起来"已经在替你盯着"——一个控制着不存在功能的
  // 开关，比没有这个开关更伤信任。
  const row = (key: keyof UserPreferences, label: string, detail: string, pending = false) => (
    <label className={`pref-row${pending ? " pref-row-pending" : ""}`} key={key}>
      <span>
        <b>
          {label}
          {pending && <em className="pref-pending-tag">未接通</em>}
        </b>
        <small>{pending ? `${detail}——该提醒尚未接通，开关暂不产生通知` : detail}</small>
      </span>
      <input
        className="pref-toggle"
        type="checkbox"
        checked={Boolean(p[key])}
        onChange={(e) => setPreference(key as keyof PreferencesUpdateRequest, e.target.checked)}
      />
    </label>
  );

  return (
    <article className="settings-card">
      <h2>通知偏好</h2>
      <p>每类提醒独立开关，关闭后不落应用内通知，也不会外推。</p>
      {row("notifyDigest", "盘前速报", "港股 / 美股关注公司的重要事件")}
      {row("notifyPositions", "持仓纪律", "止损、止盈与大幅回撤", true)}
      {row("notifyFalsify", "证伪命中", "研究时设置的价格 / 基本面条件")}
      {row("notifyReview", "研究复盘", "判断长期未更新时提醒", true)}
      {row("notifyEarnings", "业绩后复核", "实际值与预期到货后的核对")}
    </article>
  );
}

// ── canary 数据源健康 ──────────────────────────────────────────────────
function canaryMark(status: string): { mark: string; tone: string } {
  if (status === "ok") return { mark: "✓", tone: "" };
  if (status === "missing" || status === "limited") return { mark: "△", tone: " is-degraded" };
  return { mark: "✗", tone: " is-down" };
}

function CanaryCard({ canary }: { canary: any }) {
  const rows: any[] = canary?.sources || [];
  const latestCheckedAt = rows
    .map((r) => String(r.latestCheckedAt || ""))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  if (!canary?.batchId) {
    return (
      <article className="settings-card">
        <h2>数据源健康（canary）</h2>
        <p>
          还没跑过 <code>npm run canary</code>——本机执行一次即可看到每个数据源的真实探测状态（不是配置态）。
        </p>
      </article>
    );
  }
  return (
    <article className="settings-card">
      <h2>数据源健康（canary）</h2>
      {/* rows arrive ordered by source name, so rows[0] is just whichever source
          sorts first — not the most recent probe. Take the actual newest. */}
      <p>最近一批探测：{notifWhen(latestCheckedAt)}。状态来自真实数据调用，不是配置检查。</p>
      {rows.map((r, i) => {
        const { mark, tone } = canaryMark(r.latestStatus);
        const failure =
          r.latestStatus !== "ok" && r.lastFailureDetail ? (
            <div className="setting-sub" key={`${r.id ?? i}-fail`}>
              最近失败：{r.lastFailureDetail}（{notifWhen(r.lastFailureAt || "")}）
            </div>
          ) : null;
        return (
          <div key={r.id ?? i}>
            <div className={`setting-row${tone}`} title={r.latestDetail || ""}>
              <span>
                {mark} {r.label}
              </span>
              <strong>{r.lastSuccessAt ? `最近成功 ${notifWhen(r.lastSuccessAt)}` : "从未成功"}</strong>
            </div>
            {failure}
          </div>
        );
      })}
    </article>
  );
}

// ── 模型网关调用留痕 ──────────────────────────────────────────────────
function LlmAuditCard({ apiStatus }: { apiStatus: any }) {
  const rows: any[] = apiStatus?.llmAudit || [];
  const usage = apiStatus?.usage;
  if (!rows.length) {
    return (
      <article className="settings-card">
        <h2>研究额度与模型调用</h2>
        <p>今日还没有模型调用。{usage?.dailyCalls ? `每日额度 ${usage.dailyCalls} 次。` : "当前未设置调用次数上限。"}</p>
      </article>
    );
  }
  const cost = usage?.estimatedCostUsd > 0 ? ` · 估算 $${Number(usage.estimatedCostUsd).toFixed(4)}` : "";
  return (
    <article className="settings-card">
      <h2>研究额度与模型调用</h2>
      <p>
        今日已用 {usage?.successfulCalls || 0}
        {usage?.dailyCalls ? ` / ${usage.dailyCalls}` : ""} 次，剩余 {usage?.remainingCalls ?? "不限"} 次；token{" "}
        {((usage?.inputTokens || 0) + (usage?.outputTokens || 0)).toLocaleString()}
        {cost}。成本只在运营方配置模型单价后显示。
      </p>
      {rows.map((r, i) => {
        const total = r.attempts || 0;
        const failRate = total ? Math.round((r.failures / total) * 100) : 0;
        const tone = r.failures > 0 && r.failures === total ? " is-down" : failRate >= 30 ? " is-degraded" : "";
        const failure =
          r.failures > 0 && r.lastFailureDetail ? (
            <div className="setting-sub" key={`${r.provider}-fail`}>
              最近失败：{r.lastFailureDetail}（{notifWhen(r.lastFailureAt || "")}）
            </div>
          ) : null;
        return (
          <div key={r.provider ?? i}>
            <div className={`setting-row${tone}`}>
              <span>
                {r.provider} · {total} 次调用（{r.failures} 次失败）
              </span>
              <strong>
                {r.avgLatencyMs != null
                  ? `均延迟 ${r.avgLatencyMs}ms · ${Number(r.inputTokens || 0) + Number(r.outputTokens || 0)} tokens`
                  : "无成功记录"}
              </strong>
            </div>
            {failure}
          </div>
        );
      })}
    </article>
  );
}

// ── factGuard 命中留痕 ────────────────────────────────────────────────
const FACT_GUARD_MODE_LABEL: Record<string, string> = {
  off: "关闭",
  shadow: "shadow（观察，用户不可见）",
  soft: "soft（低调提示）",
  full: "full（拦截+定向重答）"
};

function FactGuardCard({ apiStatus }: { apiStatus: any }) {
  const fg = apiStatus?.factGuard;
  if (!fg) return null;
  const modeLabel = FACT_GUARD_MODE_LABEL[fg.mode] || fg.mode;
  if (!fg.totalChecks) {
    return (
      <article className="settings-card">
        <h2>防幻觉护栏（factGuard）</h2>
        <p>当前模式：{modeLabel}。近 14 天还没有校验记录——发起一轮研究后就会开始累积。</p>
      </article>
    );
  }
  const tone = fg.hardRate >= 5 ? " is-degraded" : "";
  return (
    <article className="settings-card">
      <h2>防幻觉护栏（factGuard）</h2>
      <p>
        当前模式：{modeLabel}。近 14 天 {fg.runs} 次回答、{fg.totalChecks} 处数字校验（{notifWhen(fg.firstAt || "")} 起）。
      </p>
      <div className={`setting-row${tone}`}>
        <span>hard 命中率</span>
        <strong>{fg.hardRate}%</strong>
      </div>
      <div className="setting-row">
        <span>soft 命中率</span>
        <strong>{fg.softRate}%</strong>
      </div>
      <div className="setting-row">
        <span>含 hard 命中的回答</span>
        <strong>
          {fg.runsWithHard} / {fg.runs}
        </strong>
      </div>
      <p className="setting-sub">升档判断以这里的真实命中率为依据，不凭印象拍板（PLAN v3 红线 10）。</p>
    </article>
  );
}

// ── 研究记分卡 ────────────────────────────────────────────────────────
function ScorecardCard() {
  const scorecardQuery = useQuery({
    queryKey: ["research", "scorecard"],
    queryFn: () => researchApi.scorecard()
  });
  const sc = scorecardQuery.data?.global;
  if (scorecardQuery.isLoading) {
    return (
      <article className="settings-card">
        <h2>研究记分卡</h2>
        <p>加载中…</p>
      </article>
    );
  }
  if (!sc || !sc.tickerCount) {
    return (
      <article className="settings-card">
        <h2>研究记分卡</h2>
        <p>还没有判断快照——下一次判断变化时会自动开始沉淀，供以后核对"当时说的对不对"。公司页"画像"Tab 有单只票的复盘详情。</p>
      </article>
    );
  }
  if (sc.insufficientSample) {
    return (
      <article className="settings-card">
        <h2>研究记分卡</h2>
        <p>{sc.message}</p>
        <div className="setting-row">
          <span>已跟踪</span>
          <strong>{sc.tickerCount} 只票</strong>
        </div>
      </article>
    );
  }
  return (
    <article className="settings-card">
      <h2>研究记分卡</h2>
      <p>
        跨 {sc.tickerCount} 只票、{sc.matureSampleSize} 条满 14 天的判断快照。
      </p>
      <div className="setting-row">
        <span>现价落在当时估值带内</span>
        <strong>{sc.withinBandRate}%</strong>
      </div>
      {sc.towardBaseRate != null ? (
        <div className="setting-row">
          <span>向估值中枢靠拢</span>
          <strong>{sc.towardBaseRate}%</strong>
        </div>
      ) : null}
      {sc.epsBeatRate != null ? (
        <>
          <div className="setting-row">
            <span>判断之后的财报 EPS beat 率</span>
            <strong>{sc.epsBeatRate}%</strong>
          </div>
          <p className="setting-sub">样本 {sc.postEarningsSampleSize} 条（F-2：只统计快照之后、且有可比预期的财报）。</p>
        </>
      ) : null}
    </article>
  );
}

// ── 港股一手 filing 覆盖率 ───────────────────────────────────────────
function HkCoverageCard({ apiStatus }: { apiStatus: any }) {
  const cov = apiStatus?.hkFilingCoverage;
  if (!cov) return null;
  const pct = cov.totalHk ? Math.round((cov.withFirstParty / cov.totalHk) * 100) : 0;
  return (
    <article className="settings-card">
      <h2>港股一手 filing 覆盖率</h2>
      <p>
        {cov.withFirstParty}/{cov.totalHk} 支港股有 HKEX 一手三表数据（约 {pct}%），已检查 {cov.checked} 支，
        {cov.uncheckedCount} 支尚未检查。
      </p>
      <p>
        本机跑 <code>npm run hk-coverage -- --limit=20</code> 增量扩大覆盖（速率友好，可反复跑）。
      </p>
      {cov.failed?.length ? (
        <>
          <div className="setting-sub">最近失败（最多显示 5 条）：</div>
          {cov.failed.slice(0, 5).map((f: any, i: number) => (
            <div className="setting-row is-degraded" title={f.detail || ""} key={f.ticker ?? i}>
              <span>
                {f.ticker} {f.company_name || ""}
              </span>
              <strong>{f.status}</strong>
            </div>
          ))}
        </>
      ) : null}
    </article>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  const isOwner = !auth.multiUser || auth.user?.role === "owner";

  const statusQuery = useQuery({ queryKey: ["status"], queryFn: () => statusApi.get() });
  const schedQuery = useQuery({ queryKey: ["scheduler", "status"], queryFn: () => schedulerApi.status() });

  const apiStatus: any = statusQuery.data;
  const sources: any[] = apiStatus?.sources || [];
  const providers: any[] = apiStatus?.ai?.providers || [];
  const schedStatus = schedQuery.data;

  async function handleTestNotification() {
    try {
      const r = await notificationsApi.test();
      showToast(
        r.telegram === "sent"
          ? "测试通知已发送（含 Telegram）"
          : r.telegramConfigured
            ? `已落通知中心；Telegram：${r.telegram}`
            : "已落通知中心（Telegram 未配置）"
      );
    } catch (err) {
      showToast(`发送失败：${err instanceof ApiError ? err.message : "未知错误"}`);
    }
  }

  return (
    <Shell sidebar={false}>
      <section className="simple-page settings-page">
        <div className="page-head">
          <p className="eyebrow">Settings</p>
          <h1>偏好与运行状态</h1>
          <span>管理研究额度、通知偏好与个人体验。</span>
        </div>
        <div className="settings-grid">
          <NotificationPreferencesCard />
          <PwaCard />
          <LlmAuditCard apiStatus={apiStatus} />
          <ScorecardCard />
          {isOwner ? (
            <>
              <article className="settings-card">
                <h2>模型</h2>
                <p>{apiStatus?.ai?.configured ? "已配置模型网关。" : "未配置模型 Key，系统会使用本地模板。"}</p>
                {providers.length ? (
                  providers.map((p, i) => (
                    <div className="setting-row" key={p.label ?? i}>
                      <span>{p.label}</span>
                      <strong>{p.model}</strong>
                    </div>
                  ))
                ) : (
                  <div className="setting-row">
                    <span>Provider</span>
                    <strong>未配置</strong>
                  </div>
                )}
              </article>
              <article className="settings-card">
                <h2>数据源</h2>
                {sources.map((s, i) => (
                  <div className="setting-row" key={s.id ?? i}>
                    <span>{s.name}</span>
                    <strong>{s.status}</strong>
                  </div>
                ))}
              </article>
              <CanaryCard canary={apiStatus?.canary} />
              <FactGuardCard apiStatus={apiStatus} />
              <HkCoverageCard apiStatus={apiStatus} />
            </>
          ) : null}
          <article className="settings-card">
            <h2>前台策略</h2>
            <p>
              研究 / 看盘 / 设置三个分区各司其职：落地即研究（连续对话，产品灵魂）；看盘是精简关注列表，点进公司页看真价格曲线（美股日线收盘价）、研究状况、基本面、证伪条件与事件。港股曲线预留付费源，暂标"待接入"。
            </p>
          </article>
          <article className="settings-card">
            <h2>数据怎么来的</h2>
            <p>你不需要自己接任何接口。行情、财报、公告、新闻和网页证据都由平台统一接入，回答里会标注本轮用到了哪些来源、有没有联网核验。</p>
            <div className="setting-row">
              <span>研究会话</span>
              <strong>本地自动保存</strong>
            </div>
            <div className="setting-row">
              <span>证据来源</span>
              <strong>行情 / 财报 / 公告 / 网页</strong>
            </div>
          </article>
          <article className="settings-card">
            <h2>通知与推送</h2>
            <p>
              Temporal 工作流自动执行盘前/盘后速报、证伪线巡检、业绩闭环和 PostgreSQL 备份；失败会从中断步骤继续。结果进入右上角通知中心
              {schedStatus?.telegram ? "，并推送到 Telegram" : "；配置 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID（见 .env.example）可推到手机"}。
            </p>
            {schedStatus ? (
              <>
                <div className="setting-row">
                  <span>编排引擎</span>
                  <strong>{(schedStatus.scheduler as any)?.engine === "temporal" ? "Temporal" : "未连接"}</strong>
                </div>
                <div className="setting-row">
                  <span>Telegram 推送</span>
                  <strong>{schedStatus.telegram ? "已配置" : "未配置"}</strong>
                </div>
                {((schedStatus.scheduler as any)?.jobs || []).map((j: any, i: number) => (
                  <div className="setting-row" title={j.lastDetail || ""} key={j.label ?? i}>
                    <span>
                      {j.label} · {j.schedule}
                    </span>
                    <strong>{j.lastStatus === "never" ? "未运行" : `${j.lastStatus === "ok" ? "✓" : "✗"} ${notifWhen(j.lastRunAt || "")}`}</strong>
                  </div>
                ))}
              </>
            ) : (
              <div className="setting-row">
                <span>调度状态</span>
                <strong>{schedQuery.isError ? "读取失败" : "加载中…"}</strong>
              </div>
            )}
            <button type="button" className="ghost-btn" onClick={handleTestNotification}>
              发送测试通知
            </button>
          </article>
        </div>
      </section>
    </Shell>
  );
}
