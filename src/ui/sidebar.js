// ── 全局侧栏：当前研究快照 + 会话分组历史（EA-5.2：从"研究页专属"提升为跨
// 研究/看盘的全局导航——在看盘台也能看到在研公司、跳回任意历史对话）。
import { S, running, getCompany, getPanel, getThread, getSessionId } from "./state.js";
import { esc, marketLabelOf, isNum, fmtSigned, dirClass, fmtPct, pnlDir } from "./format.js";

// desk-head 副标题：永远给可读信息，绝不显示占位的"待补充"。优先市场标签，
// 再补真实行业（排除"美股/港股/待补充"这类占位）。
const PLACEHOLDER_INDUSTRY = new Set(["美股", "港股", "待补充", "待定", ""]);
function companySubtitle(company) {
  if (!company) return "问一句就开始，复杂研究再沉到底层。";
  const mkt = marketLabelOf(company.ticker);
  const ind = company.industry || company.sector || "";
  const realInd = PLACEHOLDER_INDUSTRY.has(ind) ? "" : ind;
  return [mkt, realInd].filter(Boolean).join(" · ") || mkt || company.ticker || "美股";
}

function renderSnapshotCard(company, panel, thread) {
  const name = panel?.companyName || company?.nameZh || "未选择公司";
  const ticker = company?.ticker || panel?.ticker || "";
  const marketLabel = marketLabelOf(ticker);
  const confLevel = panel?.confidence === "高" ? "high" : panel?.confidence === "低" ? "low" : "mid";
  const confTitle = panel?.confidenceNote ? ` title="${esc(panel.confidenceNote)}"` : "";
  const confChip = panel?.confidence
    ? `<span class="conf conf-${confLevel}"${confTitle}>置信度 ${esc(panel.confidence)}${panel.confidenceNote ? " ⓘ" : ""}</span>`
    : "";

  // ② 对话化侧栏：从最近一条带多标的的回答里取"本轮聚焦"，把"研究公司（单一）"软化为"本轮聚焦（1/N）"。
  const focusOthers = (() => {
    if (!Array.isArray(thread)) return [];
    for (let i = thread.length - 1; i >= 0; i--) {
      const m = thread[i];
      if (m?.role === "assistant" && Array.isArray(m.meta?.otherHoldings) && m.meta.otherHoldings.length) return m.meta.otherHoldings;
    }
    return [];
  })();
  const focusLabel = focusOthers.length ? "本轮聚焦" : "研究公司";
  const focusChips = focusOthers.length
    ? `<div class="focus-mini">
        <span class="fm-chip fm-main">${esc(ticker || name)}</span>
        ${focusOthers.map((h) => {
          const pnl = isNum(h.pnlPct) ? ` <em class="${dirClass(h.pnlPct)}">${fmtSigned(h.pnlPct)}</em>` : "";
          return `<span class="fm-chip">${esc(h.ticker || h.name)}${pnl}</span>`;
        }).join("")}
      </div>`
    : "";

  const priceRaw = panel?.price?.value && panel.price.value !== "暂不可用" ? String(panel.price.value) : "";
  const [priceNum, ...ccyParts] = priceRaw.split(" ");
  const ccy = ccyParts.join(" ");
  const changeRaw = panel?.price?.change && panel.price.change !== "暂不可用" ? String(panel.price.change) : "";
  const chgNum = parseFloat(changeRaw);
  const chgDir = !changeRaw || Number.isNaN(chgNum) ? "is-flat" : chgNum > 0 ? "is-up" : chgNum < 0 ? "is-down" : "is-flat";
  const chgText = changeRaw ? (chgNum > 0 && !changeRaw.startsWith("+") ? `+${changeRaw}` : changeRaw) : "";

  const metricValue = (metricName) => {
    const found = (panel?.metrics || []).find((item) => item.name === metricName);
    const value = found?.value;
    return value && value !== "暂不可用" ? String(value) : "";
  };
  const pe = metricValue("PE");
  const cap = metricValue("市值");
  // 区间回报（近1月/年初至今）——美股可得，港股缺则不显示。带涨跌色。
  const ranges = panel?.price?.ranges || null;
  const pctChip = (label, pct) => {
    if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return "";
    const n = Number(pct);
    const dir = n > 0 ? "is-up" : n < 0 ? "is-down" : "is-flat";
    return `<div class="snapshot-metric"><span>${label}</span><strong class="rng ${dir}">${n > 0 ? "+" : ""}${n}%</strong></div>`;
  };
  const rangeChips = ranges ? `${pctChip("近1月", ranges.oneMonthPct)}${pctChip("年初至今", ranges.ytdPct)}` : "";

  const quoteBlock = priceNum
    ? `<div class="snapshot-quote">
        <span class="price">${esc(priceNum)}</span>${ccy ? `<span class="ccy">${esc(ccy)}</span>` : ""}
        ${chgText ? `<span class="chg ${chgDir}">${esc(chgText)}</span>` : ""}
      </div>`
    : "";

  const metricChips = (pe || cap || rangeChips)
    ? `<div class="snapshot-metrics">
        ${pe ? `<div class="snapshot-metric"><span>TTM PE</span><strong>${esc(pe)}</strong></div>` : ""}
        ${cap ? `<div class="snapshot-metric"><span>市值</span><strong>${esc(cap)}</strong></div>` : ""}
        ${rangeChips}
      </div>`
    : "";

  const dual = company?.dualListing;
  // 智能默认：基本面/估值始终走美股 ADR（数据全）；用户问的若是港股代码，则点明盈亏按港股口径。
  const askedHk = !!(dual && dual.asked && /\.HK$/i.test(dual.asked));
  const dualNote = dual
    ? `<div class="snapshot-dual" title="同一家公司在港股和美股双重上市；FMP 免费档只覆盖美股 ADR，所以基本面与估值统一按美股口径。${askedHk ? "你问的是港股，盈亏请按港股价 + HKD 成本算。" : "行情两地可分别查。"}">
        <span class="dual-badge">双重上市</span>
        <span class="dual-text">港股 ${esc(dual.hk)}｜美股 ${esc(dual.us)} · 基本面按美股 ADR 口径${askedHk ? "；你问港股 → 盈亏按港股口径" : ""}</span>
      </div>`
    : "";

  return `<section class="research-snapshot">
    <div class="snapshot-head">
      <div class="snapshot-id">
        <p>${focusLabel}</p>
        <h2>${esc(name)}</h2>
        <span>${ticker ? `${esc(ticker)}${marketLabel ? ` · ${marketLabel}` : ""}` : "输入公司名、港股或美股代码"}</span>
      </div>
      ${confChip}
    </div>
    ${focusChips}
    ${dualNote}
    ${quoteBlock}
    ${metricChips}
  </section>`;
}

