// ── 持仓渲染：持仓卡 + P3 组合体检卡（纯渲染，无副作用）──────
// M-1：持仓的常驻入口搬到了一级页面 `#/portfolio`（见 portfolioPage.js）。这个文件只留
// 纯渲染函数——一是给新页面用，二是给历史研究会话里可能存量的 meta.type==="portfolio"
// 消息做回放渲染（components.js 读旧会话 thread_json 时仍会命中，不能删，否则老记录空白）。
import { esc, fmtPct, fmtNum, pnlDir } from "./format.js";

// 距止损/止盈的可视化条：现价落在 [止损, 止盈] 区间的相对位置。两端都设好才画，
// 单边缺失时信息量不够画一条有意义的进度条，保持文本形式即可。
function stopTakeBar(p) {
  if (p.stopLoss == null || p.takeProfit == null || p.currentPrice == null || p.takeProfit <= p.stopLoss) return "";
  const pct = Math.min(100, Math.max(0, ((p.currentPrice - p.stopLoss) / (p.takeProfit - p.stopLoss)) * 100));
  return `<div class="pf-range" title="止损 ${fmtNum(p.stopLoss)} · 现价 ${fmtNum(p.currentPrice)} · 止盈 ${fmtNum(p.takeProfit)}">
    <div class="pf-range-track"><div class="pf-range-fill" style="width:${pct.toFixed(1)}%"></div><i class="pf-range-dot" style="left:${pct.toFixed(1)}%"></i></div>
    <div class="pf-range-labels"><span>止损 ${fmtNum(p.stopLoss)}</span><span>止盈 ${fmtNum(p.takeProfit)}</span></div>
  </div>`;
}

export function renderPositionCard(p) {
  const name = esc(p.companyName || p.ticker);
  const ticker = esc(p.ticker);
  const ccy = esc(p.currency || "");
  const hasQuote = p.priceStatus === "ok" && p.currentPrice != null;
  const priceBlock = hasQuote
    ? `<div class="pf-price"><span class="pf-now">${fmtNum(p.currentPrice)} ${ccy}</span>${fmtPct(p.returnPct) ? `<span class="pf-ret ${pnlDir(p.returnPct)}">${fmtPct(p.returnPct)}</span>` : ""}</div>`
    : `<div class="pf-price"><span class="pf-noquote">现价暂不可用</span></div>`;
  const metrics = [];
  if (p.avgCost != null) metrics.push(`<div><span>成本</span><b>${fmtNum(p.avgCost)}</b></div>`);
  if (p.shares != null) metrics.push(`<div><span>股数</span><b>${fmtNum(p.shares, 0)}</b></div>`);
  if (p.marketValue != null) metrics.push(`<div><span>市值</span><b>${fmtNum(p.marketValue, 0)} ${ccy}</b></div>`);
  if (p.unrealizedPnl != null) metrics.push(`<div><span>浮动盈亏</span><b class="${pnlDir(p.unrealizedPnl)}">${p.unrealizedPnl >= 0 ? "+" : ""}${fmtNum(p.unrealizedPnl, 0)} ${ccy}</b></div>`);
  if (p.stopLoss != null) metrics.push(`<div><span>止损</span><b>${fmtNum(p.stopLoss)}${typeof p.toStopPct === "number" ? ` <em class="pf-dist ${pnlDir(p.toStopPct)}">缓冲 ${fmtPct(p.toStopPct)}</em>` : ""}</b></div>`);
  if (p.takeProfit != null) metrics.push(`<div><span>止盈</span><b>${fmtNum(p.takeProfit)}${typeof p.toTakePct === "number" ? ` <em class="pf-dist">空间 ${fmtPct(p.toTakePct)}</em>` : ""}</b></div>`);
  // 卡片整体可点进个股看盘页（M-1）；删除按钮是内层独立 data-action，点击时
  // closest() 先命中按钮自身，不会被外层的 open-stock 吞掉（同 watch.js 的 wl-item 模式）。
  return `<article class="pf-card" data-action="open-stock" data-ticker="${ticker}" data-name="${name}" role="button" tabindex="0">
    <div class="pf-card-head">
      <div class="pf-id"><strong>${name}</strong><span>${ticker}</span></div>
      <button class="pf-del" type="button" data-action="delete-position" data-ticker="${ticker}" aria-label="删除持仓">删除</button>
    </div>
    ${priceBlock}
    ${metrics.length ? `<div class="pf-metrics">${metrics.join("")}</div>` : ""}
    ${stopTakeBar(p)}
  </article>`;
}

