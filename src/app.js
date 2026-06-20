const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");

const storeKeys = {
  thread: "luvio.v3.thread",
  company: "luvio.v3.company",
  panel: "luvio.v3.panel",
  documents: "luvio.v3.documents",
  sessionId: "luvio.v3.sessionId"
};

const companyAliases = [
  { pattern: /腾讯控股|腾讯|Tencent/i, ticker: "0700.HK" },
  { pattern: /阿里巴巴|阿里(?!健康|影业)|Alibaba|BABA/i, ticker: "9988.HK" },
  { pattern: /阿里健康/i, ticker: "0241.HK" },
  { pattern: /阿里影业/i, ticker: "1060.HK" },
  { pattern: /美团/i, ticker: "3690.HK" },
  { pattern: /小米/i, ticker: "1810.HK" },
  { pattern: /比亚迪/i, ticker: "1211.HK" },
  { pattern: /京东/i, ticker: "9618.HK" },
  { pattern: /百度/i, ticker: "9888.HK" },
  { pattern: /快手/i, ticker: "1024.HK" },
  { pattern: /网易/i, ticker: "9999.HK" },
  { pattern: /联想/i, ticker: "0992.HK" },
  { pattern: /耐世特/i, ticker: "1316.HK" },
  { pattern: /地平线/i, ticker: "9660.HK" },
  { pattern: /港交所|香港交易所/i, ticker: "0388.HK" }
];

let apiStatus = null;
let isBusy = false;
let busyStartedAt = 0;
let busyLabel = "模型思考中";
let busyTimer = null;
let recentSessions = [];
let sessionsLoaded = false;
let historyOpen = false;

function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clearStore(key) {
  localStorage.removeItem(key);
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add("is-visible");
  clearTimeout(toastNode.timer);
  toastNode.timer = setTimeout(() => toastNode.classList.remove("is-visible"), 2200);
}

function normalizeMessage(message) {
  return {
    ...message,
    id: message.id || uid("msg")
  };
}

function getThread() {
  const thread = readStore(storeKeys.thread, []);
  if (!Array.isArray(thread)) return [];
  const normalized = thread.map(normalizeMessage);
  if (thread.some((message) => !message?.id)) writeStore(storeKeys.thread, normalized);
  return normalized;
}

function setThread(thread) {
  writeStore(storeKeys.thread, thread.slice(-80).map(normalizeMessage));
}

function getCompany() {
  return readStore(storeKeys.company, null);
}

function setCompany(company) {
  writeStore(storeKeys.company, company);
}

function getPanel() {
  return readStore(storeKeys.panel, null);
}

function setPanel(panel) {
  writeStore(storeKeys.panel, panel);
}

function getDocuments() {
  return readStore(storeKeys.documents, []);
}

function setDocuments(documents) {
  writeStore(storeKeys.documents, documents.slice(-12));
}

function getSessionId() {
  return readStore(storeKeys.sessionId, null);
}

function setSessionId(id) {
  if (id) writeStore(storeKeys.sessionId, id);
  else clearStore(storeKeys.sessionId);
}

function busyElapsedSeconds() {
  if (!busyStartedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - busyStartedAt) / 1000));
}

function updateBusyClock() {
  const seconds = String(busyElapsedSeconds());
  document.querySelectorAll("[data-busy-seconds]").forEach((node) => {
    node.textContent = seconds;
  });
  const phase = waitPhase();
  document.querySelectorAll("[data-busy-phase]").forEach((node) => {
    if (node.textContent !== phase) node.textContent = phase;
  });
}

function startBusy(label = "模型思考中") {
  isBusy = true;
  busyLabel = label;
  busyStartedAt = Date.now();
  clearInterval(busyTimer);
  busyTimer = setInterval(updateBusyClock, 1000);
}

function stopBusy() {
  isBusy = false;
  busyStartedAt = 0;
  clearInterval(busyTimer);
  busyTimer = null;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || json?.error?.message || `请求失败 ${response.status}`);
  return json?.ok && json.data ? json.data : json;
}