// EA-5.1：会话分组——同一次连续对话里换过的每家公司共享一个 conversationId，
// 侧栏按组显示（组名 = 这次对话最早那句问题），组内按研究顺序列出途经的每家公司。
// 单公司的对话（组内只有一条）就退化成原来的单行展示，不引入视觉噪音。
function groupSessionsForSidebar() {
  const groups = new Map();
  for (const session of S.recentSessions) {
    const gid = session.conversationId || session.id;
    let group = groups.get(gid);
    if (!group) { group = { conversationId: gid, sessions: [] }; groups.set(gid, group); }
    group.sessions.push(session);
  }
  return [...groups.values()];
}

// P7：搜索框永远渲染在展开的历史面板顶部；查询串非空时下面整个区域切换成扁平搜索结果，
// 不再显示分组列表——避免"搜索结果"和"全部历史"两套列表同时出现造成混淆。
function renderHistorySearchBox() {
  return `<div class="history-search">
    <input type="search" class="history-search-input" placeholder="搜索历史研究…（至少3个字）" value="${esc(S.historySearchQuery)}" />
    ${S.historySearchQuery ? `<button type="button" class="history-search-clear" data-action="clear-history-search" aria-label="清除搜索">×</button>` : ""}
  </div>`;
}

// 后端 snippet 用 / 当高亮定界符占位符（不是字面 <b> 标签），这里先对整段
// 转义、再把占位符换回真正的 <b>/</b>——命中片段摘自用户问题/模型正文，可能含 `<`/`>`
// 之类字符，顺序反过来（先替换标签再转义）会把这些原始字符也一起转义掉/或让原始内容
// 被当成标签注入页面（存储型 XSS），必须先转义再替换。
function highlightSnippet(snippet) {
  if (!snippet) return "";
  return esc(snippet).replace(/\u0001/g, "<b>").replace(/\u0002/g, "</b>");
}

function renderSearchResultItem(r, activeSessionId) {
  const active = r.id === activeSessionId;
  const title = r.title || r.companyName || r.ticker || "未命名研究";
  return `<div class="session-item search-result ${active ? "is-active" : ""}">
    <button class="session-open" type="button" data-action="load-session" data-id="${esc(r.id)}">
      <strong>${esc(title)}</strong>
      <span>${esc(r.companyName || r.ticker || "")}</span>
      ${r.snippet ? `<em class="search-snippet">${highlightSnippet(r.snippet)}</em>` : ""}
    </button>
  </div>`;
}

function renderHistorySearchResults(activeSessionId) {
  if (S.historySearchTooShort) return `<div class="history-empty">再多打几个字（至少3个）才能搜索。</div>`;
  if (S.historySearchLoading) return `<div class="history-empty">正在搜索…</div>`;
  if (!S.historySearchResults.length) return `<div class="history-empty">没有匹配的历史研究。</div>`;
  return `<div class="session-list">${S.historySearchResults.map((r) => renderSearchResultItem(r, activeSessionId)).join("")}</div>`;
}

