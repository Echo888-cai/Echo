// ── 共享渲染组件：估值条 / 分析师 / 接地条 / 证据卡 / 对比表 / 消息卡 ──
import { esc, hostFromUrl, numFrom, credLevel, isNum, fmtMoney, fmtSigned, dirClass } from "./format.js";
import { markdownToHtml, renderRichAnswer } from "./markdown.js";
import { renderPortfolioPanel } from "./portfolio.js";

// Default credibility per source type so even keyless official links get a sensible dot.
const TYPE_CRED_DEFAULT = { official: 0.9, industry_research: 0.82, financial_media: 0.72, cn_financial_media: 0.6, market: 0.7, news: 0.55, web: 0.45 };

/** Build clickable provenance cards from the decision panel's sources (official + web). */
export function provenanceFromPanel(panel) {
  const sources = Array.isArray(panel?.sources) ? panel.sources : [];
  return sources
    .filter((s) => s.url)
    .slice(0, 6)
    .map((s) => ({
      title: s.label || hostFromUrl(s.url) || "来源",
      url: s.url,
      source: hostFromUrl(s.url) || s.type || "web",
      type: s.type || (s.origin === "web_evidence" ? "web" : "official"),
      cred: typeof s.credibility === "number" ? s.credibility : (TYPE_CRED_DEFAULT[s.type] ?? null),
      date: s.timestamp || ""
    }));
}

export function dataSourceLabels(dataSources = {}) {
  const map = { market: "行情", financials: "财报", filings: "公告", news: "新闻", estimates: "预期" };
  return Object.entries(map)
    .filter(([key]) => dataSources?.[key]?.status === "ok")
    .map(([, label]) => label);
}

// 接地条用的逐槽 ✓/✗：固定 4 个核心槽（行情/财报/新闻/预期），公告只在接入时追加，
// 避免美股恒显"公告✗"的噪音。
export function dataSourceGrounding(dataSources = {}) {
  const core = [["market", "行情"], ["financials", "财报"], ["news", "新闻"], ["estimates", "预期"]];
  const slots = core.map(([key, label]) => ({ label, ok: dataSources?.[key]?.status === "ok" }));
  if (dataSources?.filings?.status === "ok") slots.push({ label: "公告", ok: true });
  return slots;
}

const SOURCE_TYPE_LABEL = {
  official: "官方",
  industry_research: "行研",
  financial_media: "财经媒体",
  cn_financial_media: "国内财经",
  market: "行情",
  news: "新闻",
  web: "网页"
};

