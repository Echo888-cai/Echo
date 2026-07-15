// Structured research answer and evidence renderers.
// (valuation bar, analyst consensus, grounding bar, evidence cards, comparison
// table, focus strip, dual quote, comp anchor, screener/macro blocks, choice
// cards, switch-divider) plus markdown.js's renderRichAnswer() for the answer
// body. This is the single most-rendered component in the app — every message
// in the conversation goes through here.
import type { ReactNode } from "react";
import type { Message } from "../lib/researchStore";
import { isNum, fmtMoney, fmtSigned, dirClass, numFrom, credLevel } from "../lib/format";
import { markdownToHtml, renderRichAnswer } from "../lib/markdown";
import { PositionCard, PortfolioReviewCard } from "./Portfolio";
import { portfolioApi, type PortfolioPosition, type PortfolioReview as PortfolioReviewData } from "../lib/api";
import { showToast } from "../lib/toast";
import { researchSuggested, forceResearch, runComparison, switchAndResearch, returnToCompany, copyMessage } from "../lib/researchActions";
import { useNavigate } from "@tanstack/react-router";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  official: "官方",
  industry_research: "行研",
  financial_media: "财经媒体",
  cn_financial_media: "国内财经",
  market: "行情",
  news: "新闻",
  web: "网页"
};

// A-P1.1: side-by-side comparison table for in-chat comparisons.
function ComparisonTable({ comparison }: { comparison: any }) {
  const left = comparison?.left;
  const right = comparison?.right;
  if (!left || !right) return null;
  const fmtN = (v: any, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—");
  const fmtP = (v: any) => (Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%` : "—");
  const fmtPe = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? `${Number(v).toFixed(1)}x` : "—");
  const fmtOdds = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? `${Number(v).toFixed(1)}:1` : "—");
  const fmtScore = (v: any) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(0)}/100` : "—");
  const rows: [string, (s: any) => string, ((s: any) => number) | null][] = [
    ["现价", (s) => fmtN(s.price), null],
    ["今日涨跌", (s) => fmtP(s.changePct), null],
    ["PE", (s) => fmtPe(s.pe), null],
    ["赔率（回报:风险）", (s) => fmtOdds(s.odds), (s) => (Number.isFinite(s.odds) ? s.odds : -Infinity)],
    ["利润质量", (s) => fmtScore(s.qualityScore), (s) => (Number.isFinite(s.qualityScore) ? s.qualityScore : -Infinity)],
    ["近 1 月", (s) => fmtP(s.oneMonthPct), (s) => (Number.isFinite(s.oneMonthPct) ? s.oneMonthPct : -Infinity)],
    ["年初至今", (s) => fmtP(s.ytdPct), (s) => (Number.isFinite(s.ytdPct) ? s.ytdPct : -Infinity)],
    ["目标价", (s) => fmtN(s.target), null],
    ["较目标上行", (s) => fmtP(s.upsidePct), (s) => (Number.isFinite(s.upsidePct) ? s.upsidePct : -Infinity)]
  ];
  const cellCls = (row: (typeof rows)[number], side: any, other: any) => {
    const better = row[2] && row[2](side) !== row[2](other) && row[2](side) > row[2](other);
    return better ? "cmp-better" : "";
  };
  const verdict = comparison?.verdict;
  const verdictBadge =
    verdict?.winner === "left" || verdict?.winner === "right" ? (
      <span className="cmp-verdict-badge">{(verdict.winner === "left" ? left : right).name || ""} 更优</span>
    ) : null;
  return (
    <div className="comparison-block">
      {verdict ? (
        <div className="comparison-verdict">
          {verdictBadge}
          <span>{verdict.reason}</span>
        </div>
      ) : null}
      <table className="comparison-table">
        <thead>
          <tr>
            <th />
            <th>
              {left.name || left.ticker || "—"}
              <span>{left.ticker || ""}</span>
            </th>
            <th>
              {right.name || right.ticker || "—"}
              <span>{right.ticker || ""}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              <th scope="row">{row[0]}</th>
              <td className={cellCls(row, left, right)}>{row[1](left)}</td>
              <td className={cellCls(row, right, left)}>{row[1](right)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniValBar({ v }: { v: any }) {
  if (!v) return null;
  const bear = numFrom(v.bear);
  const base = numFrom(v.base);
  const bull = numFrom(v.bull);
  const price = numFrom(v.currentPrice);
  if ([bear, base, bull, price].some((n) => n === null)) return null;
  const lo = Math.min(bear!, bull!, price!);
  const hi = Math.max(bear!, bull!, price!);
  const span = hi - lo || 1;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - lo) / span) * 100));
  const zl = Math.min(pct(bear!), pct(bull!));
  const zw = Math.abs(pct(bull!) - pct(bear!));
  return (
    <div className="fc-valbar" title={`看空 ${fmtMoney(bear)} / 中性 ${fmtMoney(base)} / 看多 ${fmtMoney(bull)}，现价 ${fmtMoney(price)}`}>
      <div className="fc-bar">
        <div className="fc-zone" style={{ left: `${zl}%`, width: `${zw}%` }} />
        <div className="fc-pr" style={{ left: `${pct(price!)}%` }} />
      </div>
      <div className="fc-scale">
        <span className="bear">看空 {fmtMoney(bear)}</span>
        <span className="base">中性 {fmtMoney(base)}</span>
        <span className="bull">看多 {fmtMoney(bull)}</span>
      </div>
    </div>
  );
}

