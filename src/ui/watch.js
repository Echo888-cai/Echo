// ── 看盘：关注列表 + 公司页（真价格曲线 / 四卡 / 画像 Tab）──
import { S, render, currentRoute, routeTicker } from "./state.js";
import { api } from "./api.js";
import { esc, toast, fmtPct, fmtNum, pnlDir, wdChg, wdWhen } from "./format.js";
import { markdownToHtml } from "./markdown.js";
import { resolveCompany } from "./resolve.js";
import { shell } from "./shell.js";

// 两段式刷新（UX-6 提速）：先 fast 模式（跳过新闻等慢源，1-3s 有价格和状态可看），
// 再全量补事件。全量失败时保留 fast 结果——宁可少事件，不要白屏。
export async function refreshWatchDesk() {
  let gotFast = false;
  try {
    const fast = await api("/api/watch/desk?events=0");
    if (fast.desk) {
      S.watchDesk = fast.desk;
      gotFast = true;
      S.watchDeskLoaded = true;
      if (currentRoute().startsWith("/watch")) render();
    }
  } catch { /* fast 失败就等全量 */ }
  try {
    const data = await api("/api/watch/desk");
    S.watchDesk = data.desk || (gotFast ? S.watchDesk : null);
  } catch {
    if (!gotFast) S.watchDesk = null;
  } finally {
    S.watchDeskLoaded = true;
    if (currentRoute().startsWith("/watch")) render();
  }
}

const WD_STATUS = {
  falsified: { label: "已触发证伪", cls: "wd-falsified" },
  at_risk: { label: "有风险", cls: "wd-risk" },
  intact: { label: "逻辑还在", cls: "wd-intact" }
};

// ── 看盘瘦列表（替代原盯盘卡墙）：一行一家，扫一眼 + 点进公司页 ──
const WL_CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const WL_X = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const WD_REFRESH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>';

// 研究状态枚举 → 用户语言（与服务端 RESEARCH_STATUS_LABELS 对齐，个股页展示用）。
const RS_LABEL = {
  watch: "持续观察", research_more: "需要补充材料", data_missing: "数据缺失",
  risk_alert: "风险提示", out_of_scope: "不在范围"
};

