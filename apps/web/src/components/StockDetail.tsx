import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { WatchStock } from "../lib/api";
import { portraitsApi } from "../lib/api";
import { buildChartPaths } from "../lib/chart";
import { markdownToHtml } from "../lib/markdown";
import { exportPortraitImage } from "../lib/portraitShareImage";
import { detectMarket } from "../lib/market";
import { fmtNum, fmtPct, pnlDir, wdChg, wdWhen, notifWhen } from "../lib/format";
import { showToast } from "../lib/toast";

import "@echo/ui/styles/03-research.css";

const WD_STATUS: Record<string, { label: string; cls: string }> = {
  falsified: { label: "已触发证伪", cls: "wd-falsified" },
  at_risk: { label: "有风险", cls: "wd-risk" },
  intact: { label: "逻辑还在", cls: "wd-intact" }
};

const RS_LABEL: Record<string, string> = {
  watch: "持续观察",
  research_more: "需要补充材料",
  data_missing: "数据缺失",
  risk_alert: "风险提示",
  out_of_scope: "不在范围"
};

const WL_BAD_THESIS = /不可用|无法形成|暂无|尚未|待补充|已有财务数据|缺一致预期|缺用户持仓|行情已接入/;

function exBadge(marketOrTicker: string) {
  const mkt = marketOrTicker === "US" || marketOrTicker === "HK" || marketOrTicker === "unsupported" ? marketOrTicker : detectMarket(marketOrTicker);
  const label = mkt === "US" ? "美股" : mkt === "HK" ? "港股" : "已停止覆盖";
  return <span className={`ex-badge ${mkt === "unsupported" ? "delisted" : mkt.toLowerCase()}`}>{label}</span>;
}

const STOCK_ICONS: Record<string, ReactElement> = {
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  ),
  bars: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 19V10M12 19V5M19 19v-6" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4 2.5 20h19Z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  news: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9.5h8M8 13h8M8 16h5" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </svg>
  )
};

function StockIcon({ name }: { name: string }) {
  return <span className="stock-ico">{STOCK_ICONS[name] || null}</span>;
}

function FundamentalCell({ label, value, suffix = "" }: { label: string; value: string | number | null | undefined; suffix?: string }) {
  return (
    <div className="sf-cell">
      <span className="sf-label">{label}</span>
      <span className="sf-value">{value == null ? "—" : `${value}${suffix}`}</span>
    </div>
  );
}

function StockEventRow({ e }: { e: any }) {
  const sev = e.severity === "high" ? "sev-high" : e.severity === "medium" ? "sev-med" : "sev-low";
  const when = wdWhen(e.date);
  const title = String(e.title || "").replace(/[[\]]/g, "");
  const related = e.relatedCount > 1 ? <span className="wd-evt-related">同题材 {e.relatedCount} 条</span> : null;
  const inner = (
    <>
      <span className={`wd-dot ${sev}`} />
      <span className="wd-evt-title">{title}</span>
      {related}
      {when ? <span className="wd-evt-when">{when}</span> : null}
    </>
  );
  return e.url ? (
    <a className="stock-event-row" href={e.url} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <span className="stock-event-row">{inner}</span>
  );
}

const CHART_RANGES: Record<string, number> = { "1m": 21, "3m": 63, "1y": 252 };

function PriceChart({ series }: { series: any }) {
  const [range, setRange] = useState<"1m" | "3m" | "1y">("3m");
  if (!series || series.providerStatus !== "ok" || !Array.isArray(series.points) || series.points.length < 2) {
    return (
      <div className="pchart">
        <div className="pchart-empty">
          <StockIcon name="chart" />
          <span>行情曲线暂不可用</span>
        </div>
      </div>
    );
  }
  const n = CHART_RANGES[range] || CHART_RANGES["3m"];
  const pts = series.points.slice(-n);
  const chart = buildChartPaths(pts, 640, 168);
  const col = chart.up ? "#1c8c4a" : "var(--danger)";
  const fill = chart.up ? "rgba(28,140,74,0.1)" : "rgba(255,59,48,0.09)";
  const ret = `${chart.up ? "+" : "−"}${Math.abs(chart.retPct).toFixed(1)}%`;
  return (
    <div className="pchart">
      <div className="pchart-head">
        <span className="pc-range">
          {(
            [
              ["1m", "1月"],
              ["3m", "3月"],
              ["1y", "1年"]
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`pc-btn ${range === k ? "is-active" : ""}`} type="button" onClick={() => setRange(k)}>
              {l}
            </button>
          ))}
        </span>
        <span className="pc-ret" style={{ color: col }}>
          {ret} · 区间
        </span>
        <span className="pc-meta">日线 · 收盘价 · {pts[pts.length - 1].date}</span>
      </div>
      <svg viewBox="0 0 640 168" role="img" aria-label="价格走势曲线">
        <path d={chart.area} fill={fill} stroke="none" />
        <path d={chart.line} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={chart.dotX.toFixed(1)} cy={chart.dotY.toFixed(1)} r={3} fill={col} />
      </svg>
    </div>
  );
}