function linkifyEscaped(text = "") {
  return String(text).replace(/(https?:\/\/[^\s<]+)/g, (match) => {
    const trailing = match.match(/[)，。；、,.!?)]+$/)?.[0] || "";
    const url = match.slice(0, match.length - trailing.length);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
}

function markdownToHtml(markdown = "") {
  const lines = String(markdown).split(/\r?\n/);
  const html = [];
  let inList = false;
  const sectionTitle = /^(简单说|简单结论|拆开看|关键判断|主要风险|主要竞争对手|怎么理解竞争格局|接下来重点看|已抓到的外部信号|结论|事实|推断|估值\s*\/\s*风险|动作|数据缺口|证据缺口|证伪条件|我的判断|来源|深度研究)$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (line.startsWith("### ")) html.push(`<h3>${esc(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) html.push(`<h2>${esc(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) html.push(`<h1>${esc(line.slice(2))}</h1>`);
    else if (sectionTitle.test(line)) html.push(`<h3>${esc(line)}</h3>`);
    else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${linkifyEscaped(esc(line.replace(/^[-*]\s+/, "")))}</li>`);
    } else if (/^\d+[.、]\s+/.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p class="numbered-line">${linkifyEscaped(esc(line))}</p>`);
    } else {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p>${linkifyEscaped(esc(line)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

function extractTicker(text = "") {
  const raw = String(text).toUpperCase();
  const hk = raw.match(/\b(\d{1,5})(?:\.HK|HK)?\b/);
  if (!hk) return "";
  return `${hk[1].padStart(4, "0")}.HK`;
}

function extractAliasTicker(text = "") {
  const hit = companyAliases.find((item) => item.pattern.test(text));
  return hit?.ticker || "";
}

function companySearchCandidates(query = "") {
  const ticker = extractTicker(query);
  const aliasTicker = extractAliasTicker(query);
  const cleaned = String(query)
    .replace(/[？?！!，,。；;：:]/g, " ")
    .replace(/最近|怎么样|怎么|分析|看看|帮我|一下|护城河|赚钱|不赚钱|主要风险|风险|利润|估值|值得|研究|持续|能不能|是什么/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([ticker, aliasTicker, cleaned, query].filter(Boolean))];
}

async function resolveCompany(query) {
  const candidates = companySearchCandidates(query);
  let company = null;
  for (const search of candidates) {
    const data = await api(`/api/companies/search?q=${encodeURIComponent(search)}`);
    company = data.companies?.[0] || null;
    if (company) break;
  }
  const fallbackTicker = candidates.find((candidate) => /^\d{4,5}\.HK$/.test(candidate));
  if (!company && fallbackTicker) return { ticker: fallbackTicker, nameZh: fallbackTicker, industry: "待补充" };
  if (!company) return null;
  return {
    ticker: company.ticker,
    nameZh: company.nameZh || company.name_zh || company.name || company.ticker,
    nameEn: company.nameEn || company.name_en || "",
    sector: company.sector || "",
    industry: company.industry || "",
    hasPortrait: Boolean(company.hasPortrait)
  };
}

async function refreshStatus() {
  try {
    apiStatus = await api("/api/status");
  } catch {
    apiStatus = null;
  }
}

async function refreshSessions() {
  try {
    const data = await api("/api/research/sessions?limit=30");
    recentSessions = data.sessions || [];
    if (!recentSessions.length && getSessionId()) {
      setThread([]);
      setPanel(null);
      setCompany(null);
      setDocuments([]);
      setSessionId(null);
    }
  } catch {
    recentSessions = [];
  } finally {
    sessionsLoaded = true;
  }
}

function appendMessage(role, content, meta = {}) {
  const message = { id: uid("msg"), role, content, meta, createdAt: new Date().toISOString() };
  setThread([...getThread(), message]);
  render();
  requestAnimationFrame(() => {
    document.querySelector(".conversation")?.scrollTo({ top: 999999, behavior: "smooth" });
    document.querySelector(".message:last-child")?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
}

async function copyMessage(id) {
  const message = getThread().find((item) => item.id === id);
  if (!message?.content) return;
  try {
    await navigator.clipboard.writeText(message.content);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = message.content;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  toast("已复制回答。");
}

function exportResearch() {
  const thread = getThread();
  if (!thread.length) {
    toast("还没有可导出的研究。");
    return;
  }
  const company = getCompany();
  const panel = getPanel();
  const heading = company ? `${company.nameZh || ""} ${company.ticker || ""}`.trim() : panel?.companyName || "Luvio 研究";
  const lines = [`# ${heading} · 研究记录`, ""];
  if (panel?.confidence) {
    lines.push(`> 研究状态：${panel.researchStatus || "持续观察"} · 置信度：${panel.confidence}`, "");
  }
  for (const message of thread) {
    lines.push(message.role === "user" ? `## 提问\n\n${message.content}` : `## Luvio\n\n${message.content}`, "");
  }
  const sources = Array.isArray(panel?.sources) ? panel.sources.filter((s) => s.url) : [];
  if (sources.length) {
    lines.push("## 来源", "", ...sources.map((s) => `- ${s.label || s.type || "来源"}：${s.url}`), "");
  }
  lines.push("---", "> 由 Luvio 生成，仅供研究学习，不构成投资建议。");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(company?.ticker || panel?.ticker || "luvio").replace(/[^\w.-]/g, "")}-research.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("已导出 Markdown 研究记录。");
}

function clearResearch() {
  stopBusy();
  setThread([]);
  setPanel(null);
  setCompany(null);
  setDocuments([]);
  setSessionId(null);
  toast("已新建研究。");
  location.hash = "#/";
  render();
}

function apiHistory(question = "") {
  const thread = getThread();
  const last = thread[thread.length - 1];
  const samePendingQuestion = last?.role === "user" && String(last.content || "").trim() === String(question || "").trim();
  return (samePendingQuestion ? thread.slice(0, -1) : thread)
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content, meta: m.meta || {}, createdAt: m.createdAt }));
}

function sessionTitle(fallbackQuestion = "") {
  const firstUser = getThread().find((message) => message.role === "user");
  return String(firstUser?.content || fallbackQuestion || "新研究").slice(0, 80);
}

function fallbackThreadFromSession(session) {
  const thread = Array.isArray(session.thread) ? session.thread.filter((m) => m?.role && m?.content) : [];
  if (thread.length) return thread.slice(-80);
  const restored = [];
  if (session.question) restored.push({ id: uid("msg"), role: "user", content: session.question, createdAt: session.createdAt });
  const content = session.reportMarkdown || session.fullResearch || "";
  if (content) restored.push({ id: uid("msg"), role: "assistant", content, createdAt: session.updatedAt });
  return restored;
}

async function loadSession(id) {
  if (!id || isBusy) return;
  try {
    const data = await api(`/api/research/sessions/${encodeURIComponent(id)}`);
    const session = data.session;
    if (!session) throw new Error("未找到研究会话");
    const panel = session.decisionPanel || null;
    let company = null;
    if (session.ticker) company = await resolveCompany(session.ticker);
    if (!company && panel?.ticker) company = { ticker: panel.ticker, nameZh: panel.companyName || panel.ticker };
    setSessionId(session.id);
    setCompany(company);
    setPanel(panel);
    setThread(fallbackThreadFromSession(session));
    location.hash = "#/";
    toast("已恢复历史研究。");
    render();
  } catch (error) {
    toast(error.message || "恢复历史失败。");
  }
}

async function deleteSession(id) {
  if (!id || isBusy) return;
  const item = recentSessions.find((session) => session.id === id);
  const title = item?.title || item?.question || "这条研究";
  const ok = window.confirm(`删除“${title}”？\n\n这会从本地 SQLite 里移除这条历史研究。`);
  if (!ok) return;
  try {
    await api(`/api/research/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (getSessionId() === id) {
      stopBusy();
      setThread([]);
      setPanel(null);
      setCompany(null);
      setDocuments([]);
      setSessionId(null);
    }
    await refreshSessions();
    toast("已删除历史研究。");
    render();
  } catch (error) {
    toast(error.message || "删除失败。");
  }
}

async function clearAllSessions() {
  if (isBusy || !recentSessions.length) return;
  const ok = window.confirm("清空全部历史研究？\n\n这会删除本地 SQLite 里的所有历史记录。");
  if (!ok) return;
  try {
    await api("/api/research/sessions", { method: "DELETE" });
    stopBusy();
    setThread([]);
    setPanel(null);
    setCompany(null);
    setDocuments([]);
    setSessionId(null);
    await refreshSessions();
    toast("已清空全部历史研究。");
    render();
  } catch (error) {
    toast(error.message || "清空失败。");
  }
}

async function sendChat(question) {
  let company = getCompany();
  const shouldResolve = !company || extractTicker(question) || extractAliasTicker(question);
  if (shouldResolve) {
    const resolved = await resolveCompany(question);
    if (resolved) {
      company = resolved;
      setCompany(company);
    }
  }
  if (!company) {
    appendMessage("assistant", "我还没有识别出公司。请补充港股代码或公司名，例如 0700.HK 腾讯。");
    return;
  }

  const result = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      question,
      company,
      sessionId: getSessionId(),
      sessionTitle: sessionTitle(question),
      history: apiHistory(question),
      documents: getDocuments(),
      memory: {}
    })
  });
  if (result.sessionId) setSessionId(result.sessionId);
  if (result.decisionPanel) setPanel(result.decisionPanel);
  appendMessage("assistant", result.content || "本轮没有生成有效回复。", {
    mode: result.mode,
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    confidence: result.decisionPanel?.confidence || null,
    evidence: (result.webEvidence?.evidence || []).slice(0, 6).map((e) => ({
      title: e.title || e.source || "网页证据",
      url: e.url,
      source: e.source || e.sourceType || "web",
      type: e.sourceType || "web",
      cred: e.credibilityScore ?? null,
      date: e.publishedAt || ""
    }))
  });
  await refreshSessions();
  render();
}

function dataSourceLabels(dataSources = {}) {
  const map = { market: "行情", financials: "财报", filings: "公告", news: "新闻", estimates: "预期" };
  return Object.entries(map)
    .filter(([key]) => dataSources?.[key]?.status === "ok")
    .map(([, label]) => label);
}

async function generateDeepResearch() {
  if (isBusy) return;
  const company = getCompany();
  const thread = getThread();
  if (!company) {
    toast("先输入公司或股票代码。");
    return;
  }

  startBusy("正在生成深度研究");
  render();
  try {
    const lastQuestion = [...thread].reverse().find((m) => m.role === "user")?.content || `分析 ${company.ticker}`;
    const result = await api("/api/report/generate", {
      method: "POST",
      body: JSON.stringify({
        question: lastQuestion,
        company,
        sessionId: getSessionId(),
        sessionTitle: sessionTitle(lastQuestion),
        documents: getDocuments(),
        history: thread.slice(-16).map((m) => ({ role: m.role, content: m.content })),
        memory: {}
      })
    });
    if (result.sessionId) setSessionId(result.sessionId);
    if (result.decisionPanel) setPanel(result.decisionPanel);
    appendMessage("assistant", result.markdown || "深度研究没有生成有效内容。", {
      type: "deep_research",
      mode: result.mode,
      model: result.model
    });
    await refreshSessions();
  } catch (error) {
    appendMessage("assistant", `深度研究失败：${error.message || "未知错误"}。`);
  } finally {
    stopBusy();
    render();
  }
}

async function parseFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const docs = [];
  for (const file of files) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await api("/api/parse-document", {
      method: "POST",
      body: JSON.stringify({ name: file.name, type: file.type, dataUrl, ticker: getCompany()?.ticker || null })
    });
    docs.push(response.document || response);
  }
  setDocuments([...getDocuments(), ...docs]);
  toast(`已上传 ${docs.length} 个资料。`);
  render();
}

function currentRoute() {
  const hash = location.hash.replace(/^#/, "") || "/";
  return hash.split("?")[0] || "/";
}

function shell(content) {
  app.innerHTML = `
    <div class="app">
      <header class="topbar">
        <a class="brand" href="#/" aria-label="Luvio 首页"><span>L</span><strong>Luvio</strong><em>Research</em></a>
        <nav>
          ${nav("/", "研究室")}
          ${nav("/settings", "设置")}
        </nav>
      </header>
      <main>${content}</main>
    </div>`;
}

function nav(path, label) {
  const active = currentRoute() === path;
  return `<a class="${active ? "active" : ""}" href="#${path}">${label}</a>`;
}

function renderResearch() {
  const company = getCompany();
  const panel = getPanel();
  const thread = getThread();
  const activeSessionId = getSessionId();
  const hasResearch = Boolean(company || thread.length);

  shell(`
    <section class="workspace">
      <aside class="sidebar">
        <button class="primary wide" data-action="new">新建研究</button>
        <section class="research-snapshot">
          <p>研究公司</p>
          <h2>${esc(panel?.companyName || company?.nameZh || "未选择公司")}</h2>
          <span>${esc(company?.ticker || panel?.ticker || "输入公司名或港股代码开始")}</span>
          ${panel?.confidence ? `<div class="snapshot-confidence"><span class="conf conf-${panel.confidence === "高" ? "high" : panel.confidence === "低" ? "low" : "mid"}">置信度 ${esc(panel.confidence)}</span></div>` : ""}
          ${thread.length ? `<button class="snapshot-export" type="button" data-action="export">导出研究 ↓</button>` : ""}
        </section>
        ${renderSessionHistory(activeSessionId)}
      </aside>

      <section class="desk">
        ${hasResearch ? `<div class="desk-head">
          <div>
            <p>Luvio Research</p>
            <h1>${company ? `${esc(company.nameZh)} ${esc(company.ticker)}` : "输入公司，开始判断"}</h1>
            <span>${company ? esc(company.industry || company.sector || "待补充") : "问一句就开始，复杂研究再沉到底层。"} </span>
          </div>
        </div>` : ""}
        <div class="conversation ${hasResearch ? "" : "is-empty"}">
          ${thread.length ? thread.map(renderMessage).join("") : renderEmptyState()}
          ${isBusy ? renderWaitingCard() : ""}
        </div>
        ${renderComposer(company)}
      </section>
    </section>`);
}

function renderSessionHistory(activeSessionId) {
  const count = recentSessions.length;
  const toggle = `<button class="history-toggle ${historyOpen ? "is-open" : ""}" type="button" data-action="toggle-history" aria-expanded="${historyOpen}">
      <span>历史研究${count ? ` · ${count}` : ""}</span>
      <i>${historyOpen ? "收起" : "展开"}</i>
    </button>`;
  if (!historyOpen) {
    return `<section class="history-panel collapsed">${toggle}</section>`;
  }
  const body = !sessionsLoaded
    ? `<div class="history-empty">正在读取历史...</div>`
    : count
      ? `<div class="session-list">${recentSessions.map((session) => renderSessionItem(session, activeSessionId)).join("")}</div>`
      : `<div class="history-empty">还没有历史研究。完成第一轮回答后会自动保存。</div>`;
  return `<section class="history-panel">
    ${toggle}
    ${count ? `<div class="history-actions"><button type="button" data-action="clear-sessions">清空全部</button></div>` : ""}
    ${body}
  </section>`;
}

function renderSessionItem(session, activeSessionId) {
  const active = session.id === activeSessionId;
  const title = session.title || session.question || session.companyName || session.ticker || "未命名研究";
  const company = session.companyName || session.company_name || session.ticker || "研究对象";
  return `<div class="session-item ${active ? "is-active" : ""}">
    <button class="session-open" type="button" data-action="load-session" data-id="${esc(session.id)}">
      <strong>${esc(title)}</strong>
      <span>${esc(company)}</span>
    </button>
    <button class="session-delete" type="button" data-action="delete-session" data-id="${esc(session.id)}" aria-label="删除历史研究">×</button>
  </div>`;
}

const WAIT_PHASES = [
  "正在读取行情与公司档案",
  "正在检索公开网页证据",
  "正在校验来源、剔除失效链接",
  "正在综合判断与证据置信度"
];

function waitPhase() {
  return WAIT_PHASES[Math.min(WAIT_PHASES.length - 1, Math.floor(busyElapsedSeconds() / 5))];
}

function renderWaitingCard() {
  return `<article class="message assistant">
    <div class="bubble answer-card wait-card">
      <div class="answer-brand">
        <div class="answer-mark"><i></i><span>LUVIO</span></div>
      </div>
      <div class="wait-row">
        <span class="wait-orb" aria-hidden="true"></span>
        <strong>${esc(busyLabel)}</strong>
        <em>已等待 <span data-busy-seconds>${busyElapsedSeconds()}</span>s</em>
      </div>
      <p class="wait-phase" data-busy-phase>${esc(waitPhase())}</p>
    </div>
  </article>`;
}

function renderComposer(company) {
  const status = isBusy
    ? `${esc(busyLabel)} · 已等待 <b data-busy-seconds>${busyElapsedSeconds()}</b>s`
    : company
      ? `${esc(company.nameZh || company.ticker)} · ${esc(company.ticker)}`
      : "先输入公司名或港股代码";
  return `<form class="composer" data-form="chat">
    <div class="composer-panel">
      <textarea name="query" rows="2" maxlength="1200" placeholder="${company ? "继续追问：利润、护城河、估值或证伪条件" : "输入公司名或代码，例如：阿里巴巴最近怎么样？"}"></textarea>
      <div class="composer-footer">
        <div class="composer-left-tools">
          <label class="tool-chip icon-chip file-label" title="上传资料">+<input type="file" name="documents" multiple accept=".pdf,.txt,.md,.csv,.json,image/*"></label>
          <button class="tool-chip" type="button" data-action="quick" data-query="它主要靠什么赚钱？">赚钱方式</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="竞争对手有哪些？">竞争格局</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="经营质量怎么样？">经营质量</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="什么情况会证伪？">证伪条件</button>
          <button class="tool-chip emphasis" type="button" data-action="report" ${company ? "" : "disabled"}>深度研究</button>
        </div>
        <div class="composer-status">${status}</div>
        <button class="send-button" type="submit" aria-label="发送">↑</button>
      </div>
    </div>
  </form>`;
}

function renderEmptyState() {
  const examples = [
    { label: "腾讯 0700.HK", q: "腾讯最近怎么样？" },
    { label: "阿里巴巴 9988.HK", q: "阿里巴巴赚钱吗？" },
    { label: "美团 3690.HK", q: "美团靠什么赚钱？" },
    { label: "比亚迪 1211.HK", q: "比亚迪的护城河在哪？" }
  ];
  return `<div class="empty-chat">
    <p>LUVIO RESEARCH</p>
    <h2>像研究员一样，<br>聊懂一家港股公司。</h2>
    <span>问一句就开始——赚不赚钱、护城河、竞争格局、估值、什么会证伪。普通追问给精炼短答；需要完整证据链时，再生成深度研究。</span>
    <div class="example-grid">
      ${examples
        .map(
          (item) => `<button class="example-card" type="button" data-action="example" data-query="${esc(item.q)}">
        <strong>${esc(item.label)}</strong>
        <span>${esc(item.q)}</span>
      </button>`
        )
        .join("")}
    </div>
  </div>`;
}

const SOURCE_TYPE_LABEL = {
  official: "官方",
  industry_research: "行研",
  financial_media: "财经媒体",
  cn_financial_media: "国内财经",
  web: "网页"
};

function credLevel(score) {
  if (typeof score !== "number") return "mid";
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "mid";
  return "low";
}

function renderEvidenceBlock(evidence) {
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

function renderAnswerMeta(meta = {}) {
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

function renderMessage(message) {
  if (message.role === "assistant") {
    const meta = message.meta || {};
    const title = meta.type === "deep_research" ? "DEEP RESEARCH" : "LUVIO";
    const messageId = message.id || "";
    return `<article class="message assistant">
      <div class="bubble answer-card">
        <div class="answer-brand">
          <div class="answer-mark"><i></i><span>${title}</span></div>
          <button class="copy-answer" type="button" data-action="copy-message" data-id="${esc(messageId)}">复制</button>
        </div>
        ${markdownToHtml(message.content)}
        ${renderEvidenceBlock(meta.evidence)}
        ${renderAnswerMeta(meta)}
      </div>
    </article>`;
  }
  return `<article class="message user">
    <div class="bubble">${markdownToHtml(message.content)}</div>
  </article>`;
}

function renderSettings() {
  const sources = apiStatus?.sources || [];
  const providers = apiStatus?.ai?.providers || [];
  shell(`<section class="simple-page settings-page">
    <div class="page-head"><p class="eyebrow">Settings</p><h1>后台设置与状态</h1><span>模型、数据源、隐藏功能都放在这里，不打扰研究主流程。</span></div>
    <div class="settings-grid">
      <article class="settings-card"><h2>模型</h2>
        <p>${apiStatus?.ai?.configured ? "已配置模型网关。" : "未配置模型 Key，系统会使用本地模板。"}</p>
        ${providers.map((p) => `<div class="setting-row"><span>${esc(p.label)}</span><strong>${esc(p.model)}</strong></div>`).join("") || `<div class="setting-row"><span>Provider</span><strong>未配置</strong></div>`}
      </article>
      <article class="settings-card"><h2>数据源</h2>
        ${sources.map((s) => `<div class="setting-row"><span>${esc(s.name)}</span><strong>${esc(s.status)}</strong></div>`).join("")}
      </article>
      <article class="settings-card"><h2>前台策略</h2>
        <p>报告页、关注页、最近报告、逐轮最近对话已从前台移除。当前产品只保留一个连续研究对话流。</p>
      </article>
      <article class="settings-card"><h2>数据怎么来的</h2>
        <p>你不需要自己接任何接口。行情、财报、公告、新闻和网页证据都由平台统一接入，回答里会标注本轮用到了哪些来源、有没有上网。</p>
        <div class="setting-row"><span>研究会话</span><strong>本地自动保存</strong></div>
        <div class="setting-row"><span>证据来源</span><strong>行情 / 财报 / 公告 / 网页</strong></div>
      </article>
    </div>
  </section>`);
}

function render() {
  if (currentRoute() === "/settings") renderSettings();
  else renderResearch();
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form='chat']");
  if (!form) return;
  event.preventDefault();
  const input = form.elements.query;
  const question = input.value.trim();
  if (!question || isBusy) return;
  input.value = "";
  appendMessage("user", question);
  startBusy("正在检索和思考");
  render();
  try {
    await sendChat(question);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    stopBusy();
    render();
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "new") clearResearch();
  if (action === "export") exportResearch();
  if (action === "load-session") await loadSession(target.dataset.id);
  if (action === "delete-session") await deleteSession(target.dataset.id);
  if (action === "clear-sessions") await clearAllSessions();
  if (action === "toggle-history") {
    historyOpen = !historyOpen;
    render();
  }
  if (action === "settings") location.hash = "#/settings";
  if (action === "quick") {
    const input = document.querySelector(".composer textarea");
    if (input) {
      input.value = target.dataset.query || "";
      input.focus();
    }
  }
  if (action === "example") {
    if (isBusy) return;
    const input = document.querySelector(".composer textarea");
    if (input) {
      input.value = target.dataset.query || "";
      input.focus();
      input.closest("form")?.requestSubmit();
    }
  }
  if (action === "copy-message") await copyMessage(target.dataset.id);
  if (action === "report") await generateDeepResearch();
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("input[type='file'][name='documents']");
  if (input) void parseFiles(input);
});

document.addEventListener("keydown", (event) => {
  const input = event.target.closest(".composer textarea");
  if (!input) return;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    input.closest("form")?.requestSubmit();
  }
});

window.addEventListener("hashchange", render);

await Promise.all([refreshStatus(), refreshSessions()]);
render();
