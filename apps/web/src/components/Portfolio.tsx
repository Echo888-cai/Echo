// Position and portfolio-discipline cards.
// (pure render, no side effects there — kept that way here too). Exported from
// components/ rather than inlined in the portfolio route because research/chat's
// session replay (components.js's meta.type==="portfolio" messages) will reuse
// PortfolioReviewCard when that slice lands.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { PortfolioPosition, PortfolioReview as PortfolioReviewData } from "../lib/api";
import { fmtNum, fmtPct, pnlDir } from "../lib/format";

// Distance-to-stop/take visual bar: current price's relative position within
// [stopLoss, takeProfit]. Only drawn when both bounds are set — a single-sided
// bound isn't enough information to draw a meaningful bar.
function StopTakeBar({ p }: { p: PortfolioPosition }) {
  if (p.stopLoss == null || p.takeProfit == null || p.currentPrice == null || p.takeProfit <= p.stopLoss) return null;
  const pct = Math.min(100, Math.max(0, ((p.currentPrice - p.stopLoss) / (p.takeProfit - p.stopLoss)) * 100));
  return (
    <div className="pf-range" title={`止损 ${fmtNum(p.stopLoss)} · 现价 ${fmtNum(p.currentPrice)} · 止盈 ${fmtNum(p.takeProfit)}`}>
      <div className="pf-range-track">
        <div className="pf-range-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        <i className="pf-range-dot" style={{ left: `${pct.toFixed(1)}%` }} />
      </div>
      <div className="pf-range-labels">
        <span>止损 {fmtNum(p.stopLoss)}</span>
        <span>止盈 {fmtNum(p.takeProfit)}</span>
      </div>
    </div>
  );
}

export function PositionCard({ position: p, onDelete }: { position: PortfolioPosition; onDelete: (ticker: string) => void }) {
  const ccy = p.currency || "";
  const hasQuote = p.priceStatus === "ok" && p.currentPrice != null;
  const metrics: { label: string; value: ReactNode }[] = [];
  if (p.avgCost != null) metrics.push({ label: "成本", value: fmtNum(p.avgCost) });
  if (p.shares != null) metrics.push({ label: "股数", value: fmtNum(p.shares, 0) });
  if (p.marketValue != null) metrics.push({ label: "市值", value: `${fmtNum(p.marketValue, 0)} ${ccy}` });
  if (p.unrealizedPnl != null)
    metrics.push({
      label: "浮动盈亏",
      value: (
        <b className={pnlDir(p.unrealizedPnl)}>
          {p.unrealizedPnl >= 0 ? "+" : ""}
          {fmtNum(p.unrealizedPnl, 0)} {ccy}
        </b>
      )
    });
  if (p.stopLoss != null)
    metrics.push({
      label: "止损",
      value: (
        <>
          {fmtNum(p.stopLoss)}
          {typeof p.toStopPct === "number" ? (
            <em className={`pf-dist ${pnlDir(p.toStopPct)}`}> 缓冲 {fmtPct(p.toStopPct)}</em>
          ) : null}
        </>
      )
    });
  if (p.takeProfit != null)
    metrics.push({
      label: "止盈",
      value: (
        <>
          {fmtNum(p.takeProfit)}
          {typeof p.toTakePct === "number" ? <em className="pf-dist"> 空间 {fmtPct(p.toTakePct)}</em> : null}
        </>
      )
    });

  return (
    <Link className="pf-card" to="/watch/$ticker" params={{ ticker: p.ticker }}>
      <div className="pf-card-head">
        <div className="pf-id">
          <strong>{p.companyName || p.ticker}</strong>
          <span>{p.ticker}</span>
        </div>
        <button
          className="pf-del"
          type="button"
          aria-label="删除持仓"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(p.ticker);
          }}
        >
          删除
        </button>
      </div>
      {hasQuote ? (
        <div className="pf-price">
          <span className="pf-now">
            {fmtNum(p.currentPrice)} {ccy}
          </span>
          {fmtPct(p.returnPct) ? <span className={`pf-ret ${pnlDir(p.returnPct)}`}>{fmtPct(p.returnPct)}</span> : null}
        </div>
      ) : (
        <div className="pf-price">
          <span className="pf-noquote">现价暂不可用</span>
        </div>
      )}
      {metrics.length ? (
        <div className="pf-metrics">
          {metrics.map((m) => (
            <div key={m.label}>
              <span>{m.label}</span>
              <b>{m.value}</b>
            </div>
          ))}
        </div>
      ) : null}
      <StopTakeBar p={p} />
    </Link>
  );
}