// 行内迷你价格曲线（纯 SVG 无依赖）：近一月收盘 → 92×26 折线，涨绿跌红平灰。
// preserveAspectRatio=none 让曲线充满格子；粗细/颜色由外层 class 控制。
function sparkSvg(spark) {
  const pts = spark && Array.isArray(spark.points) ? spark.points : null;
  if (!pts || pts.length < 5) return `<span class="wl-spark is-empty" aria-hidden="true"><i></i></span>`;
  const W = 92, H = 26, pad = 2.5;
  const min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1;
  const path = pts.map((c, i) => {
    const x = pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = H - pad - ((c - min) / span) * (H - pad * 2);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const dir = spark.changePct > 0.05 ? "sp-up" : spark.changePct < -0.05 ? "sp-down" : "sp-flat";
  return `<span class="wl-spark ${dir}" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg></span>`;
}
// 失败占位/无信息/数据可用性诊断类的主线不配当"一句话摘要"，跳过它退回事件。
// 生成侧已把诊断文案与投资主线分离（decisionPanel.dataReadiness），这里留作历史脏数据的后备防线。
const WL_BAD_THESIS = /不可用|无法形成|暂无|尚未|待补充|已有财务数据|缺一致预期|缺用户持仓|行情已接入/;

// 每行（专业盘面网格）：状态点 · 名称/代码/市场 · 近一月 sparkline · 现价 · 今日涨跌 ·
// 持有盈亏 · 主线一句 · 悬停×移除。列由 .wl-row 的 grid 对齐，数字列右对齐 tabular-nums。
function renderWatchRow(c) {
  const st = WD_STATUS[c.status] || WD_STATUS.intact;
  const mkt = c.market === "US" ? `<span class="ex-badge us">美股</span>` : `<span class="ex-badge hk">港股</span>`;
  // intact 靠圆点 + 左沿颜色表达即可，不再多贴一个状态标签（克制）；falsified/at_risk 才点名。
  const statusPill = c.status !== "intact" ? `<span class="wd-status ${st.cls}">${st.label}</span>` : "";
  // 一句摘要：优先我的投资主线（中文、干净）；主线是失败占位就退回今日事件（去掉" - 来源"后缀）。
  let sec = c.thesis && !WL_BAD_THESIS.test(c.thesis) ? c.thesis : "";
  if (!sec && c.topEvent?.title) sec = c.topEvent.title.replace(/\s+[-–—]\s+[^-–—]*$/, "").trim();
  const earningsBadge = c.earnings?.nextDate ? `<span class="wl-earnings" title="下一业绩日">财报 ${esc(c.earnings.nextDate)}</span>` : "";

  let price = `<span class="wl-price is-none">—</span>`;
  let chg = `<span class="wd-chg is-flat"></span>`;
  if (c.priceStatus === "ok" && c.price != null) {
    price = `<span class="wl-price">${fmtNum(c.price)}</span>`;
    const d = wdChg(c.changePct);
    if (d) chg = `<span class="wd-chg ${d.dir}">${d.text}</span>`;
  } else if (c.priceStatus === "loading") {
    price = `<span class="wl-price is-none">…</span>`;
  }
  const pnl = c.held && typeof c.returnPct === "number"
    ? `<span class="wl-pnl"><b class="${pnlDir(c.returnPct)}">${fmtPct(c.returnPct)}</b></span>`
    : `<span class="wl-pnl is-none">—</span>`;

  // .wl-item 是定位容器；行(button)与移除×(button)是兄弟节点（不能嵌套 button），
  // 点击时 closest([data-action]) 各自命中，互不干扰。
  return `<div class="wl-item">
    <button class="wl-row st-${c.status}" type="button" data-action="open-stock" data-ticker="${esc(c.ticker)}" data-name="${esc(c.companyName)}">
      <span class="wd-dot st-${c.status}" aria-hidden="true"></span>
      <span class="wl-main">
        <span class="wd-name">${esc(c.companyName)}</span>
        <span class="wd-ticker">${esc(c.ticker)}</span>
        ${mkt}
        ${statusPill}
        ${earningsBadge}
      </span>
      ${sparkSvg(c.spark)}
      ${price}
      ${chg}
      ${pnl}
      <span class="wl-thesis">${sec ? esc(sec) : ""}</span>
      <span class="wl-chev">${WL_CHEVRON}</span>
    </button>
    <button class="wl-x" type="button" data-action="untrack-stock" data-ticker="${esc(c.ticker)}" aria-label="移出关注：${esc(c.companyName)}" title="移出关注">${WL_X}</button>
  </div>`;
}

// 列头（与 .wl-row 同一套 grid 列，仅宽屏显示）。
function renderWatchColumns() {
  return `<div class="wl-cols" aria-hidden="true">
    <span></span><span>公司</span><span class="c-spark">近一月</span>
    <span class="c-num">现价</span><span class="c-num">今日</span><span class="c-num">持有</span>
    <span>投资主线 / 今日事件</span><span></span>
  </div>`;
}

// "添加关注"输入框：输公司名或代码 → 复用研究页的 resolveCompany 解析 → track。
function renderWatchAddForm() {
  return `<form class="wl-add" data-form="watch-add">
    <input name="q" type="text" autocomplete="off" spellcheck="false" placeholder="公司名或代码，如 苹果 / AAPL / 0700.HK" ${S.watchAddBusy ? "disabled" : ""} />
    <button class="wl-add-submit" type="submit" ${S.watchAddBusy ? "disabled" : ""}>${S.watchAddBusy ? "添加中…" : "添加"}</button>
    <button class="wl-add-cancel" type="button" data-action="watch-add-close">取消</button>
    ${S.watchAddError ? `<span class="wl-add-error">${esc(S.watchAddError)}</span>` : ""}
  </form>`;
}

// 筛选/排序：对服务端已排好紧急度的 cards 做前端切片，不重新打后端。
function applyWatchView(cards) {
  let out = cards;
  if (S.watchFilter === "hk") out = out.filter((c) => c.market === "HK");
  else if (S.watchFilter === "us") out = out.filter((c) => c.market === "US");
  else if (S.watchFilter === "held") out = out.filter((c) => c.held);
  else if (S.watchFilter === "risk") out = out.filter((c) => c.status === "falsified" || c.status === "at_risk");
  if (S.watchSort === "change") {
    out = [...out].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
  } else if (S.watchSort === "name") {
    out = [...out].sort((a, b) => String(a.companyName).localeCompare(String(b.companyName), "zh"));
  }
  return out;
}

const WATCH_FILTERS = [
  ["all", "全部"], ["hk", "港股"], ["us", "美股"], ["held", "持仓"], ["risk", "预警"]
];
const WATCH_SORTS = [["urgency", "紧急度"], ["change", "涨跌"], ["name", "名称"]];

function renderWatchControls(cards) {
  const riskCount = cards.filter((c) => c.status !== "intact").length;
  const filters = WATCH_FILTERS.map(([v, label]) => {
    const n = v === "risk" && riskCount ? ` ${riskCount}` : "";
    return `<button type="button" class="wl-seg ${S.watchFilter === v ? "is-on" : ""}" data-action="watch-filter" data-v="${v}">${label}${n}</button>`;
  }).join("");
  const sorts = WATCH_SORTS.map(([v, label]) =>
    `<button type="button" class="wl-seg ${S.watchSort === v ? "is-on" : ""}" data-action="watch-sort" data-v="${v}">${label}</button>`
  ).join("");
  return `<div class="wl-controls">
    <div class="wl-seggroup" role="group" aria-label="筛选">${filters}</div>
    <div class="wl-seggroup wl-sorts" role="group" aria-label="排序"><span class="wl-seglabel">排序</span>${sorts}</div>
  </div>`;
}

function renderWatchList(desk, { heading = "" } = {}) {
  const cards = Array.isArray(desk.cards) ? desk.cards : [];
  const counts = desk.counts || {};
  const bits = [];
  if (counts.falsified) bits.push(`<span class="wd-count wd-falsified">${counts.falsified} 已触发证伪</span>`);
  if (counts.atRisk) bits.push(`<span class="wd-count wd-risk">${counts.atRisk} 有风险</span>`);
  bits.push(`<span class="wd-count wd-intact">${counts.intact || 0} 逻辑还在</span>`);

  // 概览条：状态计数 + 今日红绿家数 + 数据时间 + 手动刷新（专业盘面的"仪表行"）。
  const ups = cards.filter((c) => typeof c.changePct === "number" && c.changePct > 0.0001).length;
  const downs = cards.filter((c) => typeof c.changePct === "number" && c.changePct < -0.0001).length;
  const at = desk.generatedAt ? new Date(desk.generatedAt) : null;
  const timeText = at && !Number.isNaN(at.getTime())
    ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")} 更新`
    : "";

  const visible = applyWatchView(cards);
  const emptyAfterFilter = cards.length && !visible.length
    ? `<div class="wl-filter-empty">这个筛选下没有公司。<button type="button" class="wl-linkbtn" data-action="watch-filter" data-v="all">看全部</button></div>`
    : "";

  return `<div class="watchdesk">
    <div class="wd-head">
      <div>
        <p class="hero-eyebrow"><span class="hero-spark"></span>看盘${desk.partial ? `<span class="wd-partial">事件补全中…</span>` : ""}</p>
        <h2 class="wd-title">${esc(heading || `你在盯的 ${counts.total || cards.length} 家公司`)}</h2>
      </div>
      <div class="wd-summary">
        <button class="wd-portfolio-link" type="button" data-action="portfolio-view">我的持仓</button>
        <button class="wd-portfolio-link wl-add-btn" type="button" data-action="watch-add-open">＋ 添加</button>
      </div>
    </div>
    <div class="wd-overview">
      ${bits.join("")}
      <span class="wdo-sep" aria-hidden="true"></span>
      <span class="wdo-updn">${ups || downs ? `<b class="is-up">↑ ${ups}</b><b class="is-down">↓ ${downs}</b>` : `<span class="wdo-quiet">今日行情加载中</span>`}</span>
      <span class="wdo-right">
        ${timeText ? `<span class="wdo-time">${timeText}</span>` : ""}
        <button class="wdo-refresh ${S.wdRefreshing ? "is-busy" : ""}" type="button" data-action="watch-refresh" title="刷新看盘" aria-label="刷新看盘">${WD_REFRESH}</button>
      </span>
    </div>
    ${S.watchAddOpen ? `<div class="wl-addbar">${renderWatchAddForm()}</div>` : ""}
    ${cards.length > 1 ? renderWatchControls(cards) : ""}
    <div class="wl-list">${renderWatchColumns()}${visible.map(renderWatchRow).join("")}${emptyAfterFilter}</div>
  </div>`;
}

// 关注列表为空（新用户，零研究零持仓）时的引导卡：去研究，或直接手动添加代码。
function renderWatchEmptyCta() {
  return `<div class="wd-empty-cta">
    <p class="hero-eyebrow"><span class="hero-spark"></span>看盘</p>
    <h2>还没有可盯的公司</h2>
    <p>完成一轮研究，或记一笔持仓，公司就会自动出现在这里，跟踪它的画像、事件、涨跌和价格曲线。</p>
    <a class="primary" href="#/research">去研究一家公司</a>
    <div class="wl-empty-add">${S.watchAddOpen ? renderWatchAddForm() : `<button class="wl-linkbtn" type="button" data-action="watch-add-open">或直接添加代码关注 →</button>`}</div>
  </div>`;
}

// ── 看盘：无 ticker → 关注列表；有 ticker → 公司页 ──
export function renderWatchPage() {
  const ticker = routeTicker();
  if (!ticker) {
    shell(`<div class="page-wide">${renderWatchListBody()}</div>`);
    return;
  }
  if (S.watchStockTicker !== ticker && !S.watchStockLoading) void loadWatchStock(ticker);
  shell(`<div class="page-wide">${renderStockPage(ticker)}</div>`);
}

function renderWatchListBody() {
  if (S.watchDesk && Array.isArray(S.watchDesk.cards) && S.watchDesk.cards.length) {
    return renderWatchList(S.watchDesk, { heading: `${S.watchDesk.counts?.total || S.watchDesk.cards.length} 只关注中的股票` });
  }
  if (!S.watchDeskLoaded) return `<div class="wd-loading">正在加载看盘…</div>`;
  return renderWatchEmptyCta();
}

export async function loadWatchStock(ticker) {
  if (!ticker) return;
  const seq = ++S.watchStockSeq;
  S.watchStockLoading = true;
  S.watchStockTicker = ticker;
  S.watchStock = null;
  S.chartRange = "3m"; // 每次打开新公司回到默认区间
  S.stockTab = "overview"; // 换公司回到总览，画像缓存作废
  S.stockPortrait = null;
  S.stockPortraitLoading = false;
  try {
    const data = await api(`/api/watch/stock?ticker=${encodeURIComponent(ticker)}`);
    if (seq === S.watchStockSeq) S.watchStock = data.stock || null;
  } catch {
    if (seq === S.watchStockSeq) S.watchStock = null;
  } finally {
    // 只有最新一次加载才负责收尾（清 loading）；被取代的旧加载直接作废，不会卡死。
    if (seq === S.watchStockSeq) S.watchStockLoading = false;
    render();
  }
}

// 重算列表顶部的状态计数（乐观增删后本地对齐，等后台刷新再校准）。
function recountDesk() {
  if (!S.watchDesk || !Array.isArray(S.watchDesk.cards)) return;
  const cards = S.watchDesk.cards;
  S.watchDesk.counts = {
    falsified: cards.filter((c) => c.status === "falsified").length,
    atRisk: cards.filter((c) => c.status === "at_risk").length,
    intact: cards.filter((c) => c.status === "intact").length,
    total: cards.length
  };
}

// 添加关注：复用研究页的 resolveCompany（名/代码/双重上市都能解），解出 ticker 再 track。
// 整盘刷新慢（要重建所有卡的行情/事件），所以乐观插一张最小卡立即可见，后台再补齐。
export async function addWatch(q) {
  if (!q || S.watchAddBusy) return;
  S.watchAddBusy = true; S.watchAddError = ""; render();
  try {
    const company = await resolveCompany(q, { verify: true });
    const ticker = company && company.ticker;
    if (ticker) {
      await api("/api/watch/track", { method: "POST", body: JSON.stringify({ ticker, name: company.nameZh || ticker }) });
      S.watchAddOpen = false; S.watchAddError = ""; S.watchAddBusy = false;
      if (S.watchDesk && Array.isArray(S.watchDesk.cards) && !S.watchDesk.cards.some((c) => c.ticker === ticker)) {
        const market = /\.HK$/i.test(ticker) || /^\d{3,5}$/.test(ticker) ? "HK" : "US";
        S.watchDesk.cards.unshift({ ticker, companyName: company.nameZh || ticker, market, status: "intact", priceStatus: "loading", held: false });
        recountDesk();
      }
      render();
      void refreshWatchDesk().then(render); // 后台对账，不阻塞
      return;
    }
    S.watchAddError = company && company.unsupported
      ? `${company.name || q} 看起来是 A 股，目前只支持港股 / 美股`
      : `没识别出「${q}」，换个代码试试，如 AAPL、0700.HK`;
  } catch {
    S.watchAddError = "添加失败，请重试";
  }
  S.watchAddBusy = false; render();
  if (S.watchAddOpen) /** @type {HTMLElement|null} */ (document.querySelector(".wl-add input"))?.focus();
}

// 移出关注：乐观先本地摘掉这行立即重渲染（别等慢吞吞的整盘刷新），再后台 untrack + 对账。
export async function removeWatch(ticker) {
  if (!ticker) return;
  if (S.watchDesk && Array.isArray(S.watchDesk.cards)) {
    S.watchDesk.cards = S.watchDesk.cards.filter((c) => c.ticker !== ticker);
    recountDesk();
    render();
  }
  try {
    await api("/api/watch/untrack", { method: "POST", body: JSON.stringify({ ticker }) });
  } catch { /* 失败下次刷新自愈 */ }
  void refreshWatchDesk().then(render);
}

function renderStockPage(ticker) {
  if (S.watchStockTicker !== ticker || S.watchStockLoading) return renderStockSkeleton(ticker);
  if (!S.watchStock) return renderStockError(ticker);
  return renderStockDetail(S.watchStock);
}

function renderStockSkeleton(ticker) {
  return `<div class="stock-page">
    <a class="back-link" href="#/watch">← 看盘</a>
    <div class="wd-loading">正在加载 ${esc(ticker)}…</div>
  </div>`;
}

function renderStockError(ticker) {
  return `<div class="stock-page">
    <a class="back-link" href="#/watch">← 看盘</a>
    <div class="wd-loading">暂时无法加载 ${esc(ticker)} 的数据。</div>
  </div>`;
}

const STOCK_ICONS = {
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.2"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19V10M12 19V5M19 19v-6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 2.5 20h19Z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9.5h8M8 13h8M8 16h5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>'
};

function stockIcon(name) {
  return `<span class="stock-ico">${STOCK_ICONS[name] || ""}</span>`;
}

function fundamentalCell(label, value, suffix = "") {
  return `<div class="sf-cell"><span class="sf-label">${esc(label)}</span><span class="sf-value">${value == null ? "—" : `${esc(value)}${suffix}`}</span></div>`;
}

function stockEventRow(e) {
  const sev = e.severity === "high" ? "sev-high" : e.severity === "medium" ? "sev-med" : "sev-low";
  const when = wdWhen(e.date);
  const title = String(e.title || "").replace(/[[\]]/g, "");
  const inner = `<span class="wd-dot ${sev}"></span><span class="wd-evt-title">${esc(title)}</span>${when ? `<span class="wd-evt-when">${esc(when)}</span>` : ""}`;
  return e.url ? `<a class="stock-event-row" href="${esc(e.url)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="stock-event-row">${inner}</span>`;
}

// ── 价格曲线（公司页真曲线：美股收盘价面积/折线；港股预留）──
// 收盘价序列 → SVG path。viewBox 640×168，svg width:100%/height:auto 等比缩放。
function buildChartPaths(pts, W, H) {
  const top = 8;
  const bot = H - 8;
  const drawH = bot - top;
  const closes = pts.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = (max - min) || 1;
  const n = pts.length;
  const xy = pts.map((p, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * W;
    const y = bot - ((p.close - min) / span) * drawH;
    return [x, y];
  });
  const line = "M" + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const area = `${line} L${W},${bot} L0,${bot} Z`;
  const first = closes[0];
  const last = closes[n - 1];
  return { line, area, dotX: xy[n - 1][0], dotY: xy[n - 1][1], up: last >= first, retPct: ((last - first) / first) * 100 };
}

const CHART_RANGES = { "1m": 21, "3m": 63, "1y": 252 };

function renderPriceChart(series) {
  const wrap = (inner) => `<div class="pchart">${inner}</div>`;
  if (!series || series.providerStatus !== "ok" || !Array.isArray(series.points) || series.points.length < 2) {
    return wrap(`<div class="pchart-empty">${stockIcon("chart")}<span>行情曲线暂不可用</span></div>`);
  }
  const n = CHART_RANGES[S.chartRange] || CHART_RANGES["3m"];
  const pts = series.points.slice(-n);
  const chart = buildChartPaths(pts, 640, 168);
  const col = chart.up ? "#1c8c4a" : "var(--danger)";
  const fill = chart.up ? "rgba(28,140,74,0.1)" : "rgba(255,59,48,0.09)";
  const ret = `${chart.up ? "+" : "−"}${Math.abs(chart.retPct).toFixed(1)}%`;
  const btns = [["1m", "1月"], ["3m", "3月"], ["1y", "1年"]]
    .map(([k, l]) => `<button class="pc-btn ${S.chartRange === k ? "is-active" : ""}" type="button" data-action="chart-range" data-range="${k}">${l}</button>`)
    .join("");
  return wrap(`
    <div class="pchart-head">
      <span class="pc-range">${btns}</span>
      <span class="pc-ret" style="color:${col}">${ret} · 区间</span>
      <span class="pc-meta">日线 · 收盘价 · ${esc(pts[pts.length - 1].date)}</span>
    </div>
    <svg viewBox="0 0 640 168" role="img" aria-label="价格走势曲线">
      <path d="${chart.area}" fill="${fill}" stroke="none"/>
      <path d="${chart.line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${chart.dotX.toFixed(1)}" cy="${chart.dotY.toFixed(1)}" r="3" fill="${col}"/>
    </svg>`);
}

function renderStockDetail(stock) {
  const st = WD_STATUS[stock.status] || WD_STATUS.intact;
  const mkt = stock.market === "US" ? `<span class="ex-badge us">美股</span>` : `<span class="ex-badge hk">港股</span>`;
  const chg = wdChg(stock.changePct);

  const priceBlock = stock.priceStatus === "ok" && stock.price != null
    ? `<div class="stock-price-row">
        <span class="stock-price">${fmtNum(stock.price)}</span>
        <span class="stock-ccy">${esc(stock.currency)}</span>
        ${chg ? `<span class="stock-chg ${chg.dir}">${chg.text}</span>` : ""}
        ${stock.held && typeof stock.returnPct === "number" ? `<span class="stock-pnl">持有 <b class="${pnlDir(stock.returnPct)}">${fmtPct(stock.returnPct)}</b></span>` : ""}
      </div>`
    : `<div class="stock-price-row"><span class="wd-noquote">现价暂不可用</span></div>`;

  const earningsLine = stock.earnings?.nextDate
    ? `<div class="wl-earnings stock-earnings">下一业绩日 · ${esc(stock.earnings.nextDate)}</div>`
    : "";

  const note = stock.status === "falsified" && stock.statusReason
    ? `<div class="wd-note stock-note">${esc(stock.statusReason)}</div>`
    : "";

  const p = stock.profile;
  const cleanThesis = p?.thesis && !WL_BAD_THESIS.test(p.thesis) ? p.thesis : "";
  const researchCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("target")}投资主线</div>
    ${cleanThesis ? `<p class="stock-card-body stock-thesis">${esc(cleanThesis)}</p>` : `<p class="stock-card-body is-empty">还没有沉淀投资主线 · 点「深入研究」建立</p>`}
    ${p?.researchStatus || p?.confidence ? `<div class="stock-tags">
      ${p.researchStatus ? `<span class="stock-tag">研究状态 · ${esc(RS_LABEL[p.researchStatus] || p.researchStatus)}</span>` : ""}
      ${p.confidence ? `<span class="stock-tag">置信度 · ${esc(p.confidence)}</span>` : ""}
      ${p.turnCount ? `<span class="stock-tag">已研究 ${p.turnCount} 轮</span>` : ""}
    </div>` : ""}
  </div>`;

  const fu = stock.fundamentals;
  const fundamentalsCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("bars")}基本面</div>
    ${fu?.status === "ok"
      ? `<div class="sf-grid">
          ${fundamentalCell("市盈率 TTM", fu.pe != null ? fu.pe.toFixed(1) : null)}
          ${fundamentalCell("营收增速", fu.revenueGrowth != null ? fu.revenueGrowth.toFixed(1) : null, "%")}
          ${fundamentalCell("毛利率", fu.grossMargin != null ? fu.grossMargin.toFixed(1) : null, "%")}
          ${fundamentalCell("自由现金流", fu.freeCashFlow != null ? fmtNum(fu.freeCashFlow / 1e8, 1) : null, fu.freeCashFlow != null ? ` 亿${esc(fu.currency)}` : "")}
        </div>`
      : `<p class="stock-card-body is-empty">数据源暂不可用</p>`}
  </div>`;

  // 证伪条件 + 自动监控（UX-7 闭环）：价格类条件已解析成规则的，条目上挂实时监控芯片
  // （已命中 / 距触发 x%），命中会进通知中心；叙述性条件保持纯文本。
  const falsifiers = Array.isArray(p?.falsifiers) ? p.falsifiers : [];
  const rules = Array.isArray(stock.watchRules) ? stock.watchRules : [];
  const ruleByLabel = new Map(rules.map((r) => [r.label, r]));
  const monitoredCount = rules.filter((r) => r.sane !== false).length;
  const falsifierLine = (f) => {
    const r = ruleByLabel.get(f);
    if (!r || r.sane === false) return `<li>${esc(f)}</li>`;
    const chip = r.triggered
      ? `<span class="fw-chip fw-hit">已命中</span>`
      : `<span class="fw-chip fw-watch">监控中${r.distancePct != null && r.distancePct > 0 ? ` · 距触发 ${r.distancePct}%` : ""}</span>`;
    return `<li class="${r.triggered ? "fw-line-hit" : ""}">${esc(f)} ${chip}</li>`;
  };
  const falsifiersCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("alert")}证伪条件${monitoredCount ? `<span class="fw-count">${monitoredCount} 条自动盯盘</span>` : ""}</div>
    ${falsifiers.length
      ? `<ul class="stock-list">${falsifiers.map(falsifierLine).join("")}</ul>
         ${monitoredCount ? `<p class="fw-note">价格类条件每 30 分钟自动核对，命中会进通知中心。</p>` : ""}`
      : `<p class="stock-card-body is-empty">还没有沉淀证伪条件——研究时问"什么情况会证伪？"，结论会自动挂到这里并盯盘。</p>`}
  </div>`;

  const events = Array.isArray(stock.events) ? stock.events : [];
  const eventsCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("news")}近期事件</div>
    ${events.length
      ? `<div class="stock-events">${events.map(stockEventRow).join("")}</div>`
      : `<p class="stock-card-body is-empty">近期暂无重大事件</p>`}
  </div>`;

  const tabs = `<div class="stock-tabs" role="tablist">
    <button class="stock-tab ${S.stockTab === "overview" ? "is-active" : ""}" type="button" data-action="stock-tab" data-tab="overview">总览</button>
    <button class="stock-tab ${S.stockTab === "portrait" ? "is-active" : ""}" type="button" data-action="stock-tab" data-tab="portrait">画像</button>
  </div>`;

  // 总览双栏：左＝价格曲线 + 近期事件（时间维度）；右＝主线/证伪/基本面（判断维度）。
  const body = S.stockTab === "portrait"
    ? renderPortraitTab(stock)
    : `<div class="stock-cols">
        <div class="stock-col-main">${renderPriceChart(stock.series)}${eventsCard}</div>
        <div class="stock-col-side">${researchCard}${falsifiersCard}${fundamentalsCard}</div>
      </div>`;

  return `<div class="stock-page">
    <a class="back-link" href="#/watch">← 看盘</a>
    <div class="stock-head">
      <div>
        <div class="stock-title-row">
          <span class="stock-name">${esc(stock.companyName)}</span>
          <span class="stock-ticker">${esc(stock.ticker)}</span>
          ${mkt}
          <span class="wd-status ${st.cls}">${st.label}</span>
        </div>
        ${priceBlock}
        ${earningsLine}
      </div>
      <button class="primary" type="button" data-action="return-company" data-ticker="${esc(stock.ticker)}" data-name="${esc(stock.companyName)}">深入研究</button>
    </div>
    ${note}
    ${tabs}
    ${body}
  </div>`;
}

