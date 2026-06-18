const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");

const storeKeys = {
  thread: "luvio.v3.thread",
  company: "luvio.v3.company",
  panel: "luvio.v3.panel",
  documents: "luvio.v3.documents"
};

const statusLabels = {
  watch: "持续观察",
  research_more: "需要补充材料",
  data_missing: "数据不足",
  risk_alert: "风险提示",
  out_of_scope: "不在研究范围"
};

let apiStatus = null;
let isBusy = false;
let busyStartedAt = 0;
let busyLabel = "模型思考中";
let busyTimer = null;

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

function getThread() {
  return readStore(storeKeys.thread, []);
}

function setThread(thread) {
  writeStore(storeKeys.thread, thread.slice(-80));
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

function statusLabel(status) {
  return statusLabels[status] || status || "等待研究";
}

function sourceHealth(panel) {
  const connected = panel?.connectedData || [];
  const missing = panel?.missingData || [];
  return { connected, missing, completeness: Number(panel?.dataCompleteness || 0) };
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
  const sectionTitle = /^(结论|事实|推断|估值\s*\/\s*风险|动作|证伪条件|我的判断|来源|深度研究)$/;

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

async function resolveCompany(query) {
  const ticker = extractTicker(query);
  const search = ticker || query;
  const data = await api(`/api/companies/search?q=${encodeURIComponent(search)}`);
  const company = data.companies?.[0] || null;
  if (!company && ticker) return { ticker, nameZh: ticker, industry: "待补充" };
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

function appendMessage(role, content, meta = {}) {
  const message = { id: uid("msg"), role, content, meta, createdAt: new Date().toISOString() };
  setThread([...getThread(), message]);
  render();
  requestAnimationFrame(() => {
    document.querySelector(".conversation")?.scrollTo({ top: 999999, behavior: "smooth" });
    document.querySelector(".message:last-child")?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
}

function clearResearch() {
  stopBusy();
  setThread([]);
  setPanel(null);
  setCompany(null);
  toast("已新建研究。");
  location.hash = "#/";
  render();
}

async function sendChat(question) {
  let company = getCompany();
  const shouldResolve = !company || extractTicker(question) || /腾讯|耐世特|阿里|美团|小米|比亚迪|吉利|联想|地平线/.test(question);
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
      history: getThread().slice(-16).map((m) => ({ role: m.role, content: m.content })),
      documents: getDocuments(),
      memory: {}
    })
  });
  if (result.decisionPanel) setPanel(result.decisionPanel);
  appendMessage("assistant", result.content || "本轮没有生成有效回复。", { mode: result.mode });
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
        documents: getDocuments(),
        history: thread.slice(-16).map((m) => ({ role: m.role, content: m.content })),
        memory: {}
      })
    });
    if (result.decisionPanel) setPanel(result.decisionPanel);
    appendMessage("assistant", result.markdown || "深度研究没有生成有效内容。", {
      type: "deep_research",
      mode: result.mode,
      model: result.model
    });
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
  const health = sourceHealth(panel);
  const docs = getDocuments();
  const lastUser = [...thread].reverse().find((message) => message.role === "user");

  shell(`
    <section class="workspace">
      <aside class="sidebar">
        <div class="sidebar-hero">
          <strong>LUVIO</strong>
          <span>Open Financial Console</span>
        </div>
        <button class="primary wide" data-action="new">新建研究</button>
        <section class="research-snapshot">
          <p>当前研究</p>
          <h2>${esc(panel?.companyName || company?.nameZh || "未选择公司")}</h2>
          <span>${esc(company?.ticker || panel?.ticker || "输入公司名或港股代码开始")}</span>
          <div class="snapshot-meta">
            <strong>${esc(statusLabel(panel?.researchStatus))}</strong>
            <em>完整度 ${health.completeness}%</em>
          </div>
        </section>
        <section class="side-block">
          <h3>上下文</h3>
          <div class="context-row"><span>当前问题</span><strong>${esc(lastUser?.content?.slice(0, 34) || "暂无")}</strong></div>
          <div class="context-row"><span>对话轮次</span><strong>${Math.ceil(thread.length / 2)}</strong></div>
          <div class="context-row"><span>资料</span><strong>${docs.length} 份</strong></div>
        </section>
      </aside>

      <section class="desk">
        <div class="desk-head">
          <div>
            <p>研究室</p>
            <h1>${company ? `${esc(company.nameZh)} ${esc(company.ticker)}` : "一个对话流完成研究"}</h1>
            <span>${company ? esc(company.industry || company.sector || "资料待补齐") : "普通追问、深度研究、资料上传都在同一个上下文里完成"}</span>
          </div>
          <div class="desk-status">
            <strong>${esc(statusLabel(panel?.researchStatus))}</strong>
            <span>${health.connected.length} 项数据已接入</span>
          </div>
        </div>
        <div class="conversation">
          ${thread.length ? thread.map(renderMessage).join("") : renderEmptyState()}
          ${isBusy ? renderWaitingCard() : ""}
        </div>
        ${renderComposer(company, health)}
      </section>
    </section>`);
}

