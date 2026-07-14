// Watch desk list, filters, sorting and add/remove controls.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { WatchCard, WatchDesk } from "../lib/api";
import { watchApi } from "../lib/api";
import { resolveCompany } from "../lib/resolve";
import { detectMarket } from "../lib/market";
import { fmtNum, fmtPct, pnlDir, wdChg } from "../lib/format";

const WD_STATUS: Record<string, { label: string; cls: string }> = {
  falsified: { label: "已触发证伪", cls: "wd-falsified" },
  at_risk: { label: "有风险", cls: "wd-risk" },
  intact: { label: "逻辑还在", cls: "wd-intact" }
};

const WL_CHEVRON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const WL_X = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const WD_REFRESH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.6-6.3" />
    <path d="M21 3v6h-6" />
  </svg>
);

function exBadge(marketOrTicker: string) {
  const mkt = marketOrTicker === "US" || marketOrTicker === "HK" || marketOrTicker === "CN" ? marketOrTicker : detectMarket(marketOrTicker);
  const label = mkt === "US" ? "美股" : mkt === "CN" ? "A股" : "港股";
  return <span className={`ex-badge ${mkt.toLowerCase()}`}>{label}</span>;
}

// Inline mini price sparkline (pure SVG, no deps): last-month closes → a 92×26
// polyline, green up / red down / gray flat.
function SparkSvg({ spark }: { spark: any }) {
  const pts: number[] | null = spark && Array.isArray(spark.points) ? spark.points : null;
  if (!pts || pts.length < 5) {
    return (
      <span className="wl-spark is-empty" aria-hidden="true">
        <i />
      </span>
    );
  }
  const W = 92;
  const H = 26;
  const pad = 2.5;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const path = pts
    .map((c, i) => {
      const x = pad + (i / (pts.length - 1)) * (W - pad * 2);
      const y = H - pad - ((c - min) / span) * (H - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const dir = spark.changePct > 0.05 ? "sp-up" : spark.changePct < -0.05 ? "sp-down" : "sp-flat";
  return (
    <span className={`wl-spark ${dir}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

// Failure placeholders / "no info" / data-availability diagnostics don't belong
// as a "one-line summary" — skip them and fall back to the day's event. The
// generator already separates diagnostic text from the investment thesis
// (decisionPanel.dataReadiness); this regex is a backstop for older stale rows.
const WL_BAD_THESIS = /不可用|无法形成|暂无|尚未|待补充|已有财务数据|缺一致预期|缺用户持仓|行情已接入/;

function WatchRow({ card, onOpen, onRemove }: { card: WatchCard; onOpen: () => void; onRemove: () => void }) {
  const st = WD_STATUS[card.status] || WD_STATUS.intact;
  let sec = card.thesis && !WL_BAD_THESIS.test(card.thesis) ? card.thesis : "";
  if (!sec && card.topEvent?.title) sec = String(card.topEvent.title).replace(/\s+[-–—]\s+[^-–—]*$/, "").trim();

  let price: ReactNode = <span className="wl-price is-none">—</span>;
  let chg: ReactNode = <span className="wd-chg is-flat" />;
  if (card.priceStatus === "ok" && card.price != null) {
    price = (
      <span className="wl-price">
        {fmtNum(card.price)}
        {card.currency ? <small>{card.currency}</small> : null}
      </span>
    );
    const d = wdChg(card.changePct);
    if (d) chg = <span className={`wd-chg ${d.dir}`}>{d.text}</span>;
  } else if (card.priceStatus === "loading") {
    price = <span className="wl-price is-none">…</span>;
  }
  const pnl =
    card.held && typeof card.returnPct === "number" ? (
      <span className="wl-pnl">
        <b className={pnlDir(card.returnPct)}>{fmtPct(card.returnPct)}</b>
      </span>
    ) : (
      <span className="wl-pnl is-none">—</span>
    );

  return (
    <div className="wl-item">
      <button className={`wl-row st-${card.status}`} type="button" onClick={onOpen}>
        <span className={`wd-dot st-${card.status}`} aria-hidden="true" />
        <span className="wl-main">
          <span className="wd-name">{card.companyName}</span>
          <span className="wd-ticker">{card.ticker}</span>
          {exBadge(card.market)}
          {card.status !== "intact" ? <span className={`wd-status ${st.cls}`}>{st.label}</span> : null}
          {card.earnings?.nextDate ? (
            <span className="wl-earnings" title="下一业绩日">
              财报 {card.earnings.nextDate}
            </span>
          ) : null}
        </span>
        <SparkSvg spark={card.spark} />
        {price}
        {chg}
        {pnl}
        <span className="wl-thesis">{sec}</span>
        <span className="wl-chev">{WL_CHEVRON}</span>
      </button>
      <button
        className="wl-x"
        type="button"
        aria-label={`移出关注：${card.companyName}`}
        title="移出关注"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        {WL_X}
      </button>
    </div>
  );
}

function WatchColumns() {
  return (
    <div className="wl-cols" aria-hidden="true">
      <span />
      <span>公司</span>
      <span className="c-spark">近一月</span>
      <span className="c-num">现价</span>
      <span className="c-num">今日</span>
      <span className="c-num">持有</span>
      <span>投资主线 / 今日事件</span>
      <span />
    </div>
  );
}

const WATCH_FILTERS: [string, string][] = [
  ["all", "全部"],
  ["hk", "港股"],
  ["us", "美股"],
  ["cn", "A股"],
  ["held", "持仓"],
  ["risk", "预警"]
];
const WATCH_SORTS: [string, string][] = [
  ["urgency", "紧急度"],
  ["change", "涨跌"],
  ["name", "名称"]
];

function applyWatchView(cards: WatchCard[], filter: string, sort: string): WatchCard[] {
  let out = cards;
  if (filter === "hk") out = out.filter((c) => c.market === "HK");
  else if (filter === "us") out = out.filter((c) => c.market === "US");
  else if (filter === "cn") out = out.filter((c) => c.market === "CN");
  else if (filter === "held") out = out.filter((c) => c.held);
  else if (filter === "risk") out = out.filter((c) => c.status === "falsified" || c.status === "at_risk");
  if (sort === "change") {
    out = [...out].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
  } else if (sort === "name") {
    out = [...out].sort((a, b) => String(a.companyName).localeCompare(String(b.companyName), "zh"));
  }
  return out;
}

function WatchAddForm({
  busy,
  error,
  onSubmit,
  onCancel
}: {
  busy: boolean;
  error: string;
  onSubmit: (q: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  return (
    <form
      className="wl-add"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(q);
      }}
    >
      <input
        name="q"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="公司名或代码，如 苹果 / AAPL / 0700.HK"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={busy}
      />
      <button className="wl-add-submit" type="submit" disabled={busy}>
        {busy ? "添加中…" : "添加"}
      </button>
      <button className="wl-add-cancel" type="button" onClick={onCancel}>
        取消
      </button>
      {error ? <span className="wl-add-error">{error}</span> : null}
    </form>
  );
}

export function WatchListBody({ desk, loaded, onRefetch }: { desk: WatchDesk | null; loaded: boolean; onRefetch: () => void }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("urgency");
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // Optimistic local overlay: newly-tracked/untracked tickers, applied on top of
  // the query cache until the next desk refetch reconciles it.
  // Insert a minimal card immediately, then backfill it in the background.
  const [optimisticCards, setOptimisticCards] = useState<WatchCard[] | null>(null);

  const cards: WatchCard[] = useMemo(
    () => optimisticCards ?? desk?.cards ?? [],
    [optimisticCards, desk?.cards]
  );

  async function handleOpen(ticker: string) {
    navigate({ to: "/watch/$ticker", params: { ticker } });
  }

  async function handleRemove(ticker: string) {
    setOptimisticCards(cards.filter((c) => c.ticker !== ticker));
    try {
      await watchApi.untrack(ticker);
    } catch {
      /* next refresh self-heals */
    }
    onRefetch();
  }

  async function handleAdd(q: string) {
    if (!q || addBusy) return;
    setAddBusy(true);
    setAddError("");
    try {
      const company = await resolveCompany(q, { verify: true });
      const ticker = company && "ticker" in company ? company.ticker : null;
      if (ticker) {
        const nameZh = "nameZh" in company! ? company.nameZh : ticker;
        await watchApi.track(ticker, nameZh || ticker);
        setAddOpen(false);
        setAddBusy(false);
        if (!cards.some((c) => c.ticker === ticker)) {
          const market = detectMarket(ticker);
          setOptimisticCards([
            {
              ticker, companyName: nameZh || ticker, market, status: "intact", priceStatus: "loading", held: false,
              price: null, currency: null, changePct: null, returnPct: null, thesis: "", confidence: "",
              asOf: null, updatedAt: null, earnings: null, spark: null, topEvent: null
            },
            ...cards
          ]);
        }
        onRefetch();
        return;
      }
      setAddError(`没识别出「${q}」，换个代码试试，如 AAPL、0700.HK、600519.SS`);
    } catch {
      setAddError("添加失败，请重试");
    }
    setAddBusy(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    onRefetch();
    setTimeout(() => setRefreshing(false), 600);
  }

  const visible = useMemo(() => applyWatchView(cards, filter, sort), [cards, filter, sort]);

  if (!cards.length) {
    if (!loaded) return <div className="wd-loading">正在加载看盘…</div>;
    return (
      <div className="wd-empty-cta">
        <p className="hero-eyebrow">
          <span className="hero-spark" />
          看盘
        </p>
        <h2>还没有可盯的公司</h2>
        <p>完成一轮研究，或记一笔持仓，公司就会自动出现在这里，跟踪它的画像、事件、涨跌和价格曲线。</p>
        <Link className="primary" to="/">
          去研究一家公司
        </Link>
        <div className="wl-empty-add">
          {addOpen ? (
            <WatchAddForm busy={addBusy} error={addError} onSubmit={handleAdd} onCancel={() => setAddOpen(false)} />
          ) : (
            <button className="wl-linkbtn" type="button" onClick={() => setAddOpen(true)}>
              或直接添加代码关注 →
            </button>
          )}
        </div>
      </div>
    );
  }

  const counts = desk?.counts || ({} as WatchDesk["counts"]);
  const bits: ReactNode[] = [];
  if (counts.falsified) bits.push(<span className="wd-count wd-falsified" key="f">{counts.falsified} 已触发证伪</span>);
  if (counts.atRisk) bits.push(<span className="wd-count wd-risk" key="r">{counts.atRisk} 有风险</span>);
  bits.push(<span className="wd-count wd-intact" key="i">{counts.intact || 0} 逻辑还在</span>);

  const ups = cards.filter((c) => typeof c.changePct === "number" && c.changePct > 0.0001).length;
  const downs = cards.filter((c) => typeof c.changePct === "number" && c.changePct < -0.0001).length;
  const at = desk?.generatedAt ? new Date(desk.generatedAt) : null;
  const timeText = at && !Number.isNaN(at.getTime()) ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")} 更新` : "";

  const riskCount = cards.filter((c) => c.status !== "intact").length;

  return (
    <div className="watchdesk">
      <div className="wd-head">
        <div>
          <p className="hero-eyebrow">
            <span className="hero-spark" />
            看盘
            {desk?.partial ? <span className="wd-partial">事件补全中…</span> : null}
          </p>
          <h2 className="wd-title">{counts.total || cards.length} 只关注中的股票</h2>
        </div>
        <div className="wd-summary">
          <Link className="wd-portfolio-link" to="/portfolio">
            我的持仓
          </Link>
          <button className="wd-portfolio-link wl-add-btn" type="button" onClick={() => setAddOpen((v) => !v)}>
            ＋ 添加
          </button>
        </div>
      </div>
      <div className="wd-overview">
        {bits}
        <span className="wdo-sep" aria-hidden="true" />
        <span className="wdo-updn">
          {ups || downs ? (
            <>
              <b className="is-up">↑ {ups}</b>
              <b className="is-down">↓ {downs}</b>
            </>
          ) : (
            <span className="wdo-quiet">今日行情加载中</span>
          )}
        </span>
        <span className="wdo-right">
          {timeText ? <span className="wdo-time">{timeText}</span> : null}
          <button className={`wdo-refresh ${refreshing ? "is-busy" : ""}`} type="button" title="刷新看盘" aria-label="刷新看盘" onClick={handleRefresh}>
            {WD_REFRESH}
          </button>
        </span>
      </div>
      {addOpen ? (
        <div className="wl-addbar">
          <WatchAddForm busy={addBusy} error={addError} onSubmit={handleAdd} onCancel={() => setAddOpen(false)} />
        </div>
      ) : null}
      {cards.length > 1 ? (
        <div className="wl-controls">
          <div className="wl-seggroup" role="group" aria-label="筛选">
            {WATCH_FILTERS.map(([v, label]) => {
              const n = v === "risk" && riskCount ? ` ${riskCount}` : "";
              return (
                <button key={v} type="button" className={`wl-seg ${filter === v ? "is-on" : ""}`} onClick={() => setFilter(v)}>
                  {label}
                  {n}
                </button>
              );
            })}
          </div>
          <div className="wl-seggroup wl-sorts" role="group" aria-label="排序">
            <span className="wl-seglabel">排序</span>
            {WATCH_SORTS.map(([v, label]) => (
              <button key={v} type="button" className={`wl-seg ${sort === v ? "is-on" : ""}`} onClick={() => setSort(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="wl-list">
        <WatchColumns />
        {visible.map((c) => (
          <WatchRow key={c.ticker} card={c} onOpen={() => handleOpen(c.ticker)} onRemove={() => handleRemove(c.ticker)} />
        ))}
        {cards.length && !visible.length ? (
          <div className="wl-filter-empty">
            这个筛选下没有公司。
            <button type="button" className="wl-linkbtn" onClick={() => setFilter("all")}>
              看全部
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