// ── P4 画像 Tab：主档案（markdown 渲染）+ 判断变化时间线 + 导出 ──
async function loadStockPortrait(ticker) {
  if (!ticker || S.stockPortraitLoading) return;
  S.stockPortraitLoading = true;
  try {
    const data = await api(`/api/company/profile?ticker=${encodeURIComponent(ticker)}`);
    S.stockPortrait = { profile: data.profile || null, markdown: data.markdown || "" };
  } catch {
    S.stockPortrait = { profile: null, markdown: "" };
  } finally {
    S.stockPortraitLoading = false;
    render();
  }
}

const PORTRAIT_KIND = {
  created: { label: "建档", cls: "pk-created" },
  thesis_change: { label: "判断变化", cls: "pk-change" },
  falsifier_change: { label: "证伪线更新", cls: "pk-falsifier" },
  note: { label: "记录", cls: "pk-note" }
};

function renderPortraitEvent(e) {
  const kind = PORTRAIT_KIND[e.kind] || PORTRAIT_KIND.note;
  const evidence = (Array.isArray(e.evidence) ? e.evidence : [])
    .filter((ev) => ev && ev.url)
    .map((ev) => `<a class="pt-evidence" href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.title || "来源")}</a>`)
    .join("");
  return `<li class="pt-event">
    <div class="pt-event-head">
      <span class="pt-date">${esc(e.date || "—")}</span>
      <span class="pt-kind ${kind.cls}">${kind.label}</span>
      ${e.sessionId ? `<button class="pt-session" type="button" data-action="load-session" data-id="${esc(e.sessionId)}">查看当轮研究 →</button>` : ""}
    </div>
    <p class="pt-summary">${esc(e.summary || "")}</p>
    ${e.rationale ? `<p class="pt-rationale">理由：${esc(e.rationale)}</p>` : ""}
    ${evidence ? `<div class="pt-evidence-row">${evidence}</div>` : ""}
  </li>`;
}

