// ── 持仓一级页面（M-1，PLAN v4）：概览横幅 + 净值曲线 + 组合体检 + 持仓列表 ──
// "我的钱现在怎么样" 从会滚走的聊天卡片升级成常驻路由 `#/portfolio`；组合体检/持仓卡的
// 渲染逻辑仍在 portfolio.js（历史会话回放也要用），这个文件只管页面外壳、数据装配、
// 净值曲线（复用 watch.js 的 SVG 路径构建）。
import { S, render, currentRoute } from "./state.js";
import { api } from "./api.js";
import { esc, toast, pnlDir } from "./format.js";
import { shell } from "./shell.js";
import { renderPositionCard, renderPortfolioReview } from "./portfolio.js";
import { buildChartPaths } from "./watch.js";

// 展示级近似汇率——跟服务端 portfolioReview.js/portfolioSnapshot.js 的 FX_TO_USD 同一常量，
// 三处折算数字才不会互相打架（PLAN v4 红线 11）。
const FX_TO_USD = { USD: 1, HKD: 1 / 7.8, CNY: 1 / 7.2 };

export async function loadPortfolioPage() {
  if (S.portfolioPageLoading) return;
  // 只同步设标志、不在这里同步调 render()：调用方（renderPortfolioPage）在 fire-and-forget
  // 之后紧接着自己调一次 shell()，此时标志已经是最新值——跟 watch.js 的 loadWatchStock 同一个
  // 模式，避免"标志刚置位就同步重入 render()"引出的双重渲染。
  S.portfolioPageLoading = true;
  try {
    const [data, reviewData, snapData] = await Promise.all([
      api("/api/portfolio"),
      api("/api/portfolio/review").catch(() => null),
      api("/api/portfolio/snapshots").catch(() => null)
    ]);
    S.portfolioPage = {
      positions: data.positions || [],
      review: reviewData?.review || null,
      snapshots: snapData?.snapshots || []
    };
  } catch {
    S.portfolioPage = { positions: [], review: null, snapshots: [] };
  } finally {
    S.portfolioPageLoading = false;
    S.portfolioPageLoaded = true;
    render();
  }
}

export async function refreshPortfolioPage() {
  return loadPortfolioPage();
}