function FocusCard({ h }: { h: any }) {
  const chg = fmtSigned(h.changePct);
  const chips: ReactNode[] = [];
  if (isNum(h.shares) && isNum(h.cost)) {
    const pnl = fmtSigned(h.pnlPct);
    chips.push(
      <span className="fc-chip" key="pos">
        持仓 {String(h.shares)}股 @ {fmtMoney(h.cost)}
        {pnl ? (
          <>
            {" "}
            · <em className={dirClass(h.pnlPct)}>{pnl}</em>
          </>
        ) : null}
      </span>
    );
  }
  if (isNum(h.odds) && Number(h.odds) > 0) {
    chips.push(
      <span className="fc-chip" key="odds">
        赔率 {Number(h.odds).toFixed(1)}:1
      </span>
    );
  }
  if (isNum(h.target)) {
    const up = fmtSigned(h.upsidePct);
    chips.push(
      <span className="fc-chip" key="target">
        目标 {fmtMoney(h.target)}
        {up ? `（${up}）` : ""}
      </span>
    );
  }
  return (
    <article className="focus-card">
      <div className="fc-head">
        <b>{h.name || h.ticker}</b>
        <span>{h.ticker || ""}</span>
        {isNum(h.price) ? (
          <strong className="fc-price">
            {fmtMoney(h.price)}
            {chg ? <em className={dirClass(h.changePct)}> {chg}</em> : null}
          </strong>
        ) : null}
      </div>
      {h.valuation ? <MiniValBar v={h.valuation} /> : <div className="fc-noval">估值数据不足，暂不给可信区间</div>}
      {chips.length ? <div className="fc-chips">{chips}</div> : null}
    </article>
  );
}

function FocusStrip({ meta }: { meta: any }) {
  const others: any[] = Array.isArray(meta.otherHoldings) ? meta.otherHoldings : [];
  if (!others.length) return null;
  const mainName = meta.valuationName || "主标的";
  return (
    <div className="focus-strip">
      <div className="focus-head">
        本轮聚焦 · {others.length + 1} 家<span>主标的 {mainName} 见下方完整判断</span>
      </div>
      <div className="focus-cards">
        {others.map((h, i) => (
          <FocusCard h={h} key={h.ticker || i} />
        ))}
      </div>
    </div>
  );
}