// P3 组合体检卡：一句话结论 + 币种总额/盈亏 + 市场暴露/权重条 + 纪律检查清单。
export function renderPortfolioReview(review) {
  if (!review || !review.positionCount) return "";
  const LEVEL = { bad: { icon: "●", cls: "pr-bad" }, warn: { icon: "●", cls: "pr-warn" }, info: { icon: "●", cls: "pr-info" } };
  const totals = (review.totals || []).map((t) =>
    `<span class="pr-total"><em>${esc(t.currency)}</em> ${Number(t.marketValue).toLocaleString()}
      <i class="${t.pnl >= 0 ? "up" : "down"}">${t.pnl >= 0 ? "+" : ""}${Number(t.pnl).toLocaleString()}${t.pnlPct != null ? ` (${t.pnl >= 0 ? "+" : ""}${t.pnlPct}%)` : ""}</i></span>`
  ).join("");
  const exp = review.marketExposure || {};
  const EXP_MARKETS = [["HK", "港股", "pr-exp-hk"], ["US", "美股", "pr-exp-us"], ["CN", "A股", "pr-exp-cn"]];
  const expBar = EXP_MARKETS.some(([k]) => exp[k] != null)
    ? `<div class="pr-exp" title="按 USD≈7.8HKD、USD≈7.2CNY 折算的近似权重">
        ${EXP_MARKETS.map(([k, label, cls]) => (exp[k] > 0 ? `<span class="${cls}" style="width:${exp[k]}%">${exp[k] >= 12 ? `${label} ${exp[k]}%` : ""}</span>` : "")).join("")}
      </div>`
    : "";
  const weights = (review.weights || []).slice(0, 5).map((w) =>
    `<span class="pr-weight">${esc(w.name)} <strong>≈${w.weightPct}%</strong></span>`
  ).join("");
  const sectorWeights = (review.sectorWeights || []).slice(0, 5).map((s) =>
    `<span class="pr-weight pr-sector">${esc(s.sector)} <strong>≈${s.weightPct}%</strong></span>`
  ).join("");
  const checks = (review.checks || []).map((c) => {
    const meta = LEVEL[c.level] || LEVEL.info;
    return `<li class="${meta.cls}"><span>${meta.icon}</span>${esc(c.text)}</li>`;
  }).join("");
  const hasBad = (review.checks || []).some((c) => c.level === "bad");
  return `<div class="pr-card ${hasBad ? "has-bad" : ""}">
    <div class="pr-head">组合体检</div>
    <p class="pr-verdict">${esc(review.verdict)}</p>
    ${totals ? `<div class="pr-totals">${totals}</div>` : ""}
    ${expBar}
    ${weights ? `<div class="pr-weights">${weights}</div>` : ""}
    ${sectorWeights ? `<div class="pr-weights pr-sectors">${sectorWeights}</div>` : ""}
    ${checks ? `<ul class="pr-checks">${checks}</ul>` : ""}
  </div>`;
}

// 历史会话回放专用（新入口见 portfolioPage.renderPortfolioPage）。
export function renderPortfolioPanel(positions = [], review = null) {
  if (!positions.length) {
    return `<p class="pf-empty">还没有记账。点下面按钮，或在对话里说一句即可记录，例如：<strong>耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5</strong>。</p>
      <div class="pf-actions"><button class="pf-add" type="button" data-action="portfolio-add">＋ 记一笔持仓</button></div>`;
  }
  const noQuote = positions.filter((p) => p.priceStatus !== "ok").length;
  const foot = noQuote
    ? `盘前事件会盯住止损 / 止盈线和大幅回撤。${noQuote} 家暂时取不到实时行情。`
    : "盘前事件会自动盯住这些持仓的止损 / 止盈线和大幅回撤。";
  return `${renderPortfolioReview(review)}
    <div class="pf-list">${positions.map(renderPositionCard).join("")}</div>
    <div class="pf-actions"><button class="pf-add" type="button" data-action="portfolio-add">＋ 记一笔持仓</button></div>
    <p class="pf-foot">${foot}</p>`;
}