function renderSessionHistory(activeSessionId) {
  const count = S.recentSessions.length;
  const toggle = `<button class="history-toggle ${S.historyOpen ? "is-open" : ""}" type="button" data-action="toggle-history" aria-expanded="${S.historyOpen}">
      <span>历史研究${count ? ` · ${count}` : ""}</span>
      <i>${S.historyOpen ? "收起" : "展开"}</i>
    </button>`;
  if (!S.historyOpen) {
    return `<section class="history-panel collapsed">${toggle}</section>`;
  }
  const searching = !!S.historySearchQuery;
  const groups = groupSessionsForSidebar();
  const body = searching
    ? renderHistorySearchResults(activeSessionId)
    : !S.sessionsLoaded
      ? `<div class="history-empty">正在读取历史...</div>`
      : count
        ? `<div class="session-list">${groups.map((group) => renderConversationGroup(group, activeSessionId)).join("")}</div>`
        : `<div class="history-empty">还没有历史研究。完成第一轮回答后会自动保存。</div>`;
  return `<section class="history-panel">
    ${toggle}
    ${count || searching ? renderHistorySearchBox() : ""}
    ${!searching && count ? `<div class="history-actions"><button type="button" data-action="clear-sessions">清空全部</button></div>` : ""}
    ${body}
  </section>`;
}

function renderConversationGroup(group, activeSessionId) {
  const { sessions } = group;
  if (sessions.length <= 1) return renderSessionItem(sessions[0], activeSessionId);
  const first = sessions[0];
  const groupTitle = first.title || first.question || first.companyName || "新研究";
  const activeInGroup = sessions.some((s) => s.id === activeSessionId);
  return `<div class="conv-group ${activeInGroup ? "is-active-group" : ""}">
    <div class="conv-group-head">
      <strong>${esc(groupTitle)}</strong>
      <span class="conv-count">${sessions.length} 家公司</span>
    </div>
    <div class="conv-companies">${sessions.map((session) => renderSessionItem(session, activeSessionId, true)).join("")}</div>
  </div>`;
}

function renderSessionItem(session, activeSessionId, nested = false) {
  const active = session.id === activeSessionId;
  const title = session.title || session.question || session.companyName || session.ticker || "未命名研究";
  const company = session.companyName || session.company_name || session.ticker || "研究对象";
  const isRunning = running.has(session.id); // 这条会话正在后台生成 → 显示转圈
  return `<div class="session-item ${nested ? "is-nested" : ""} ${active ? "is-active" : ""} ${isRunning ? "is-running" : ""}">
    <button class="session-open" type="button" data-action="load-session" data-id="${esc(session.id)}">
      <strong>${esc(nested ? company : title)}</strong>
      <span>${isRunning ? '<i class="session-spin" aria-hidden="true"></i>正在生成…' : esc(nested ? session.ticker || "" : company)}</span>
    </button>
    ${isRunning ? "" : `<button class="session-delete" type="button" data-action="delete-session" data-id="${esc(session.id)}" aria-label="删除历史研究">×</button>`}
  </div>`;
}

// EA-5.2：全局侧栏——研究/看盘共用同一份导航，跳出研究页也能看当前在研公司、跳回历史对话。
// EA-5.4：上下文面板——当前公司的看盘状态 + 持仓盈亏，一眼看到而不用跳去"看盘"/"持仓"
// 页。数据全部来自已经全局加载的 S.watchDesk（app.js 启动时 refreshWatchDesk，不发新请求），
// 纯读取 + 派生，找不到卡片（还没进看盘，比如研究尚未完成）就不渲染，不留半截空壳。
const CTX_STATUS = {
  falsified: { label: "已触发证伪", cls: "wd-falsified" },
  at_risk: { label: "有风险", cls: "wd-risk" },
  intact: { label: "逻辑还在", cls: "wd-intact" }
};

function renderContextCard(company) {
  if (!company?.ticker) return "";
  const card = S.watchDesk?.cards?.find((c) => c.ticker === company.ticker);
  if (!card) return "";
  const st = CTX_STATUS[card.status] || CTX_STATUS.intact;
  const heldRow = card.held && typeof card.returnPct === "number"
    ? `<div class="context-row"><span>持仓盈亏</span><b class="${pnlDir(card.returnPct)}">${fmtPct(card.returnPct)}</b></div>`
    : `<div class="context-row is-muted"><span>持仓</span><b>未持有</b></div>`;
  return `<section class="context-card">
    <div class="context-row">
      <span>看盘状态</span>
      <span class="wd-status ${st.cls}">${esc(st.label)}</span>
    </div>
    ${heldRow}
  </section>`;
}

export function renderGlobalSidebar() {
  const company = getCompany();
  const panel = getPanel();
  const thread = getThread();
  const activeSessionId = getSessionId();
  return `<aside class="sidebar">
    <button class="primary wide" data-action="new">新建研究</button>
    ${renderSnapshotCard(company, panel, thread)}
    ${renderContextCard(company)}
    ${renderSessionHistory(activeSessionId)}
    <div class="sidebar-tagline"><b>Seek signal. Ignore noise.</b>喧声之外，见真知。研究参考，非投资建议。</div>
  </aside>`;
}

export { companySubtitle };
