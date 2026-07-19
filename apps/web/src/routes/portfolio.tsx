// Portfolio overview, net-worth chart, discipline review and positions.
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { portfolioApi, ApiError } from "../lib/api";
import { pnlDir } from "../lib/format";
import { buildChartPaths } from "../lib/chart";
import { showToast } from "../lib/toast";
import { PageErrorState, PageSkeleton } from "../components/PageState";
import { PositionCard, PortfolioReviewCard } from "../components/Portfolio";

// Page-specific styles not already loaded by Shell (see login.tsx for the
// same locally-scoped-import pattern): 06-watch.css for the shared .wd-*/
// .page-wide scaffolding, 08-portfolio.css for the .pfp-*/.pf-* rules, and
// 03-research.css for .pr-* (the portfolio-review card's rules live there —
// it started life as a chat-panel component, per portfolio.js's header comment).
import "@echo/ui/styles/03-research.css";
import "@echo/ui/styles/06-watch.css";
import "@echo/ui/styles/08-portfolio.css";

// Same approximate FX constants as services/portfolioReview.js /
// portfolioSnapshot.js — all three places must agree (PLAN v4 红线 11).
const FX_TO_USD: Record<string, number> = { USD: 1, HKD: 1 / 7.8, CNY: 1 / 7.2 };

function OverviewBanner({ positions, review }: { positions: any[]; review: any }) {
  const totals: any[] = review?.totals || [];
  if (!totals.length) return null;
  const totalValueUsd = totals.reduce((s, t) => s + t.marketValue * (FX_TO_USD[t.currency] || 1), 0);
  const totalPnlUsd = totals.reduce((s, t) => s + t.pnl * (FX_TO_USD[t.currency] || 1), 0);
  const totalCostUsd = totalValueUsd - totalPnlUsd;
  const totalPnlPct = totalCostUsd ? (totalPnlUsd / totalCostUsd) * 100 : null;

  let dayPnlUsd = 0;
  let hasDay = false;
  for (const p of positions) {
    if (p.marketValue == null || typeof p.changePct !== "number") continue;
    hasDay = true;
    // marketValue is today's price × shares, not yesterday's market value. At
    // day change rate r, yesterday's value was marketValue / (1 + r), so
    // today's P&L = marketValue × r / (1 + r); multiplying by r directly
    // would systematically overstate it.
    const rate = p.changePct / 100;
    if (rate > -1) dayPnlUsd += p.marketValue * (FX_TO_USD[p.currency] || 1) * (rate / (1 + rate));
  }

  return (
    <div className="pfp-banner">
      <div className="pfp-banner-main">
        <span className="pfp-banner-label">
          组合总市值 <em title="按 USD≈7.8 HKD 折算">≈</em>
        </span>
        <span className="pfp-banner-value">${Math.round(totalValueUsd).toLocaleString()}</span>
        <span className={`pfp-banner-pnl ${pnlDir(totalPnlUsd)}`}>
          {totalPnlUsd >= 0 ? "+" : "−"}${Math.round(Math.abs(totalPnlUsd)).toLocaleString()}
          {totalPnlPct != null ? ` (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)` : ""}
        </span>
        {hasDay ? (
          <span className={`pfp-banner-day ${pnlDir(dayPnlUsd)}`}>
            今日 {dayPnlUsd >= 0 ? "+" : "−"}${Math.round(Math.abs(dayPnlUsd)).toLocaleString()}
          </span>
        ) : null}
      </div>
      <div className="pfp-banner-currencies">
        {totals.map((t) => (
          <span className="pfp-cur" key={t.currency}>
            <em>{t.currency}</em> {Number(t.marketValue).toLocaleString()}
            <i className={t.pnl >= 0 ? "is-up" : "is-down"}>
              {t.pnl >= 0 ? "+" : ""}
              {Number(t.pnl).toLocaleString()}
              {t.pnlPct != null ? ` (${t.pnl >= 0 ? "+" : ""}${t.pnlPct}%)` : ""}
            </i>
          </span>
        ))}
      </div>
    </div>
  );
}

// Net-worth curve: sourced from daily snapshots — only connects days that
// actually exist, no interpolation/backfill for gaps (PLAN v4 红线 15).
// Honestly shows "accumulating" under 2 samples rather than drawing a
// meaningless line.
function NetWorthChart({ snapshots }: { snapshots: any[] }) {
  const pts = (snapshots || []).filter((s) => typeof s.totalValueUsd === "number");
  if (pts.length < 2) {
    return (
      <div className="pfp-chart pfp-chart-empty">
        <span>净值曲线积累中 · 已有 {pts.length} 天数据，满 2 天开始显示趋势</span>
      </div>
    );
  }
  const chart = buildChartPaths(
    pts.map((p) => ({ close: p.totalValueUsd })),
    640,
    148
  );
  const col = chart.up ? "#1c8c4a" : "var(--danger)";
  const fill = chart.up ? "rgba(28,140,74,0.1)" : "rgba(255,59,48,0.09)";
  const ret = `${chart.up ? "+" : "−"}${Math.abs(chart.retPct).toFixed(1)}%`;
  return (
    <div className="pfp-chart">
      <div className="pfp-chart-head">
        <span className="pfp-chart-ret" style={{ color: col }}>
          {ret} · 区间
        </span>
        <span className="pfp-chart-meta">
          ≈USD 折算 · {pts.length} 天 · 至 {pts[pts.length - 1].date}
        </span>
      </div>
      <svg viewBox="0 0 640 148" role="img" aria-label="组合净值曲线">
        <path d={chart.area} fill={fill} stroke="none" />
        <path className="pfp-chart-line" d={chart.line} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={chart.dotX.toFixed(1)} cy={chart.dotY.toFixed(1)} r={3} fill={col} />
      </svg>
    </div>
  );
}

