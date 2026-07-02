// ── 持仓面板：持仓卡 + P3 组合体检卡 + 增删刷新 ─────────────
import { render, getThread, setThread, appendMessage } from "./state.js";
import { api } from "./api.js";
import { esc, toast, fmtPct, fmtNum, pnlDir } from "./format.js";

export async function showPortfolio() {
  try {
    // 持仓列表 + 组合体检并行拉；体检失败不影响列表（review=null 时卡片不渲染）。
    const [data, reviewData] = await Promise.all([
      api("/api/portfolio"),
      api("/api/portfolio/review").catch(() => null)
    ]);
    appendMessage("assistant", "我的持仓", { type: "portfolio", positions: data.positions || [], review: reviewData?.review || null });
  } catch (error) {
    toast(error.message || "暂时无法读取持仓。");
  }
}

// 删除某条持仓后，原地刷新最近那张持仓面板，而不是再插一张新的。
export async function refreshPortfolioPanel() {
  const [data, reviewData] = await Promise.all([
    api("/api/portfolio"),
    api("/api/portfolio/review").catch(() => null)
  ]);
  const positions = data.positions || [];
  const review = reviewData?.review || null;
  const thread = getThread();
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    if (thread[i].meta?.type === "portfolio") {
      thread[i] = { ...thread[i], meta: { ...thread[i].meta, positions, review } };
      break;
    }
  }
  setThread(thread);
  render();
}

export async function deletePortfolioPosition(ticker) {
  if (!ticker) return;
  if (!window.confirm(`从持仓里移除 ${ticker}？`)) return;
  try {
    await api(`/api/portfolio?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
    await refreshPortfolioPanel();
    toast("已移除持仓。");
  } catch (error) {
    toast(error.message || "删除失败。");
  }
}

function renderPositionCard(p) {
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
  return `<article class="pf-card">
    <div class="pf-card-head">
      <div class="pf-id"><strong>${name}</strong><span>${ticker}</span></div>
      <button class="pf-del" type="button" data-action="delete-position" data-ticker="${ticker}" aria-label="删除持仓">删除</button>
    </div>
    ${priceBlock}
    ${metrics.length ? `<div class="pf-metrics">${metrics.join("")}</div>` : ""}
  </article>`;
}

// P3 组合体检卡：一句话结论 + 币种总额/盈亏 + 市场暴露/权重条 + 纪律检查清单。
function renderPortfolioReview(review) {
  if (!review || !review.positionCount) return "";
  const LEVEL = { bad: { icon: "●", cls: "pr-bad" }, warn: { icon: "●", cls: "pr-warn" }, info: { icon: "●", cls: "pr-info" } };
  const totals = (review.totals || []).map((t) =>
    `<span class="pr-total"><em>${esc(t.currency)}</em> ${Number(t.marketValue).toLocaleString()}
      <i class="${t.pnl >= 0 ? "up" : "down"}">${t.pnl >= 0 ? "+" : ""}${Number(t.pnl).toLocaleString()}${t.pnlPct != null ? ` (${t.pnl >= 0 ? "+" : ""}${t.pnlPct}%)` : ""}</i></span>`
  ).join("");
  const exp = review.marketExposure || {};
  const expBar = (exp.HK != null && exp.US != null)
    ? `<div class="pr-exp" title="按 USD≈7.8HKD 折算的近似权重">
        ${exp.HK > 0 ? `<span class="pr-exp-hk" style="width:${exp.HK}%">${exp.HK >= 12 ? `港股 ${exp.HK}%` : ""}</span>` : ""}
        ${exp.US > 0 ? `<span class="pr-exp-us" style="width:${exp.US}%">${exp.US >= 12 ? `美股 ${exp.US}%` : ""}</span>` : ""}
      </div>`
    : "";
  const weights = (review.weights || []).slice(0, 5).map((w) =>
    `<span class="pr-weight">${esc(w.name)} <strong>≈${w.weightPct}%</strong></span>`
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
    ${checks ? `<ul class="pr-checks">${checks}</ul>` : ""}
  </div>`;
}

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