// A-P1.1：对话内对比的两列并排表。后端 finalizeChat 收口 comparison={left,right}，每家含现价/
// 涨跌/PE/赔率/利润质量/区间回报/目标价。散文保留在表下，让"两家谁更优"一眼可比。
export function renderComparisonTable(comparison) {
  const left = comparison?.left;
  const right = comparison?.right;
  if (!left || !right) return "";
  const fmtNum = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—");
  const fmtPct = (v) => (Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%` : "—");
  const fmtPe = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? `${Number(v).toFixed(1)}x` : "—");
  const fmtOdds = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? `${Number(v).toFixed(1)}:1` : "—");
  const fmtScore = (v) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(0)}/100` : "—");
  // 每行：[标签, 取值函数, 该行"更优"判定（数值越大越优 / 越小越优 / 不判定）]。
  const rows = [
    ["现价", (s) => fmtNum(s.price), null],
    ["今日涨跌", (s) => fmtPct(s.changePct), null],
    ["PE", (s) => fmtPe(s.pe), null],
    ["赔率（回报:风险）", (s) => fmtOdds(s.odds), (s) => (Number.isFinite(s.odds) ? s.odds : -Infinity)],
    ["利润质量", (s) => fmtScore(s.qualityScore), (s) => (Number.isFinite(s.qualityScore) ? s.qualityScore : -Infinity)],
    ["近 1 月", (s) => fmtPct(s.oneMonthPct), (s) => (Number.isFinite(s.oneMonthPct) ? s.oneMonthPct : -Infinity)],
    ["年初至今", (s) => fmtPct(s.ytdPct), (s) => (Number.isFinite(s.ytdPct) ? s.ytdPct : -Infinity)],
    ["目标价", (s) => fmtNum(s.target), null],
    ["较目标上行", (s) => fmtPct(s.upsidePct), (s) => (Number.isFinite(s.upsidePct) ? s.upsidePct : -Infinity)]
  ];
  const cell = (row, side, other) => {
    const better = row[2] && row[2](side) !== row[2](other) && row[2](side) > row[2](other);
    return `<td class="${better ? "cmp-better" : ""}">${row[1](side)}</td>`;
  };
  const body = rows.map((row) => `<tr>
      <th scope="row">${row[0]}</th>
      ${cell(row, left, right)}
      ${cell(row, right, left)}
    </tr>`).join("");
  return `<div class="comparison-block">
    <table class="comparison-table">
      <thead><tr><th></th><th>${esc(left.name || left.ticker || "—")}<span>${esc(left.ticker || "")}</span></th><th>${esc(right.name || right.ticker || "—")}<span>${esc(right.ticker || "")}</span></th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

// ② "本轮聚焦"多卡：会话主标的之外、本轮识别到的每只股各出一张紧凑卡（迷你估值条 + 现价涨跌 +
// 持仓盈亏 + 赔率 + 分析师目标），让"底部一条估值条到底是谁的"不再有歧义——主标的下方走完整判断，
// 其他标的在此一目了然。数据由后端 lightHoldings 收口（各自估值已走 ① 护栏，脏的为 null）。
function miniValBar(v) {
  if (!v) return "";
  const bear = numFrom(v.bear), base = numFrom(v.base), bull = numFrom(v.bull), price = numFrom(v.currentPrice);
  if ([bear, base, bull, price].some((n) => n === null)) return "";
  const lo = Math.min(bear, bull, price), hi = Math.max(bear, bull, price), span = hi - lo || 1;
  const pct = (x) => Math.max(0, Math.min(100, ((x - lo) / span) * 100));
  const zl = Math.min(pct(bear), pct(bull)), zw = Math.abs(pct(bull) - pct(bear));
  return `<div class="fc-valbar" title="看空 ${esc(fmtMoney(bear))} / 中性 ${esc(fmtMoney(base))} / 看多 ${esc(fmtMoney(bull))}，现价 ${esc(fmtMoney(price))}">
      <div class="fc-bar"><div class="fc-zone" style="left:${zl}%;width:${zw}%"></div><div class="fc-pr" style="left:${pct(price)}%"></div></div>
      <div class="fc-scale"><span class="bear">看空 ${esc(fmtMoney(bear))}</span><span class="base">中性 ${esc(fmtMoney(base))}</span><span class="bull">看多 ${esc(fmtMoney(bull))}</span></div>
    </div>`;
}

function focusCard(h) {
  const chg = fmtSigned(h.changePct);
  const chips = [];
  if (isNum(h.shares) && isNum(h.cost)) {
    const pnl = fmtSigned(h.pnlPct);
    chips.push(`<span class="fc-chip">持仓 ${esc(String(h.shares))}股 @ ${esc(fmtMoney(h.cost))}${pnl ? ` · <em class="${dirClass(h.pnlPct)}">${esc(pnl)}</em>` : ""}</span>`);
  }
  if (isNum(h.odds) && Number(h.odds) > 0) chips.push(`<span class="fc-chip">赔率 ${Number(h.odds).toFixed(1)}:1</span>`);
  if (isNum(h.target)) {
    const up = fmtSigned(h.upsidePct);
    chips.push(`<span class="fc-chip">目标 ${esc(fmtMoney(h.target))}${up ? `（${esc(up)}）` : ""}</span>`);
  }
  return `<article class="focus-card">
    <div class="fc-head">
      <b>${esc(h.name || h.ticker)}</b><span>${esc(h.ticker || "")}</span>
      ${isNum(h.price) ? `<strong class="fc-price">${esc(fmtMoney(h.price))}${chg ? ` <em class="${dirClass(h.changePct)}">${esc(chg)}</em>` : ""}</strong>` : ""}
    </div>
    ${h.valuation ? miniValBar(h.valuation) : `<div class="fc-noval">估值数据不足，暂不给可信区间</div>`}
    ${chips.length ? `<div class="fc-chips">${chips.join("")}</div>` : ""}
  </article>`;
}

export function renderFocusStrip(meta) {
  const others = Array.isArray(meta.otherHoldings) ? meta.otherHoldings : [];
  if (!others.length) return "";
  const mainName = meta.valuationName || "主标的";
  return `<div class="focus-strip">
    <div class="focus-head">本轮聚焦 · ${others.length + 1} 家<span>主标的 ${esc(mainName)} 见下方完整判断</span></div>
    <div class="focus-cards">${others.map(focusCard).join("")}</div>
  </div>`;
}

// B2 港美双上市：用户问港股那一边时，单独给一张"港股口径"小卡——港股实时价 + 按 HKD 成本算的
// 精确盈亏。和下方 ADR 口径的估值条并存，明确区分"盈亏看港股、估值看 ADR"，不再用美元价错算港股盈亏。
export function renderDualQuote(dq) {
  if (!dq || !Number.isFinite(Number(dq.price))) return "";
  const chg = fmtSigned(dq.changePct);
  const parts = [`<span class="dq-price">${esc(fmtMoney(dq.price))} <em class="dq-ccy">${esc(dq.currency || "HKD")}</em>${chg ? ` <em class="${dirClass(dq.changePct)}">${esc(chg)}</em>` : ""}</span>`];
  if (Number.isFinite(Number(dq.cost))) {
    const pnl = fmtSigned(dq.pnlPct);
    parts.push(`<span class="dq-pnl">持仓 ${Number.isFinite(Number(dq.shares)) ? `${esc(String(dq.shares))}股 @ ` : ""}${esc(fmtMoney(dq.cost))}${pnl ? ` · 浮动 <em class="${dirClass(dq.pnlPct)}">${esc(pnl)}</em>` : ""}</span>`);
  }
  return `<div class="dual-quote">
    <div class="dq-head">港股口径 · ${esc(dq.ticker)}<span>盈亏按港股价 + HKD 成本；估值/基本面见下方 ADR 口径</span></div>
    <div class="dq-body">${parts.join("")}</div>
  </div>`;
}

// ① 估值被护栏抑制时的诚实占位（绝不画错带子）：说明"数据不足/存疑"，与降级后的置信度一致。
export function renderValuationNote(note) {
  if (!note) return "";
  return `<div class="valuation-block valuation-na">
    <div class="valuation-head"><span>估值区间</span><em>暂不可用</em></div>
    <p class="val-na-text">${esc(note)}</p>
  </div>`;
}

export function renderValuation(valuation, opts = {}) {
  if (!valuation) return "";
  // ② 归属公司名：多公司轮里明确"这条带子是谁的"（单公司轮 name 为空，标题保持"估值区间"）。
  const headLabel = opts.name ? `${esc(opts.name)} · 估值区间` : "估值区间";
  const bear = numFrom(valuation.bear);
  const base = numFrom(valuation.base);
  const bull = numFrom(valuation.bull);
  const price = numFrom(valuation.currentPrice);
  if (bear === null || base === null || bull === null || price === null) return "";
  const lo = Math.min(bear, bull, price);
  const hi = Math.max(bear, bull, price);
  const span = hi - lo || 1;
  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

  // Reward:risk odds from bull upside vs bear downside (robust even for the
  // mechanical PE band where base == price).
  const up = price ? (bull - price) / price : 0;
  const down = price ? (price - bear) / price : 0;
  const odds = down > 0.0001 ? (up / down) : null;
  const oddsText = odds && odds > 0 ? `${odds.toFixed(1)} : 1` : "—";
  // 带符号格式化：stage-aware 的 EV/Sales 带可能整条在现价下方（看多上行为负），不能写成 "+-34%"。
  const upText = `${up >= 0 ? "+" : ""}${(up * 100).toFixed(0)}%`;
  const downText = `${((bear - price) / price * 100).toFixed(0)}%`;
  const zoneLeft = Math.min(pct(bear), pct(bull));
  const zoneWidth = Math.abs(pct(bull) - pct(bear));

  // 多法交叉验证：有多个口径（PE / Forward PE / FCF / DCF）时显式标出，并把关键
  // 假设折叠在"估值依据"里，让"这个区间怎么来的"可追溯，而不是一个孤零零的数字。
  const methods = Array.isArray(valuation.methods) ? valuation.methods.filter(Boolean) : [];
  const assumptions = Array.isArray(valuation.keyAssumptions) ? valuation.keyAssumptions.filter(Boolean).slice(0, 5) : [];
  const methodsLine = methods.length > 1
    ? `<div class="valuation-methods"><span class="vm-label">多法交叉</span>${methods.map((m) => `<span class="vm-tag">${esc(m)}</span>`).join("")}</div>`
    : "";
  // A-P2.1：每种方法各自推出的隐含价（PE法→$X / FCF法→$Y / DCF→$Z；亏损股→EV/Sales 情景），
  // 和关键假设一起放进"估值依据"展开，让区间怎么来的可追溯。兼容 PE 多法与 B-P0 的 EV/Sales 来源。
  const detail = Array.isArray(valuation.methodDetail)
    ? valuation.methodDetail.filter((d) => d && Number.isFinite(Number(d.base)))
    : [];
  const detailRows = detail
    .map((d) => `<li class="vm-detail"><b>${esc(d.name)}</b>：看空 ${esc(fmt(Number(d.bear)))} / 中性 ${esc(fmt(Number(d.base)))} / 看多 ${esc(fmt(Number(d.bull)))}</li>`)
    .join("");
  const assumeCount = detail.length + assumptions.length;
  const assumeLine = assumeCount
    ? `<details class="valuation-assume"><summary>估值依据 · ${assumeCount} 条</summary><ul>${detailRows}${assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>`
    : "";

  return `<div class="valuation-block">
    <div class="valuation-head"><span>${headLabel}</span><em>${esc(valuation.method || "PE 法")}</em></div>
    <div class="valuation-bar">
      <div class="val-zone" style="left:${zoneLeft}%;width:${zoneWidth}%"></div>
      <div class="val-tick bear" style="left:${pct(bear)}%"></div>
      <div class="val-tick base" style="left:${pct(base)}%"></div>
      <div class="val-tick bull" style="left:${pct(bull)}%"></div>
      <div class="val-price" style="left:${pct(price)}%" title="现价 ${esc(fmt(price))}"></div>
    </div>
    <div class="valuation-scale">
      <span class="bear">看空 ${esc(fmt(bear))}</span>
      <span class="base">中性 ${esc(fmt(base))}</span>
      <span class="bull">看多 ${esc(fmt(bull))}</span>
    </div>
    <div class="valuation-stats">
      <span>现价 <b>${esc(fmt(price))}</b></span>
      <span class="pos">看多上行 <b>${esc(upText)}</b></span>
      <span class="neg">看空下行 <b>${esc(downText)}</b></span>
      <span class="odds">赔率 <b>${esc(oddsText)}</b></span>
    </div>
    ${methodsLine}
    ${assumeLine}
  </div>`;
}

// 分析师一致预期：买卖分布条 + 共识方向 + 一致目标价/上行空间。数据由后端
// buildAnalystSummary 收口（Finnhub recommendation 给分布、Yahoo 兜底给目标价）。
// 估值条里不再单独重复目标价——这里是唯一、更完整的"分析师锚"。
export function renderAnalystConsensus(analyst) {
  if (!analyst) return "";
  const dist = analyst.distribution;
  const target = analyst.target != null ? numFrom(analyst.target) : null;
  const hasDist = dist && Number(dist.total) > 0;
  if (!hasDist && target === null) return "";
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

  let bar = "";
  let counts = "";
  if (hasDist) {
    const total = dist.total;
    const buyPct = Math.round((dist.buy / total) * 100);
    const holdPct = Math.round((dist.hold / total) * 100);
    const sellPct = Math.max(0, 100 - buyPct - holdPct);
    bar = `<div class="analyst-bar" role="img" aria-label="买入 ${dist.buy}，持有 ${dist.hold}，卖出 ${dist.sell}">
      ${dist.buy ? `<span class="seg buy" style="width:${buyPct}%"></span>` : ""}
      ${dist.hold ? `<span class="seg hold" style="width:${holdPct}%"></span>` : ""}
      ${dist.sell ? `<span class="seg sell" style="width:${sellPct}%"></span>` : ""}
    </div>`;
    counts = `<div class="analyst-counts">
      <span class="buy">买入 ${dist.buy}</span>
      <span class="hold">持有 ${dist.hold}</span>
      <span class="sell">卖出 ${dist.sell}</span>
    </div>`;
  }

  const tone = analyst.consensus === "偏多" ? "buy" : analyst.consensus === "偏空" ? "sell" : "hold";
  const chips = [];
  if (analyst.consensus) chips.push(`<span class="ac-chip ${tone}">共识 ${esc(analyst.consensus)}</span>`);
  if (target !== null) {
    const up = typeof analyst.upsidePct === "number" ? analyst.upsidePct : null;
    const upTone = up == null ? "" : up > 0 ? "pos" : up < 0 ? "neg" : "";
    const upTxt = up == null ? "" : `<em class="${upTone}">（较现价 ${up > 0 ? "+" : ""}${up}%）</em>`;
    chips.push(`<span class="ac-chip target">目标价 <b>${esc(fmt(target))}</b>${upTxt}</span>`);
    const lo = analyst.targetLow != null ? numFrom(analyst.targetLow) : null;
    const hi = analyst.targetHigh != null ? numFrom(analyst.targetHigh) : null;
    if (lo !== null && hi !== null) chips.push(`<span class="ac-chip">区间 ${esc(fmt(lo))}~${esc(fmt(hi))}</span>`);
  }
  if (typeof analyst.analysts === "number" && analyst.analysts > 0) chips.push(`<span class="ac-chip">${analyst.analysts} 位分析师</span>`);

  return `<div class="analyst-block">
    <div class="analyst-head"><span>分析师一致预期</span>${analyst.source ? `<em>${esc(analyst.source)}</em>` : ""}</div>
    ${bar}${counts}
    ${chips.length ? `<div class="analyst-chips">${chips.join("")}</div>` : ""}
  </div>`;
}

// 数据接地条：每条回答顶部直观标注本轮用到/缺哪些数据槽（行情✓ 财报✓ 新闻✓ 预期✗），
// 把"为什么置信度低"变得可解释——缺口同时挂在完整度上的 title 里。
export function renderGroundingBar(meta = {}) {
  const slots = Array.isArray(meta.grounding) ? meta.grounding : [];
  if (!slots.length) return "";
  const chips = slots
    .map((s) => `<span class="ground-chip ${s.ok ? "ok" : "miss"}">${esc(s.label)}<i>${s.ok ? "✓" : "✗"}</i></span>`)
    .join("");
  const missing = Array.isArray(meta.missing) ? meta.missing.filter(Boolean) : [];
  const comp = typeof meta.completeness === "number"
    ? `<span class="ground-complete" title="${missing.length ? `还缺：${esc(missing.join("、"))}` : "关键数据槽已齐备"}">完整度 ${meta.completeness}%</span>`
    : "";
  return `<div class="grounding-bar">${chips}${comp}</div>`;
}

export function renderEvidenceBlock(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return "";
  const cards = evidence
    .filter((item) => item.url)
    .map(
      (item) => `<a class="evidence-card" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
      <span class="evidence-badge type-${esc(item.type || "web")}">${esc(SOURCE_TYPE_LABEL[item.type] || "网页")}</span>
      <span class="evidence-name">${esc(item.title)}</span>
      <span class="evidence-foot"><i class="cred-dot ${credLevel(item.cred)}"></i>${esc(item.source || "")}${item.date ? ` · ${esc(item.date)}` : ""}</span>
    </a>`
    )
    .join("");
  if (!cards) return "";
  return `<div class="evidence-block">
    <div class="evidence-head">证据来源 · ${evidence.filter((e) => e.url).length}</div>
    <div class="evidence-cards">${cards}</div>
  </div>`;
}

export function renderAnswerMeta(meta = {}) {
  const spans = [];
  if (meta.confidence) {
    const lvl = meta.confidence === "高" ? "high" : meta.confidence === "低" ? "low" : "mid";
    spans.push(`<span class="conf conf-${lvl}">置信度 ${esc(meta.confidence)}</span>`);
  }
  if (meta.mode) spans.push(`<span>${/model/.test(meta.mode) ? "模型生成" : "本地兜底"}</span>`);
  if (typeof meta.webCount === "number") spans.push(`<span>网页证据 ${meta.webCount} 条</span>`);
  if (Array.isArray(meta.sources) && meta.sources.length) spans.push(`<span>数据源：${esc(meta.sources.join("/"))}</span>`);
  return spans.length ? `<div class="answer-meta">${spans.join("")}</div>` : "";
}

export function renderMessage(message) {
  if (message.role === "assistant") {
    const meta = message.meta || {};
    // 切换软分隔：一条细线 + "已从 X 切到 Y"，带"回到 X"退路按钮。
    if (meta.type === "switch-divider" && meta.from && meta.to) {
      return `<div class="switch-divider">
        <span class="switch-line"></span>
        <span class="switch-text">已从 <b>${esc(meta.from.name)}</b> 切到 <b>${esc(meta.to.name)}</b></span>
        <button class="switch-back" type="button" data-action="return-company" data-ticker="${esc(meta.from.ticker)}" data-name="${esc(meta.from.name)}">回到 ${esc(meta.from.name)}</button>
        <span class="switch-line"></span>
      </div>`;
    }
    // 推荐选项消息：检测到对比意图时给用户的选择卡。
    if (meta.type === "choice" && meta.choice) {
      const opts = (meta.choice.options || []).map((o) =>
        `<button class="choice-btn ${o.recommended ? "is-rec" : ""}" type="button" data-action="choice-act" data-act="${esc(o.act)}" data-ticker="${esc(o.ticker || "")}" data-name="${esc(o.name || "")}">
          <span class="choice-label">${esc(o.label)}${o.recommended ? ' <i class="choice-rec">推荐</i>' : ""}</span>
          ${o.hint ? `<span class="choice-hint">${esc(o.hint)}</span>` : ""}
        </button>`
      ).join("");
      return `<article class="message assistant">
        <div class="bubble answer-card choice-card">
          <div class="answer-brand"><div class="answer-mark"><i></i><span>LUVIO</span></div></div>
          <p class="choice-prompt">${esc(meta.choice.prompt)}</p>
          <div class="choice-options">${opts}</div>
        </div>
      </article>`;
    }
    const title = meta.type === "deep_research" ? "DEEP RESEARCH" : meta.type === "portrait" ? "公司画像" : meta.type === "digest" ? "事件提醒" : meta.type === "portfolio" ? "我的持仓" : "LUVIO";
    const messageId = message.id || "";
    const isPortfolio = meta.type === "portfolio";
    return `<article class="message assistant">
      <div class="bubble answer-card">
        <div class="answer-brand">
          <div class="answer-mark"><i></i><span>${title}</span></div>
          ${isPortfolio ? "" : `<button class="copy-answer" type="button" data-action="copy-message" data-id="${esc(messageId)}">复制</button>`}
        </div>
        ${isPortfolio ? "" : renderGroundingBar(meta)}
        ${isPortfolio ? "" : renderComparisonTable(meta.comparison)}
        ${isPortfolio ? "" : renderFocusStrip(meta)}
        ${isPortfolio ? "" : renderDualQuote(meta.dualQuote)}
        ${isPortfolio ? renderPortfolioPanel(meta.positions, meta.review) : renderRichAnswer(message.content)}
        ${renderValuation(meta.valuation, { name: meta.otherHoldings && meta.otherHoldings.length ? meta.valuationName : null })}
        ${meta.valuation ? "" : renderValuationNote(meta.valuationNote)}
        ${renderAnalystConsensus(meta.analyst)}
        ${renderEvidenceBlock(meta.evidence)}
        ${isPortfolio ? "" : renderAnswerMeta(meta)}
      </div>
    </article>`;
  }
  return `<article class="message user">
    <div class="bubble">${markdownToHtml(message.content)}</div>
  </article>`;
}