function thermoColor(distancePct: number | null): string {
  if (distancePct == null) return "var(--muted)";
  if (distancePct <= 0) return "var(--danger-strong, #a1201b)";
  if (distancePct < 10) return "var(--danger)";
  if (distancePct < 20) return "var(--amber, #d99a2b)";
  return "var(--success, #1c8c4a)";
}

function thermoFillPct(distancePct: number | null): number {
  if (distancePct == null) return 0;
  if (distancePct <= 0) return 100;
  return Math.min(100, Math.max(4, 100 - distancePct));
}

function FalsifierThermo({ rule }: { rule: any }) {
  if (rule.triggered || rule.distancePct == null) return null;
  const color = thermoColor(rule.distancePct);
  const fill = thermoFillPct(rule.distancePct);
  return (
    <div className="fw-thermo">
      <div className="fw-thermo-fill" style={{ width: `${fill}%`, background: color } as React.CSSProperties} />
      <span className="fw-thermo-label" style={{ color }}>
        距触发 {rule.distancePct}%
      </span>
      {rule.lastTriggeredAt ? (
        <span className="fw-trigger-history">上次触发：{wdWhen(rule.lastTriggeredAt)}</span>
      ) : null}
      {rule.asOf ? (
        <span className="fw-trigger-history">行情 {notifWhen(rule.asOf)}</span>
      ) : null}
    </div>
  );
}

