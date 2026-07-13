// React port of src/ui/portfolioPage.js's renderPortfolioPage() — overview
// banner + net-worth chart + portfolio-review card + position list. Positions
// are still recorded via natural-language chat (see the "add" button below),
// unchanged from legacy — a manual entry form is out of scope for this slice.
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { portfolioApi, ApiError } from "../lib/api";
import { pnlDir } from "../lib/format";
import { buildChartPaths } from "../lib/chart";
import { showToast } from "../lib/toast";
import { Shell } from "../components/Shell";
import { PositionCard, PortfolioReviewCard } from "../components/Portfolio";

// Page-specific styles not already loaded by Shell (see login.tsx for the
// same locally-scoped-import pattern): 06-watch.css for the shared .wd-*/
// .page-wide scaffolding, 08-portfolio.css for the .pfp-*/.pf-* rules, and
// 03-research.css for .pr-* (the portfolio-review card's rules live there —
// it started life as a chat-panel component, per portfolio.js's header comment).
import "../../../../src/styles/03-research.css";
import "../../../../src/styles/06-watch.css";
import "../../../../src/styles/08-portfolio.css";

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

export function PortfolioPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  // 记账走对话（自然语言解析），composer 目前只活在研究页——从持仓页点进来时先跳过去
  // （composer 预填在研究页迁移落地前先不接，legacy 的模板字符串行为随那片一起补上）。
  function handleAdd() {
    navigate({ to: "/" });
  }

  if (positionsQuery.isLoading) {
    return (
      <Shell>
        <div className="page-wide">
          <div className="wd-loading">正在加载持仓…</div>
        </div>
      </Shell>
    );
  }

  if (!positions.length) {
    return (
      <Shell>
        <div className="page-wide">
          <EmptyCta onAdd={handleAdd} />
        </div>
      </Shell>
    );
  }

  const noQuote = positions.filter((p) => p.priceStatus !== "ok").length;
  const foot = noQuote
    ? `盘前事件会盯住止损 / 止盈线和大幅回撤。${noQuote} 家暂时取不到实时行情。`
    : "盘前事件会自动盯住这些持仓的止损 / 止盈线和大幅回撤。";

  return (
    <Shell>
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
            <button className="wd-portfolio-link wl-add-btn" type="button" onClick={handleAdd}>
              ＋ 记一笔持仓
            </button>
          </div>
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
    </Shell>
  );
}