const LEVEL: Record<string, { icon: string; cls: string }> = {
  bad: { icon: "●", cls: "pr-bad" },
  warn: { icon: "●", cls: "pr-warn" },
  info: { icon: "●", cls: "pr-info" }
};

const EXP_MARKETS: [string, string, string][] = [
  ["HK", "港股", "pr-exp-hk"],
  ["US", "美股", "pr-exp-us"],
  ["CN", "A股", "pr-exp-cn"]
];

// P3 组合体检卡：一句话结论 + 币种总额/盈亏 + 市场暴露/权重条 + 纪律检查清单。
export function PortfolioReviewCard({ review }: { review: PortfolioReviewData | null | undefined }) {
  if (!review || !review.positionCount) return null;
  const totals = (review.totals || []) as any[];
  const exp = (review.marketExposure || {}) as Record<string, number>;
  const weights = ((review.weights || []) as any[]).slice(0, 5);
  const sectorWeights = ((review.sectorWeights || []) as any[]).slice(0, 5);
  const checks = (review.checks || []) as any[];
  const hasBad = checks.some((c) => c.level === "bad");

  return (
    <div className={`pr-card ${hasBad ? "has-bad" : ""}`}>
      <div className="pr-head">组合体检</div>
      <p className="pr-verdict">{review.verdict}</p>
      {totals.length ? (
        <div className="pr-totals">
          {totals.map((t) => (
            <span className="pr-total" key={t.currency}>
              <em>{t.currency}</em> {Number(t.marketValue).toLocaleString()}
              <i className={t.pnl >= 0 ? "up" : "down"}>
                {t.pnl >= 0 ? "+" : ""}
                {Number(t.pnl).toLocaleString()}
                {t.pnlPct != null ? ` (${t.pnl >= 0 ? "+" : ""}${t.pnlPct}%)` : ""}
              </i>
            </span>
          ))}
        </div>
      ) : null}
      {EXP_MARKETS.some(([k]) => exp[k] != null) ? (
        <div className="pr-exp" title="按 USD≈7.8HKD、USD≈7.2CNY 折算的近似权重">
          {EXP_MARKETS.map(([k, label, cls]) =>
            exp[k] > 0 ? (
              <span className={cls} style={{ width: `${exp[k]}%` }} key={k}>
                {exp[k] >= 12 ? `${label} ${exp[k]}%` : ""}
              </span>
            ) : null
          )}
        </div>
      ) : null}
      {weights.length ? (
        <div className="pr-weights">
          {weights.map((w) => (
            <span className="pr-weight" key={w.name}>
              {w.name} <strong>≈{w.weightPct}%</strong>
            </span>
          ))}
        </div>
      ) : null}
      {sectorWeights.length ? (
        <div className="pr-weights pr-sectors">
          {sectorWeights.map((s) => (
            <span className="pr-weight pr-sector" key={s.sector}>
              {s.sector} <strong>≈{s.weightPct}%</strong>
            </span>
          ))}
        </div>
      ) : null}
      {checks.length ? (
        <ul className="pr-checks">
          {checks.map((c, i) => {
            const meta = LEVEL[c.level] || LEVEL.info;
            return (
              <li className={meta.cls} key={i}>
                <span>{meta.icon}</span>
                {c.text}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