function EarningsTab({ stock }: { stock: WatchStock }) {
  const ed = (stock as any).earningsDashboard;
  if (!ed || ed.providerStatus !== "ok") {
    return (
      <div className="earn-dash">
        <p className="stock-card-body is-empty">业绩日历数据不可用——需要数据源返回该公司的业绩日程后才能展示。</p>
      </div>
    );
  }

  const hasSurprise = ed.lastEpsActual != null || ed.lastRevenueActual != null;
  const epsDir = ed.lastEpsSurprisePct != null ? (ed.lastEpsSurprisePct >= 0 ? "earn-beat" : "earn-miss") : "";
  const revDir = ed.lastRevenueSurprisePct != null ? (ed.lastRevenueSurprisePct >= 0 ? "earn-beat" : "earn-miss") : "";
  const qLabel = ed.lastQuarter != null && ed.lastYear != null ? `${ed.lastYear} Q${ed.lastQuarter}` : "";

  return (
    <div className="earn-dash">
      <div className="earn-next">
        <span className="earn-next-label">下次业绩日</span>
        <strong>{ed.nextDate || "待公布"}</strong>
        {ed.quarter != null && ed.year != null ? (
          <span className="earn-next-sub">{ed.year} Q{ed.quarter} · 预期 EPS {ed.epsEstimate != null ? fmtNum(ed.epsEstimate) : "—"}</span>
        ) : null}
      </div>
      {hasSurprise ? (
        <>
          <h4 className="earn-section-head">上次报告{qLabel ? ` · ${qLabel}` : ""}{ed.lastDate ? ` · ${ed.lastDate}` : ""}</h4>
          <div className="earn-compare">
            <div className="earn-cell">
              <span className="earn-cell-label">EPS 预期</span>
              <strong>{ed.lastEpsEstimate != null ? fmtNum(ed.lastEpsEstimate) : "—"}</strong>
            </div>
            <div className={`earn-cell ${epsDir}`}>
              <span className="earn-cell-label">EPS 实际</span>
              <strong>{ed.lastEpsActual != null ? fmtNum(ed.lastEpsActual) : "—"}</strong>
              {ed.lastEpsSurprisePct != null ? (
                <em>{ed.lastEpsSurprisePct >= 0 ? "+" : ""}{ed.lastEpsSurprisePct.toFixed(1)}%</em>
              ) : null}
            </div>
            <div className="earn-cell">
              <span className="earn-cell-label">营收预期</span>
              <strong>{ed.lastRevenueEstimate != null ? fmtNum(ed.lastRevenueEstimate / 1e8, 1) + " 亿" : "—"}</strong>
            </div>
            <div className={`earn-cell ${revDir}`}>
              <span className="earn-cell-label">营收实际</span>
              <strong>{ed.lastRevenueActual != null ? fmtNum(ed.lastRevenueActual / 1e8, 1) + " 亿" : "—"}</strong>
              {ed.lastRevenueSurprisePct != null ? (
                <em>{ed.lastRevenueSurprisePct >= 0 ? "+" : ""}{ed.lastRevenueSurprisePct.toFixed(1)}%</em>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <p className="stock-card-body is-empty">暂无历史业绩对比数据</p>
      )}
    </div>
  );
}

function StockOverview({ stock }: { stock: WatchStock }) {
  const p = stock.profile;
  const cleanThesis = p?.thesis && !WL_BAD_THESIS.test(p.thesis) ? p.thesis : "";
  const fu = stock.fundamentals;
  const falsifiers: string[] = Array.isArray(p?.falsifiers) ? p.falsifiers : [];
  const rules: any[] = Array.isArray(stock.watchRules) ? stock.watchRules : [];
  const ruleByLabel = new Map(rules.map((r) => [r.label, r]));
  const monitoredCount = rules.filter((r) => r.sane !== false).length;
  const events: any[] = Array.isArray(stock.events) ? stock.events : [];

  return (
    <div className="stock-cols">
      <div className="stock-col-main">
        <PriceChart series={stock.series} />
        <div className="stock-card">
          <div className="stock-card-head">
            <StockIcon name="news" />
            近期事件
          </div>
          {events.length ? (
            <div className="stock-events">
              {events.map((e, i) => (
                <StockEventRow e={e} key={i} />
              ))}
            </div>
          ) : (
            <p className="stock-card-body is-empty">近期暂无重大事件</p>
          )}
        </div>
      </div>
      <div className="stock-col-side">
        <div className="stock-card">
          <div className="stock-card-head">
            <StockIcon name="target" />
            投资主线
          </div>
          {cleanThesis ? (
            <p className="stock-card-body stock-thesis">{cleanThesis}</p>
          ) : (
            <p className="stock-card-body is-empty">还没有沉淀投资主线 · 点「深入研究」建立</p>
          )}
          {p?.researchStatus || p?.confidence ? (
            <div className="stock-tags">
              {p.researchStatus ? <span className="stock-tag">研究状态 · {RS_LABEL[p.researchStatus] || p.researchStatus}</span> : null}
              {p.confidence ? <span className="stock-tag">置信度 · {p.confidence}</span> : null}
              {p.turnCount ? <span className="stock-tag">已研究 {p.turnCount} 轮</span> : null}
            </div>
          ) : null}
        </div>
        <div className="stock-card">
          <div className="stock-card-head">
            <StockIcon name="alert" />
            证伪条件
            {monitoredCount ? <span className="fw-count">{monitoredCount} 条自动盯盘</span> : null}
          </div>
          {falsifiers.length ? (
            <>
              <ul className="stock-list">
                {falsifiers.map((f, i) => {
                  const r = ruleByLabel.get(f);
                  if (!r || r.sane === false) return <li key={i}>{f}</li>;
                  return (
                    <li className={r.triggered ? "fw-line-hit" : ""} key={i}>
                      <span>{f}</span>
                      {r.triggered ? (
                        <span className="fw-chip fw-hit">已命中</span>
                      ) : null}
                      <FalsifierThermo rule={r} />
                    </li>
                  );
                })}
              </ul>
              {monitoredCount ? <p className="fw-note">价格类条件每 30 分钟自动核对，命中会进通知中心。</p> : null}
            </>
          ) : (
            <p className="stock-card-body is-empty">还没有沉淀证伪条件——研究时问"什么情况会证伪？"，结论会自动挂到这里并盯盘。</p>
          )}
        </div>
        <div className="stock-card">
          <div className="stock-card-head">
            <StockIcon name="bars" />
            基本面
          </div>
          {fu?.status === "ok" ? (
            <div className="sf-grid">
              <FundamentalCell label="市盈率 TTM" value={fu.pe != null ? fu.pe.toFixed(1) : null} />
              <FundamentalCell label="营收增速" value={fu.revenueGrowth != null ? fu.revenueGrowth.toFixed(1) : null} suffix="%" />
              <FundamentalCell label="毛利率" value={fu.grossMargin != null ? fu.grossMargin.toFixed(1) : null} suffix="%" />
              <FundamentalCell
                label="自由现金流"
                value={fu.freeCashFlow != null ? fmtNum(fu.freeCashFlow / 1e8, 1) : null}
                suffix={fu.freeCashFlow != null ? ` 亿${fu.currency}` : ""}
              />
            </div>
          ) : (
            <p className="stock-card-body is-empty">数据源暂不可用</p>
          )}
        </div>
      </div>
    </div>
  );
}

const PORTRAIT_KIND: Record<string, { label: string; cls: string }> = {
  created: { label: "建档", cls: "pk-created" },
  thesis_change: { label: "判断变化", cls: "pk-change" },
  falsifier_change: { label: "证伪线更新", cls: "pk-falsifier" },
  note: { label: "记录", cls: "pk-note" }
};

function PortraitEvent({ e }: { e: any }) {
  const kind = PORTRAIT_KIND[e.kind] || PORTRAIT_KIND.note;
  const evidence = (Array.isArray(e.evidence) ? e.evidence : []).filter((ev: any) => ev?.url);
  // "查看当轮研究 →" jumps into the associated research chat session.
  // history — deferred to the research-page slice, which is where session
  // loading actually lives.
  return (
    <li className="pt-event">
      <div className="pt-event-head">
        <span className="pt-date">{e.date || "—"}</span>
        <span className={`pt-kind ${kind.cls}`}>{kind.label}</span>
      </div>
      <p className="pt-summary">{e.summary || ""}</p>
      {e.rationale ? <p className="pt-rationale">理由：{e.rationale}</p> : null}
      {evidence.length ? (
        <div className="pt-evidence-row">
          {evidence.map((ev: any, i: number) => (
            <a className="pt-evidence" href={ev.url} target="_blank" rel="noopener noreferrer" key={i}>
              {ev.title || "来源"}
            </a>
          ))}
        </div>
      ) : null}
    </li>
  );
}

// The doc portion of the main profile (the timeline renders separately);
// export still uses the full markdown.
function portraitDocHtml(markdown = ""): string {
  const doc = markdown.replace(/^---[\s\S]*?---\s*/, "").split(/\n## 判断变化时间线/)[0];
  return markdownToHtml(doc);
}

const VALUATION_POSITION_LABEL: Record<string, string> = {
  below_base: "低于估值中枢",
  above_base: "高于估值中枢",
  at_base: "等于估值中枢"
};

function ReviewRow({ r }: { r: any }) {
  const priceLine =
    r.priceThen != null && r.priceNow != null ? (
      <>
        {fmtNum(r.priceThen)} → {fmtNum(r.priceNow)}
        {r.pctChange != null ? (
          <em className={pnlDir(r.pctChange)}>
            {" "}
            {r.pctChange >= 0 ? "+" : ""}
            {r.pctChange}%
          </em>
        ) : null}
      </>
    ) : (
      "价格数据不全"
    );
  const falsifierBadges = (r.falsifierStatus || [])
    .filter((f: any) => f.evaluable)
    .map((f: any, i: number) => (
      <span className={`rv-badge ${f.breached ? "rv-bad" : "rv-ok"}`} title={f.label} key={i}>
        {f.breached ? "证伪线已越线" : "证伪线未越线"}
      </span>
    ));
  const pe = r.postEarnings;
  return (
    <li className="rv-row">
      <div className="rv-row-head">
        <span className="rv-date">
          {r.snapshotDate} · T+{r.daysElapsed ?? "?"}天
        </span>
        {r.valuationPosition ? <span className="rv-position">{VALUATION_POSITION_LABEL[r.valuationPosition] || r.valuationPosition}</span> : null}
      </div>
      {r.thesis ? <p className="rv-thesis">{r.thesis}</p> : null}
      <div className="rv-price">{priceLine}</div>
      <div className="rv-badges">
        {r.withinBand != null ? <span className={`rv-badge ${r.withinBand ? "rv-ok" : "rv-miss"}`}>{r.withinBand ? "现价在估值带内" : "现价已脱离估值带"}</span> : null}
        {r.towardBase != null ? <span className={`rv-badge ${r.towardBase ? "rv-ok" : "rv-miss"}`}>{r.towardBase ? "向估值中枢靠拢" : "偏离估值中枢"}</span> : null}
        {falsifierBadges}
        {pe?.epsSurprisePct != null ? (
          <span className={`rv-badge ${pe.epsSurprisePct >= 0 ? "rv-ok" : "rv-bad"}`} title={`财报日 ${pe.date}`}>
            财报 EPS {pe.epsSurprisePct >= 0 ? "+" : ""}
            {pe.epsSurprisePct}%
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ResearchReview({ ticker }: { ticker: string }) {
  const reviewQuery = useQuery({
    queryKey: ["company", "review", ticker],
    queryFn: () => portraitsApi.review(ticker)
  });
  if (reviewQuery.isLoading) {
    return (
      <div className="portrait-review">
        <h3>研究复盘</h3>
        <p className="stock-card-body is-empty">正在读取复盘数据…</p>
      </div>
    );
  }
  const sc: any = reviewQuery.data?.scorecard;
  if (!sc || !sc.totalSnapshots) {
    return (
      <div className="portrait-review">
        <h3>研究复盘</h3>
        <p className="stock-card-body is-empty">还没有判断快照——下一次判断变化时会自动开始沉淀，供以后核对"当时说的对不对"。</p>
      </div>
    );
  }
  const rows = [...sc.reviews].reverse();
  return (
    <div className="portrait-review">
      <h3>
        研究复盘 <span className="rv-sub">(共 {sc.totalSnapshots} 条快照，{sc.matureSampleSize} 条满 14 天)</span>
      </h3>
      {sc.insufficientSample ? (
        <p className="rv-note">{sc.message}</p>
      ) : (
        <div className="rv-stats">
          <span className="rv-stat">
            <strong>{sc.withinBandRate}%</strong> 现价落在当时估值带内
          </span>
          {sc.towardBaseRate != null ? (
            <span className="rv-stat">
              <strong>{sc.towardBaseRate}%</strong> 向估值中枢靠拢
            </span>
          ) : null}
          {sc.falsifierBreaches ? (
            <span className="rv-stat is-bad">
              <strong>{sc.falsifierBreaches}</strong> 条证伪线已越线
            </span>
          ) : null}
          {sc.epsBeatRate != null ? (
            <span className="rv-stat">
              <strong>{sc.epsBeatRate}%</strong> 判断之后的财报 EPS beat 率（{sc.postEarningsSampleSize} 条）
            </span>
          ) : null}
        </div>
      )}
      <ul className="rv-list">
        {rows.map((r: any, i: number) => (
          <ReviewRow r={r} key={i} />
        ))}
      </ul>
    </div>
  );
}

function PortraitTab({ stock }: { stock: WatchStock }) {
  const navigate = useNavigate();
  const portraitQuery = useQuery({
    queryKey: ["company", "profile", stock.ticker],
    queryFn: () => portraitsApi.profile(stock.ticker)
  });

  if (portraitQuery.isLoading) return <div className="wd-loading">正在读取画像…</div>;

  const p: any = portraitQuery.data?.profile;
  if (!p || (!p.thesis && !(p.events || []).length)) {
    return (
      <div className="portrait-empty">
        <p>还没有长期画像。完成一轮研究，投资主线、证伪条件和判断变化会自动沉淀到这里。</p>
        <button className="primary" type="button" onClick={() => navigate({ to: "/" })}>
          去研究一轮
        </button>
      </div>
    );
  }

  const events = Array.isArray(p.events) ? [...p.events].reverse() : [];
  const markdown = portraitQuery.data?.markdown || "";

  function exportPortrait() {
    if (!markdown) {
      showToast("画像还没加载好。");
      return;
    }
    const ticker = p.ticker || stock.ticker || "echo";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${ticker.replace(/[^\w.-]/g, "")}-portrait.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("已导出画像 Markdown。");
  }

  return (
    <div className="portrait-pane">
      <div className="portrait-bar">
        <span className="portrait-meta">
          研究 {p.turnCount || 0} 轮 · 更新于 {(p.updatedAt || "").slice(0, 10)}
        </span>
        <span className="portrait-bar-actions">
          <button className="wl-linkbtn" type="button" onClick={exportPortrait}>
            导出 Markdown ↓
          </button>
          <button className="wl-linkbtn" type="button" onClick={() => exportPortraitImage(p, showToast)}>
            导出分享图 ↓
          </button>
        </span>
      </div>
      <div className="portrait-doc" dangerouslySetInnerHTML={{ __html: portraitDocHtml(markdown) }} />
      <ResearchReview ticker={stock.ticker} />
      <div className="portrait-timeline">
        <h3>判断变化时间线</h3>
        {events.length ? (
          <ul className="pt-list">
            {events.map((e, i) => (
              <PortraitEvent e={e} key={i} />
            ))}
          </ul>
        ) : (
          <p className="stock-card-body is-empty">还没有判断变化——画像只记"观点变了"的时刻，不记流水账。</p>
        )}
      </div>
    </div>
  );
}

export function StockDetail({ stock }: { stock: WatchStock }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"overview" | "portrait" | "earnings">("overview");
  const st = WD_STATUS[stock.status] || WD_STATUS.intact;
  const chg = wdChg(stock.changePct);

  const priceBlock =
    stock.priceStatus === "ok" && stock.price != null ? (
      <div className="stock-price-row">
        <span className="stock-price">{fmtNum(stock.price)}</span>
        <span className="stock-ccy">{stock.currency}</span>
        {chg ? <span className={`stock-chg ${chg.dir}`}>{chg.text}</span> : null}
        {stock.held && typeof stock.returnPct === "number" ? (
          <span className="stock-pnl">
            持有 <b className={pnlDir(stock.returnPct)}>{fmtPct(stock.returnPct)}</b>
          </span>
        ) : null}
      </div>
    ) : (
      <div className="stock-price-row">
        <span className="wd-noquote">现价暂不可用</span>
      </div>
    );

  return (
    <div className="stock-page">
      <Link className="back-link" to="/watch">
        ← 看盘
      </Link>
      <div className="stock-head">
        <div>
          <div className="stock-title-row">
            <span className="stock-name">{stock.companyName}</span>
            <span className="stock-ticker">{stock.ticker}</span>
            {exBadge(stock.market)}
            <span className={`wd-status ${st.cls}`}>{st.label}</span>
          </div>
          {priceBlock}
          {stock.earnings?.nextDate ? <div className="wl-earnings stock-earnings">下一业绩日 · {stock.earnings.nextDate}</div> : null}
        </div>
        <button className="primary" type="button" onClick={() => navigate({ to: "/" })}>
          深入研究
        </button>
      </div>
      {stock.status === "falsified" && stock.statusReason ? <div className="wd-note stock-note">{stock.statusReason}</div> : null}
      <div className="stock-tabs" role="tablist" aria-label="公司详情">
        <button id="stock-tab-overview" role="tab" aria-selected={tab === "overview"} aria-controls="stock-panel" tabIndex={tab === "overview" ? 0 : -1} className={`stock-tab ${tab === "overview" ? "is-active" : ""}`} type="button" onClick={() => setTab("overview")}>
          总览
        </button>
        <button id="stock-tab-portrait" role="tab" aria-selected={tab === "portrait"} aria-controls="stock-panel" tabIndex={tab === "portrait" ? 0 : -1} className={`stock-tab ${tab === "portrait" ? "is-active" : ""}`} type="button" onClick={() => setTab("portrait")}>
          画像
        </button>
        <button id="stock-tab-earnings" role="tab" aria-selected={tab === "earnings"} aria-controls="stock-panel" tabIndex={tab === "earnings" ? 0 : -1} className={`stock-tab ${tab === "earnings" ? "is-active" : ""}`} type="button" onClick={() => setTab("earnings")}>
          业绩
        </button>
      </div>
      <div id="stock-panel" role="tabpanel" aria-labelledby={`stock-tab-${tab}`}>
        {tab === "portrait" ? <PortraitTab stock={stock} /> : tab === "earnings" ? <EarningsTab stock={stock} /> : <StockOverview stock={stock} />}
      </div>
    </div>
  );
}