function EmptyCta({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="wd-empty-cta">
      <p className="hero-eyebrow">
        <span className="hero-spark" />
        持仓
      </p>
      <h2>还没有记账</h2>
      <p>说一句就能记一笔，比如"耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5"，也可以手动添加。</p>
      <button className="primary" type="button" onClick={onAdd}>
        ＋ 记一笔持仓
      </button>
    </div>
  );
}

function PositionEntryForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portfolioApi.upsert({
        ticker: String(form.get("ticker") || "").trim().toUpperCase(),
        companyName: String(form.get("companyName") || "").trim() || undefined,
        shares: String(form.get("shares") || "").trim() || undefined,
        avgCost: String(form.get("avgCost") || "").trim() || undefined,
        stopLoss: String(form.get("stopLoss") || "").trim() || undefined,
        takeProfit: String(form.get("takeProfit") || "").trim() || undefined,
        note: String(form.get("note") || "").trim() || undefined
      });
      showToast("持仓已保存。");
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pf-entry" onSubmit={submit} aria-label="记录持仓">
      <div className="pf-entry-head">
        <div><p className="hero-eyebrow">持仓记录</p><h3>记一笔持仓</h3></div>
        <button type="button" className="wl-add-cancel" onClick={onCancel}>取消</button>
      </div>
      <div className="pf-entry-grid">
        <label>股票代码<input name="ticker" required maxLength={32} placeholder="0700.HK" autoFocus /></label>
        <label>公司名称<input name="companyName" maxLength={80} placeholder="腾讯控股" /></label>
        <label>持有股数<input name="shares" required inputMode="decimal" placeholder="100" /></label>
        <label>平均成本<input name="avgCost" required inputMode="decimal" placeholder="420" /></label>
        <label>止损线<input name="stopLoss" inputMode="decimal" placeholder="可选" /></label>
        <label>止盈线<input name="takeProfit" inputMode="decimal" placeholder="可选" /></label>
      </div>
      <label className="pf-entry-note">研究备注<input name="note" maxLength={500} placeholder="为什么持有、要继续验证什么" /></label>
      {error ? <p className="wl-add-error" role="alert">{error}</p> : null}
      <button className="primary" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存持仓"}</button>
    </form>
  );
}

export function PortfolioPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const positionsQuery = useQuery({ queryKey: ["portfolio", "positions"], queryFn: () => portfolioApi.list() });
  const reviewQuery = useQuery({
    queryKey: ["portfolio", "review"],
    queryFn: () => portfolioApi.review().catch(() => ({ review: null }))
  });
  const snapshotsQuery = useQuery({
    queryKey: ["portfolio", "snapshots"],
    queryFn: () => portfolioApi.snapshots().catch(() => ({ snapshots: [] }))
  });

  const positions = positionsQuery.data?.positions || [];
  const review = reviewQuery.data?.review || null;
  const snapshots = snapshotsQuery.data?.snapshots || [];

  async function handleDelete(ticker: string) {
    if (!ticker) return;
    if (!window.confirm(`从持仓里移除 ${ticker}？`)) return;
    try {
      await portfolioApi.remove(ticker);
      showToast("已移除持仓。");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "删除失败。");
    }
  }

  function saved() {
    setAdding(false);
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  }

  function handleAdd() {
    setAdding(true);
  }

  if (positionsQuery.isLoading) {
    return (
      <div className="page-wide">
        <PageSkeleton label="正在核对持仓与最新行情" cards={4} />
      </div>
    );
  }

  if (positionsQuery.isError) {
    return (
      <div className="page-wide">
        <PageErrorState title="持仓数据暂时没有响应" description="已记录的成本与数量不会受到影响。恢复连接后可以继续查看。" onRetry={() => void positionsQuery.refetch()} />
      </div>
    );
  }

  if (!positions.length) {
    return (
      <div className="page-wide">
        {adding
          ? <PositionEntryForm onSaved={saved} onCancel={() => setAdding(false)} />
          : <EmptyCta onAdd={handleAdd} />}
      </div>
    );
  }

  const noQuote = positions.filter((p) => p.priceStatus !== "ok").length;
  const foot = noQuote
    ? `盘前事件会盯住止损 / 止盈线和大幅回撤。${noQuote} 家暂时取不到实时行情。`
    : "盘前事件会自动盯住这些持仓的止损 / 止盈线和大幅回撤。";

  return (
    <div className="page-wide">
      <div className="pfp-wrap">
        <div className="wd-head">
          <div>
            <p className="hero-eyebrow">
              <span className="hero-spark" />
              持仓
            </p>
            <h2 className="wd-title">{positions.length} 笔持仓</h2>
          </div>
          <button className="wd-portfolio-link wl-add-btn" type="button" onClick={() => setAdding((open) => !open)}>
            ＋ 记一笔持仓
          </button>
        </div>
        {adding ? <PositionEntryForm onSaved={saved} onCancel={() => setAdding(false)} /> : null}
        <OverviewBanner positions={positions} review={review} />
        <NetWorthChart snapshots={snapshots} />
        <PortfolioReviewCard review={review} />
        <div className="pf-list">
          {positions.map((p) => (
            <PositionCard key={p.ticker} position={p} onDelete={handleDelete} />
          ))}
        </div>
        <p className="pf-foot">{foot}</p>
      </div>
    </div>
  );
}