export async function deletePortfolioPosition(ticker) {
  if (!ticker) return;
  if (!window.confirm(`从持仓里移除 ${ticker}？`)) return;
  try {
    await api(`/api/portfolio?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
    toast("已移除持仓。");
    if (currentRoute().startsWith("/portfolio")) await refreshPortfolioPage();
  } catch (error) {
    toast(error.message || "删除失败。");
  }
}

// 概览横幅：分币种总市值/浮盈（来自组合体检已经算好的 totals，不重复计算）+ 当日盈亏
// （持仓 changePct × 市值汇总，M-1 新增字段，见 portfolioEnrich.js）。
function renderOverviewBanner(positions, review) {
  const totals = review?.totals || [];
  if (!totals.length) return "";
  const totalValueUsd = totals.reduce((s, t) => s + t.marketValue * (FX_TO_USD[t.currency] || 1), 0);
  const totalPnlUsd = totals.reduce((s, t) => s + t.pnl * (FX_TO_USD[t.currency] || 1), 0);
  const totalCostUsd = totalValueUsd - totalPnlUsd;
  const totalPnlPct = totalCostUsd ? (totalPnlUsd / totalCostUsd) * 100 : null;

  let dayPnlUsd = 0;
  let hasDay = false;
  for (const p of positions) {
    if (p.marketValue == null || typeof p.changePct !== "number") continue;
    hasDay = true;
    dayPnlUsd += p.marketValue * (FX_TO_USD[p.currency] || 1) * (p.changePct / 100);
  }

  const perCurrency = totals.map((t) =>
    `<span class="pfp-cur"><em>${esc(t.currency)}</em> ${Number(t.marketValue).toLocaleString()}
      <i class="${t.pnl >= 0 ? "is-up" : "is-down"}">${t.pnl >= 0 ? "+" : ""}${Number(t.pnl).toLocaleString()}${t.pnlPct != null ? ` (${t.pnl >= 0 ? "+" : ""}${t.pnlPct}%)` : ""}</i></span>`
  ).join("");

  return `<div class="pfp-banner">
    <div class="pfp-banner-main">
      <span class="pfp-banner-label">组合总市值 <em title="按 USD≈7.8 HKD 折算">≈</em></span>
      <span class="pfp-banner-value">$${Math.round(totalValueUsd).toLocaleString()}</span>
      <span class="pfp-banner-pnl ${pnlDir(totalPnlUsd)}">${totalPnlUsd >= 0 ? "+" : "−"}$${Math.round(Math.abs(totalPnlUsd)).toLocaleString()}${totalPnlPct != null ? ` (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)` : ""}</span>
      ${hasDay ? `<span class="pfp-banner-day ${pnlDir(dayPnlUsd)}">今日 ${dayPnlUsd >= 0 ? "+" : "−"}$${Math.round(Math.abs(dayPnlUsd)).toLocaleString()}</span>` : ""}
    </div>
    <div class="pfp-banner-currencies">${perCurrency}</div>
  </div>`;
}

// 净值曲线：数据源是 E9 每日快照，只连已存在的天——不存在的日期就是断口，不插值不回填
// （PLAN v4 红线 15）。样本 <2 天时诚实显示"积累中"，不硬画一条毫无意义的曲线。
function renderNetWorthChart(snapshots) {
  const pts = (snapshots || []).filter((s) => typeof s.totalValueUsd === "number");
  if (pts.length < 2) {
    return `<div class="pfp-chart pfp-chart-empty">
      <span>净值曲线积累中 · 已有 ${pts.length} 天数据，满 2 天开始显示趋势</span>
    </div>`;
  }
  const chart = buildChartPaths(pts.map((p) => ({ close: p.totalValueUsd })), 640, 148);
  const col = chart.up ? "#1c8c4a" : "var(--danger)";
  const fill = chart.up ? "rgba(28,140,74,0.1)" : "rgba(255,59,48,0.09)";
  const ret = `${chart.up ? "+" : "−"}${Math.abs(chart.retPct).toFixed(1)}%`;
  return `<div class="pfp-chart">
    <div class="pfp-chart-head">
      <span class="pfp-chart-ret" style="color:${col}">${ret} · 区间</span>
      <span class="pfp-chart-meta">≈USD 折算 · ${pts.length} 天 · 至 ${esc(pts[pts.length - 1].date)}</span>
    </div>
    <svg viewBox="0 0 640 148" role="img" aria-label="组合净值曲线">
      <path d="${chart.area}" fill="${fill}" stroke="none"/>
      <path class="pfp-chart-line" d="${chart.line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${chart.dotX.toFixed(1)}" cy="${chart.dotY.toFixed(1)}" r="3" fill="${col}"/>
    </svg>
  </div>`;
}

function renderPortfolioEmptyCta() {
  return `<div class="wd-empty-cta">
    <p class="hero-eyebrow"><span class="hero-spark"></span>持仓</p>
    <h2>还没有记账</h2>
    <p>说一句就能记一笔，比如"耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5"，也可以手动添加。</p>
    <button class="primary" type="button" data-action="portfolio-add">＋ 记一笔持仓</button>
  </div>`;
}

function renderPortfolioPageBody() {
  const page = S.portfolioPage;
  if (!page || !page.positions.length) {
    if (!S.portfolioPageLoaded) return `<div class="wd-loading">正在加载持仓…</div>`;
    return renderPortfolioEmptyCta();
  }
  const { positions, review, snapshots } = page;
  const noQuote = positions.filter((p) => p.priceStatus !== "ok").length;
  const foot = noQuote
    ? `盘前事件会盯住止损 / 止盈线和大幅回撤。${noQuote} 家暂时取不到实时行情。`
    : "盘前事件会自动盯住这些持仓的止损 / 止盈线和大幅回撤。";
  return `<div class="pfp-wrap">
    <div class="wd-head">
      <div>
        <p class="hero-eyebrow"><span class="hero-spark"></span>持仓</p>
        <h2 class="wd-title">${positions.length} 笔持仓</h2>
      </div>
      <button class="wd-portfolio-link wl-add-btn" type="button" data-action="portfolio-add">＋ 记一笔持仓</button>
    </div>
    ${renderOverviewBanner(positions, review)}
    ${renderNetWorthChart(snapshots)}
    ${renderPortfolioReview(review)}
    <div class="pf-list">${positions.map(renderPositionCard).join("")}</div>
    <p class="pf-foot">${foot}</p>
  </div>`;
}

export function renderPortfolioPage() {
  if (!S.portfolioPage && !S.portfolioPageLoading) void loadPortfolioPage();
  shell(`<div class="page-wide">${renderPortfolioPageBody()}</div>`);
}