// 主档案渲染用文档部分（时间线单独渲染更好读），导出仍是完整 markdown。
function portraitDocHtml(markdown = "") {
  const doc = markdown
    .replace(/^---[\s\S]*?---\s*/, "") // 去 frontmatter
    .split(/\n## 判断变化时间线/)[0];
  return markdownToHtml(doc);
}

function renderPortraitTab(stock) {
  if (!S.stockPortrait) {
    if (!S.stockPortraitLoading) void loadStockPortrait(stock.ticker);
    return `<div class="wd-loading">正在读取画像…</div>`;
  }
  const p = S.stockPortrait.profile;
  if (!p || (!p.thesis && !(p.events || []).length)) {
    return `<div class="portrait-empty">
      <p>还没有长期画像。完成一轮研究，投资主线、证伪条件和判断变化会自动沉淀到这里。</p>
      <button class="primary" type="button" data-action="return-company" data-ticker="${esc(stock.ticker)}" data-name="${esc(stock.companyName)}">去研究一轮</button>
    </div>`;
  }
  const events = Array.isArray(p.events) ? [...p.events].reverse() : [];
  return `<div class="portrait-pane">
    <div class="portrait-bar">
      <span class="portrait-meta">研究 ${p.turnCount || 0} 轮 · 更新于 ${esc((p.updatedAt || "").slice(0, 10))}</span>
      <button class="wl-linkbtn" type="button" data-action="export-portrait">导出 Markdown ↓</button>
    </div>
    <div class="portrait-doc">${portraitDocHtml(S.stockPortrait.markdown)}</div>
    <div class="portrait-timeline">
      <h3>判断变化时间线</h3>
      ${events.length
        ? `<ul class="pt-list">${events.map(renderPortraitEvent).join("")}</ul>`
        : `<p class="stock-card-body is-empty">还没有判断变化——画像只记"观点变了"的时刻，不记流水账。</p>`}
    </div>
  </div>`;
}

export function exportPortrait() {
  if (!S.stockPortrait?.markdown) {
    toast("画像还没加载好。");
    return;
  }
  const ticker = S.stockPortrait.profile?.ticker || S.watchStockTicker || "echo";
  const blob = new Blob([S.stockPortrait.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${ticker.replace(/[^\w.-]/g, "")}-portrait.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("已导出画像 Markdown。");
}