function renderWaitingCard() {
  return `<div class="message assistant">
    <div class="bubble answer-card loading wait-card">
      <div class="answer-brand"><i></i><span>LUVIO</span></div>
      <div class="wait-row">
        <span class="thinking-dot"></span>
        <strong>${esc(busyLabel)}</strong>
        <em>已等待 <span data-busy-seconds>${busyElapsedSeconds()}</span>s</em>
      </div>
      <p>正在核对数据、推理和证据缺口。长回答会慢一点，但不会让你盲等。</p>
    </div>
  </div>`;
}

function renderComposer(company, health) {
  const status = isBusy
    ? `${esc(busyLabel)} · 已等待 <b data-busy-seconds>${busyElapsedSeconds()}</b>s`
    : company
      ? `${esc(company.ticker)} · ${health.connected.length} 项数据已接入`
      : "先输入公司名或港股代码";
  return `<form class="composer" data-form="chat">
    <div class="composer-panel">
      <textarea name="query" rows="2" maxlength="1200" placeholder="继续追问这家公司，例如：护城河是什么？利润能不能持续？"></textarea>
      <div class="composer-footer">
        <div class="composer-left-tools">
          <label class="tool-chip file-label">上传资料<input type="file" name="documents" multiple accept=".pdf,.txt,.md,.csv,.json,image/*"></label>
          <button class="tool-chip" type="button" data-action="quick" data-query="这家公司赚不赚钱？">赚不赚钱</button>
          <button class="tool-chip" type="button" data-action="quick" data-query="主要风险是什么？">主要风险</button>
          <button class="tool-chip emphasis" type="button" data-action="report" ${company ? "" : "disabled"}>深度研究</button>
        </div>
        <div class="composer-status">${status}</div>
        <button class="send-button" type="submit" aria-label="发送">⌃</button>
      </div>
    </div>
  </form>`;
}

function renderEmptyState() {
  return `<div class="empty-chat">
    <h2>先聊，不拆系统。</h2>
    <p>你可以连续追问同一家公司；需要更长的输出时点“深度研究”，结果也会直接回到这条对话流里。</p>
    <div class="prompt-row">
      <button data-action="quick" data-query="分析 0700.HK 腾讯怎么样">分析腾讯</button>
      <button data-action="quick" data-query="阿里巴巴最近怎么样？">阿里巴巴</button>
      <button data-action="quick" data-query="帮我看 1316.HK 耐世特是不是值得长期研究。我成本价 4.9，持有 3000 股。">耐世特持仓</button>
    </div>
  </div>`;
}

function renderMessage(message) {
  if (message.role === "assistant") {
    const title = message.meta?.type === "deep_research" ? "DEEP RESEARCH" : "LUVIO";
    return `<article class="message assistant">
      <div class="bubble answer-card">
        <div class="answer-brand"><i></i><span>${title}</span></div>
        ${markdownToHtml(message.content)}
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
  startBusy("模型正在思考");
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
  if (action === "settings") location.hash = "#/settings";
  if (action === "quick") {
    const input = document.querySelector(".composer textarea");
    if (input) {
      input.value = target.dataset.query || "";
      input.focus();
    }
  }
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

await refreshStatus();
render();