function DualQuote({ dq }: { dq: any }) {
  if (!dq || !Number.isFinite(Number(dq.price))) return null;
  const chg = fmtSigned(dq.changePct);
  return (
    <div className="dual-quote">
      <div className="dq-head">
        港股口径 · {dq.ticker}
        <span>盈亏按港股价 + HKD 成本；估值/基本面见下方 ADR 口径</span>
      </div>
      <div className="dq-body">
        <span className="dq-price">
          {fmtMoney(dq.price)} <em className="dq-ccy">{dq.currency || "HKD"}</em>
          {chg ? <em className={dirClass(dq.changePct)}> {chg}</em> : null}
        </span>
        {Number.isFinite(Number(dq.cost)) ? (
          <span className="dq-pnl">
            持仓 {Number.isFinite(Number(dq.shares)) ? `${String(dq.shares)}股 @ ` : ""}
            {fmtMoney(dq.cost)}
            {fmtSigned(dq.pnlPct) ? (
              <>
                {" "}
                · 浮动 <em className={dirClass(dq.pnlPct)}>{fmtSigned(dq.pnlPct)}</em>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ValuationNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <div className="valuation-block valuation-na">
      <div className="valuation-head">
        <span>估值区间</span>
        <em>暂不可用</em>
      </div>
      <p className="val-na-text">{note}</p>
    </div>
  );
}

function Valuation({ valuation, name }: { valuation: any; name?: string | null }) {
  if (!valuation) return null;
  const headLabel = name ? `${name} · 估值区间` : "估值区间";
  const bear = numFrom(valuation.bear);
  const base = numFrom(valuation.base);
  const bull = numFrom(valuation.bull);
  const price = numFrom(valuation.currentPrice);
  if (bear === null || base === null || bull === null || price === null) return null;
  const lo = Math.min(bear, bull, price);
  const hi = Math.max(bear, bull, price);
  const span = hi - lo || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

  const up = price ? (bull - price) / price : 0;
  const down = price ? (price - bear) / price : 0;
  const odds = down > 0.0001 ? up / down : null;
  const oddsText = odds && odds > 0 ? `${odds.toFixed(1)} : 1` : "—";
  const upText = `${up >= 0 ? "+" : ""}${(up * 100).toFixed(0)}%`;
  const downText = `${(((bear - price) / price) * 100).toFixed(0)}%`;
  const zoneLeft = Math.min(pct(bear), pct(bull));
  const zoneWidth = Math.abs(pct(bull) - pct(bear));

  const methods: string[] = Array.isArray(valuation.methods) ? valuation.methods.filter(Boolean) : [];
  const assumptions: string[] = Array.isArray(valuation.keyAssumptions) ? valuation.keyAssumptions.filter(Boolean).slice(0, 5) : [];
  const detail: any[] = Array.isArray(valuation.methodDetail) ? valuation.methodDetail.filter((d: any) => d && Number.isFinite(Number(d.base))) : [];
  const assumeCount = detail.length + assumptions.length;

  return (
    <div className="valuation-block">
      <div className="valuation-head">
        <span>{headLabel}</span>
        <em>{valuation.method || "PE 法"}</em>
      </div>
      <div className="valuation-bar">
        <div className="val-zone" style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }} />
        <div className="val-tick bear" style={{ left: `${pct(bear)}%` }} />
        <div className="val-tick base" style={{ left: `${pct(base)}%` }} />
        <div className="val-tick bull" style={{ left: `${pct(bull)}%` }} />
        <div className="val-price" style={{ left: `${pct(price)}%` }} title={`现价 ${fmt(price)}`} />
      </div>
      <div className="valuation-scale">
        <span className="bear">看空 {fmt(bear)}</span>
        <span className="base">中性 {fmt(base)}</span>
        <span className="bull">看多 {fmt(bull)}</span>
      </div>
      <div className="valuation-stats">
        <span>
          现价 <b>{fmt(price)}</b>
        </span>
        <span className="pos">
          看多上行 <b>{upText}</b>
        </span>
        <span className="neg">
          看空下行 <b>{downText}</b>
        </span>
        <span className="odds">
          赔率 <b>{oddsText}</b>
        </span>
      </div>
      {methods.length > 1 ? (
        <div className="valuation-methods">
          <span className="vm-label">多法交叉</span>
          {methods.map((m) => (
            <span className="vm-tag" key={m}>
              {m}
            </span>
          ))}
        </div>
      ) : null}
      {assumeCount ? (
        <details className="valuation-assume">
          <summary>估值依据 · {assumeCount} 条</summary>
          <ul>
            {detail.map((d, i) => (
              <li className="vm-detail" key={i}>
                <b>{d.name}</b>：看空 {fmt(Number(d.bear))} / 中性 {fmt(Number(d.base))} / 看多 {fmt(Number(d.bull))}
              </li>
            ))}
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const PEER_STAGE_LABEL: Record<string, string> = { profitable: "盈利", loss: "亏损", loss_growth: "亏损高成长" };

function CompAnchor({ compPeers }: { compPeers: any }) {
  if (!compPeers) return null;
  const peers: any[] = Array.isArray(compPeers.peers) ? compPeers.peers : [];
  if (compPeers.providerStatus !== "ok" || !peers.length) {
    if (!compPeers.detail) return null;
    return (
      <div className="comp-anchor comp-anchor-empty">
        <div className="comp-anchor-head">
          <span>同业对照</span>
          <em>未生成</em>
        </div>
        <p className="comp-anchor-note">{compPeers.detail}</p>
      </div>
    );
  }
  const anchor = compPeers.anchor;
  return (
    <div className="comp-anchor">
      <div className="comp-anchor-head">
        <span>同业对照</span>
        <em>Finnhub 同业库 · GICS 自动匹配，非人工精选/非模型判断</em>
      </div>
      <div className="comp-anchor-chips">
        {peers.map((p, i) => {
          const label = p.multiple != null ? `${p.ticker} ${p.multipleType} ${Number(p.multiple).toFixed(1)}x` : p.ticker;
          const title = p.matched ? `已计入锚点（${PEER_STAGE_LABEL[p.stage] || p.stage || ""}）` : p.reason || "未计入锚点";
          return (
            <span className={`ca-chip ${p.matched ? "ca-matched" : "ca-skipped"}`} title={title} key={i}>
              {label}
            </span>
          );
        })}
      </div>
      {anchor ? (
        <p className="comp-anchor-summary">
          同业锚点：{anchor.multipleType} p25 {anchor.p25.toFixed(1)}x / 中位 {anchor.median.toFixed(1)}x / p75 {anchor.p75.toFixed(1)}x（{anchor.n} 家计入，见下方"估值依据"）
        </p>
      ) : (
        <p className="comp-anchor-summary">{compPeers.detail || "同业数据不足，未生成锚点，沿用原估值方法"}</p>
      )}
      {compPeers.partial || compPeers.stale ? (
        <div className="comp-anchor-flags">
          {compPeers.partial ? <span className="ca-flag">部分同业数据超时/不可用</span> : null}
          {compPeers.stale ? <span className="ca-flag">同业数据来自缓存</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function AnalystConsensus({ analyst }: { analyst: any }) {
  if (!analyst) return null;
  const dist = analyst.distribution;
  const target = analyst.target != null ? numFrom(analyst.target) : null;
  const hasDist = dist && Number(dist.total) > 0;
  if (!hasDist && target === null) return null;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  let buyPct = 0;
  let holdPct = 0;
  let sellPct = 0;
  if (hasDist) {
    const total = dist.total;
    buyPct = Math.round((dist.buy / total) * 100);
    holdPct = Math.round((dist.hold / total) * 100);
    sellPct = Math.max(0, 100 - buyPct - holdPct);
  }
  const tone = analyst.consensus === "偏多" ? "buy" : analyst.consensus === "偏空" ? "sell" : "hold";
  const up = typeof analyst.upsidePct === "number" ? analyst.upsidePct : null;
  const upTone = up == null ? "" : up > 0 ? "pos" : up < 0 ? "neg" : "";
  const lo = analyst.targetLow != null ? numFrom(analyst.targetLow) : null;
  const hi = analyst.targetHigh != null ? numFrom(analyst.targetHigh) : null;

  return (
    <div className="analyst-block">
      <div className="analyst-head">
        <span>分析师一致预期</span>
        {analyst.source ? <em>{analyst.source}</em> : null}
      </div>
      {hasDist ? (
        <>
          <div className="analyst-bar" role="img" aria-label={`买入 ${dist.buy}，持有 ${dist.hold}，卖出 ${dist.sell}`}>
            {dist.buy ? <span className="seg buy" style={{ width: `${buyPct}%` }} /> : null}
            {dist.hold ? <span className="seg hold" style={{ width: `${holdPct}%` }} /> : null}
            {dist.sell ? <span className="seg sell" style={{ width: `${sellPct}%` }} /> : null}
          </div>
          <div className="analyst-counts">
            <span className="buy">买入 {dist.buy}</span>
            <span className="hold">持有 {dist.hold}</span>
            <span className="sell">卖出 {dist.sell}</span>
          </div>
        </>
      ) : null}
      <div className="analyst-chips">
        {analyst.consensus ? <span className={`ac-chip ${tone}`}>共识 {analyst.consensus}</span> : null}
        {target !== null ? (
          <span className="ac-chip target">
            目标价 <b>{fmt(target)}</b>
            {up != null ? <em className={upTone}>（较现价 {up > 0 ? "+" : ""}{up}%）</em> : null}
          </span>
        ) : null}
        {target !== null && lo !== null && hi !== null ? (
          <span className="ac-chip">
            区间 {fmt(lo)}~{fmt(hi)}
          </span>
        ) : null}
        {typeof analyst.analysts === "number" && analyst.analysts > 0 ? <span className="ac-chip">{analyst.analysts} 位分析师</span> : null}
      </div>
    </div>
  );
}

function GroundingBar({ meta }: { meta: any }) {
  const slots: { label: string; ok: boolean }[] = Array.isArray(meta.grounding) ? meta.grounding : [];
  if (!slots.length) return null;
  const missing: string[] = Array.isArray(meta.missing) ? meta.missing.filter(Boolean) : [];
  return (
    <div className="grounding-bar">
      {slots.map((s) => (
        <span className={`ground-chip ${s.ok ? "ok" : "miss"}`} key={s.label}>
          {s.label}
          <i>{s.ok ? "✓" : "✗"}</i>
        </span>
      ))}
      {typeof meta.completeness === "number" ? (
        <span className="ground-complete" title={missing.length ? `还缺：${missing.join("、")}` : "关键数据槽已齐备"}>
          完整度 {meta.completeness}%
        </span>
      ) : null}
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: any[] }) {
  if (!Array.isArray(evidence) || !evidence.length) return null;
  const withUrl = evidence.filter((item) => item.url);
  if (!withUrl.length) return null;
  return (
    <div className="evidence-block">
      <div className="evidence-head">证据来源 · {withUrl.length}</div>
      <div className="evidence-cards">
        {withUrl.map((item, i) => (
          <a className="evidence-card" href={item.url} target="_blank" rel="noopener noreferrer" key={i}>
            <span className={`evidence-badge type-${item.type || "web"}`}>{SOURCE_TYPE_LABEL[item.type] || "网页"}</span>
            <span className="evidence-name">{item.title}</span>
            <span className="evidence-foot">
              <i className={`cred-dot ${credLevel(item.cred)}`} />
              {item.source || ""}
              {item.date ? ` · ${item.date}` : ""}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function DataSourceLine({ dataSources }: { dataSources: any }) {
  if (!dataSources) return null;
  const chips: string[] = [];
  const mkt = dataSources.market;
  if (mkt?.status === "ok") {
    const detail = [mkt.source, mkt.freshness || mkt.asOf].filter(Boolean).join(" · ");
    chips.push(detail ? `行情：${detail}` : "行情");
  }
  const fin = dataSources.financials;
  if (fin?.status === "ok") {
    const detail = [fin.source, fin.period].filter(Boolean).join(" ");
    chips.push(detail ? `财报：${detail}` : "财报");
  }
  const val = dataSources.valuation;
  if (val?.status === "ok" && val.method) {
    chips.push(`估值：${val.method}`);
  }
  if (!chips.length) return null;
  return <div className="data-source-line">{chips.join("　")}</div>;
}

function AnswerMeta({ meta }: { meta: any }) {
  const spans: ReactNode[] = [];
  if (meta.confidence) {
    const lvl = meta.confidence === "高" ? "high" : meta.confidence === "低" ? "low" : "mid";
    spans.push(
      <span className={`conf conf-${lvl}`} title={meta.confidenceNote || undefined} key="conf">
        置信度 {meta.confidence}
        {meta.confidenceNote ? " ⓘ" : ""}
      </span>
    );
  }
  if (meta.mode) spans.push(<span key="mode">{/model/.test(meta.mode) ? "模型生成" : "本地兜底"}</span>);
  if (typeof meta.webCount === "number") spans.push(<span key="web">网页证据 {meta.webCount} 条</span>);
  if (Array.isArray(meta.sources) && meta.sources.length) spans.push(<span key="src">数据源：{meta.sources.join("/")}</span>);
  if (!spans.length) return null;
  return <div className="answer-meta">{spans}</div>;
}

// ── P6 screener/macro blocks ──────────────────────────────────────────────
const fmtMcap = (v: any): string => {
  if (!Number.isFinite(Number(v)) || !v) return "—";
  const n = Number(v);
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} 万亿`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)} 亿`;
  return `${(n / 1e4).toFixed(0)} 万`;
};

function ScreenerFilterChips({ filters = {} }: { filters: any }) {
  const chips: string[] = [];
  chips.push(filters.market === "HK" ? "港股" : "美股");
  if (filters.sectorLabel) chips.push(filters.sectorLabel);
  if (filters.peMax != null) chips.push(`PE < ${filters.peMax}`);
  if (filters.peMin != null) chips.push(`PE > ${filters.peMin}`);
  if (filters.mcapMin != null) chips.push(`市值 > ${fmtMcap(filters.mcapMin)}`);
  if (filters.mcapMax != null) chips.push(`市值 < ${fmtMcap(filters.mcapMax)}`);
  if (filters.priceMax != null) chips.push(`价格 < ${filters.priceMax}`);
  if (filters.priceMin != null) chips.push(`价格 > ${filters.priceMin}`);
  return (
    <>
      {chips.map((c, i) => (
        <span className="scr-chip" key={i}>
          {c}
        </span>
      ))}
    </>
  );
}

function ScreenerBlock({ screener = {} }: { screener: any }) {
  const navigate = useNavigate();
  const rows: any[] = Array.isArray(screener.rows) ? screener.rows : [];
  const notes: string[] = Array.isArray(screener.notes) ? screener.notes.filter(Boolean) : [];
  return (
    <div className="screener-block">
      <div className="scr-head">
        <span>筛选结果 · {rows.length} 家</span>
        <ScreenerFilterChips filters={screener.filters} />
      </div>
      {rows.length ? (
        <div className="scr-tablewrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th>公司</th>
                <th>行业</th>
                <th>市值</th>
                <th>PE</th>
                <th>现价</th>
                <th>为什么排这里</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr className={r.researched ? "scr-researched" : ""} key={i}>
                  <td className="scr-name">
                    <b>{r.name}</b>
                    <span>{r.ticker}</span>
                    {r.researched ? <i className="scr-badge">已研究</i> : null}
                  </td>
                  <td className="scr-ind">{r.industry || r.sector || "—"}</td>
                  <td className="scr-num">{fmtMcap(r.mcap)}</td>
                  <td className="scr-num">{r.pe != null ? String(r.pe) : "—"}</td>
                  <td className="scr-num">{r.price != null && Number.isFinite(Number(r.price)) ? String(r.price) : "—"}</td>
                  <td className="scr-reason">{r.reason || "—"}</td>
                  <td className="scr-act">
                    <button type="button" className="scr-research" onClick={() => { void researchSuggested(r.ticker, r.name); navigate({ to: "/" }); }}>
                      研究 →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="scr-empty">这个条件下没有筛到公司——放宽条件（去掉 PE 上限 / 换行业）再试一次。</p>
      )}
      {notes.length ? (
        <div className="scr-notes">
          {notes.map((n, i) => (
            <span key={i}>· {n}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IndicesStrip({ indices = [] }: { indices: any[] }) {
  const ok = (Array.isArray(indices) ? indices : []).filter((i) => i && Number.isFinite(Number(i.price)));
  if (!ok.length) return null;
  return (
    <div className="macro-indices">
      {ok.map((i, idx) => {
        const chg = Number(i.changePct);
        const dir = Number.isFinite(chg) ? (chg > 0 ? "is-up" : chg < 0 ? "is-down" : "is-flat") : "is-flat";
        const chgTxt = Number.isFinite(chg) ? `${chg > 0 ? "+" : ""}${chg}%` : "";
        return (
          <span className="mi-card" key={idx}>
            <em>{i.label}</em>
            <b>{Number(i.price).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</b>
            {chgTxt ? <i className={dir}>{chgTxt}</i> : null}
          </span>
        );
      })}
    </div>
  );
}

// ── choice card action dispatch (compare/switch/research/force) ───────────
function ChoiceCard({ choice }: { choice: any }) {
  const options: any[] = choice.options || [];
  async function act(o: any) {
    if (o.act === "compare") await runComparison({ ticker: o.ticker, name: o.name });
    else if (o.act === "switch") await switchAndResearch({ ticker: o.ticker, name: o.name });
    else if (o.act === "research") await researchSuggested(o.ticker, o.name);
    else if (o.act === "force") await forceResearch(o.ticker);
  }
  return (
    <article className="message assistant">
      <div className="bubble answer-card choice-card">
        <div className="answer-brand">
          <div className="answer-mark">
            <i />
            <span>ECHO</span>
          </div>
        </div>
        <p className="choice-prompt">{choice.prompt}</p>
        <div className="choice-options">
          {options.map((o, i) => (
            <button className={`choice-btn ${o.recommended ? "is-rec" : ""}`} type="button" onClick={() => void act(o)} key={i}>
              <span className="choice-label">
                {o.label}
                {o.recommended ? <i className="choice-rec"> 推荐</i> : null}
              </span>
              {o.hint ? <span className="choice-hint">{o.hint}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

// ── 我的持仓 message replay (portfolio.js's renderPortfolioPanel) ─────────
function PortfolioPanelMessage({ positions = [], review }: { positions: PortfolioPosition[]; review: PortfolioReviewData | null }) {
  const navigate = useNavigate();
  async function handleDelete(ticker: string) {
    if (!window.confirm(`从持仓里移除 ${ticker}？`)) return;
    try {
      await portfolioApi.remove(ticker);
      showToast("已移除持仓。");
    } catch {
      showToast("删除失败。");
    }
  }
  if (!positions.length) {
    return (
      <p className="pf-empty">
        还没有记账。点下面按钮，或在对话里说一句即可记录，例如：<strong>耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5</strong>。
        <div className="pf-actions">
          <button className="pf-add" type="button" onClick={() => navigate({ to: "/" })}>
            ＋ 记一笔持仓
          </button>
        </div>
      </p>
    );
  }
  return (
    <>
      <PortfolioReviewCard review={review} />
      <div className="pf-list">
        {positions.map((p) => (
          <PositionCard key={p.ticker} position={p} onDelete={handleDelete} />
        ))}
      </div>
    </>
  );
}

// ── top-level dispatcher ────────────────────────────────────────────────
export function AnswerCard({ message }: { message: Message }) {
  const navigate = useNavigate();
  if (message.role === "user") {
    return (
      <article className="message user">
        <div className="bubble" dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }} />
      </article>
    );
  }

  const meta = message.meta || {};

  if (meta.type === "screener" && meta.screener) {
    return (
      <article className="message assistant">
        <div className="bubble answer-card">
          <div className="answer-brand">
            <div className="answer-mark">
              <i />
              <span>ECHO SCREENER</span>
            </div>
          </div>
          <ScreenerBlock screener={meta.screener} />
        </div>
      </article>
    );
  }

  if (meta.type === "macro") {
    return (
      <article className="message assistant">
        <div className="bubble answer-card">
          <div className="answer-brand">
            <div className="answer-mark">
              <i />
              <span>宏观观察</span>
            </div>
            <button className="copy-answer" type="button" onClick={() => void copyMessage(message.id)}>
              复制
            </button>
          </div>
          <IndicesStrip indices={meta.indices} />
          <div dangerouslySetInnerHTML={{ __html: renderRichAnswer(message.content) }} />
          <EvidenceBlock evidence={meta.evidence} />
          <AnswerMeta meta={{ mode: meta.mode, webCount: Array.isArray(meta.evidence) ? meta.evidence.length : undefined }} />
        </div>
      </article>
    );
  }

  if (meta.type === "switch-divider" && meta.from && meta.to) {
    return (
      <div className="switch-divider">
        <span className="switch-line" />
        <span className="switch-text">
          已从 <b>{meta.from.name}</b> 切到 <b>{meta.to.name}</b>
        </span>
        <button className="switch-back" type="button" onClick={() => void returnToCompany(meta.from.ticker, meta.from.name, () => navigate({ to: "/" }))}>
          回到 {meta.from.name}
        </button>
        <span className="switch-line" />
      </div>
    );
  }

  if (meta.type === "choice" && meta.choice) {
    return <ChoiceCard choice={meta.choice} />;
  }

  const title = meta.type === "deep_research" ? "DEEP RESEARCH" : meta.type === "portrait" ? "公司画像" : meta.type === "digest" ? "事件提醒" : meta.type === "portfolio" ? "我的持仓" : "ECHO";
  const isPortfolio = meta.type === "portfolio";

  return (
    <article className="message assistant">
      <div className="bubble answer-card">
        <div className="answer-brand">
          <div className="answer-mark">
            <i />
            <span>{title}</span>
          </div>
          {isPortfolio ? null : (
            <button className="copy-answer" type="button" onClick={() => void copyMessage(message.id)}>
              复制
            </button>
          )}
        </div>
        {isPortfolio ? null : <GroundingBar meta={meta} />}
        {isPortfolio ? null : <DataSourceLine dataSources={meta.dataSources} />}
        {isPortfolio ? null : <ComparisonTable comparison={meta.comparison} />}
        {isPortfolio ? null : <FocusStrip meta={meta} />}
        {isPortfolio ? null : <DualQuote dq={meta.dualQuote} />}
        {isPortfolio ? (
          <PortfolioPanelMessage positions={meta.positions} review={meta.review} />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderRichAnswer(message.content) }} />
        )}
        <Valuation valuation={meta.valuation} name={meta.otherHoldings && meta.otherHoldings.length ? meta.valuationName : null} />
        {meta.valuation && !meta.valuation.cannotValueReason ? null : (
          <ValuationNote note={meta.valuationNote || meta.valuation?.cannotValueReason || null} />
        )}
        <CompAnchor compPeers={meta.valuation?.compPeers} />
        <AnalystConsensus analyst={meta.analyst} />
        <EvidenceBlock evidence={meta.evidence} />
        {isPortfolio ? null : <AnswerMeta meta={meta} />}
      </div>
    </article>
  );
}
