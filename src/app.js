const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");

const storeKeys = {
  thread: "luvio.v3.thread",
  company: "luvio.v3.company",
  panel: "luvio.v3.panel",
  documents: "luvio.v3.documents",
  sessionId: "luvio.v3.sessionId",
  theme: "luvio.v3.theme"
};

// 主题：尽早应用，减少浅→深闪烁。
function getTheme() {
  return localStorage.getItem(storeKeys.theme) === "dark" ? "dark" : "light";
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}
function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(storeKeys.theme, next);
  applyTheme(next);
  render();
}
applyTheme(getTheme());

const companyAliases = [
  { pattern: /腾讯控股|腾讯|Tencent/i, ticker: "0700.HK" },
  { pattern: /阿里巴巴|阿里(?!健康|影业)|Alibaba/i, ticker: "9988.HK" },
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

// 美股别名（名称 + 代码）。中文名只能靠这张表（FMP 搜索不认中文）；英文名/拼音/代码
// 没命中这张表时，resolveCompany 会再走 /api/companies/resolve（FMP + LLM）兜底。
// 其它美股也可用 $代码 或 代码.US，例如 $PLTR、PLTR.US。
const usAliases = [
  { pattern: /苹果|Apple|\bAAPL\b/i, ticker: "AAPL", name: "苹果 Apple" },
  { pattern: /英伟达|NVIDIA|\bNVDA\b/i, ticker: "NVDA", name: "英伟达 NVIDIA" },
  { pattern: /特斯拉|Tesla|\bTSLA\b/i, ticker: "TSLA", name: "特斯拉 Tesla" },
  { pattern: /微软|Microsoft|\bMSFT\b/i, ticker: "MSFT", name: "微软 Microsoft" },
  { pattern: /谷歌|Google|Alphabet|\bGOOGL?\b/i, ticker: "GOOGL", name: "谷歌 Alphabet" },
  { pattern: /亚马逊|Amazon|\bAMZN\b/i, ticker: "AMZN", name: "亚马逊 Amazon" },
  { pattern: /\bMeta\b|Facebook|\bMETA\b/i, ticker: "META", name: "Meta" },
  { pattern: /奈飞|网飞|Netflix|\bNFLX\b/i, ticker: "NFLX", name: "奈飞 Netflix" },
  { pattern: /英特尔|Intel|\bINTC\b/i, ticker: "INTC", name: "英特尔 Intel" },
  { pattern: /\bAMD\b|超威/i, ticker: "AMD", name: "AMD" },
  { pattern: /台积电|TSMC|\bTSM\b/i, ticker: "TSM", name: "台积电 TSMC" },
  // 半导体 / 硬件
  { pattern: /美光|镁光|Micron|\bMU\b/i, ticker: "MU", name: "美光科技 Micron" },
  { pattern: /博通|Broadcom|\bAVGO\b/i, ticker: "AVGO", name: "博通 Broadcom" },
  { pattern: /高通|Qualcomm|\bQCOM\b/i, ticker: "QCOM", name: "高通 Qualcomm" },
  { pattern: /阿斯麦|阿斯麦尔|\bASML\b/i, ticker: "ASML", name: "阿斯麦 ASML" },
  { pattern: /应用材料|Applied Materials|\bAMAT\b/i, ticker: "AMAT", name: "应用材料 Applied Materials" },
  { pattern: /美满|Marvell|\bMRVL\b/i, ticker: "MRVL", name: "美满电子 Marvell" },
  { pattern: /\bARM\b|安谋/i, ticker: "ARM", name: "ARM" },
  // 软件 / 互联网
  { pattern: /甲骨文|Oracle|\bORCL\b/i, ticker: "ORCL", name: "甲骨文 Oracle" },
  { pattern: /思科|Cisco|\bCSCO\b/i, ticker: "CSCO", name: "思科 Cisco" },
  { pattern: /Adobe|\bADBE\b/i, ticker: "ADBE", name: "Adobe" },
  { pattern: /Salesforce|赛富时|\bCRM\b/i, ticker: "CRM", name: "Salesforce" },
  { pattern: /Palantir|\bPLTR\b/i, ticker: "PLTR", name: "Palantir" },
  { pattern: /Snowflake|\bSNOW\b/i, ticker: "SNOW", name: "Snowflake" },
  { pattern: /Coinbase|\bCOIN\b/i, ticker: "COIN", name: "Coinbase" },
  { pattern: /优步|Uber|\bUBER\b/i, ticker: "UBER", name: "优步 Uber" },
  // 消费 / 工业 / 金融 / 医药
  { pattern: /迪士尼|Disney|\bDIS\b/i, ticker: "DIS", name: "迪士尼 Disney" },
  { pattern: /星巴克|Starbucks|\bSBUX\b/i, ticker: "SBUX", name: "星巴克 Starbucks" },
  { pattern: /麦当劳|McDonald|\bMCD\b/i, ticker: "MCD", name: "麦当劳 McDonald's" },
  { pattern: /可口可乐|Coca[ -]?Cola/i, ticker: "KO", name: "可口可乐 Coca-Cola" },
  { pattern: /百事|Pepsi|\bPEP\b/i, ticker: "PEP", name: "百事 PepsiCo" },
  { pattern: /沃尔玛|Walmart|\bWMT\b/i, ticker: "WMT", name: "沃尔玛 Walmart" },
  { pattern: /耐克|Nike/i, ticker: "NKE", name: "耐克 Nike" },
  { pattern: /波音|Boeing/i, ticker: "BA", name: "波音 Boeing" },
  { pattern: /摩根大通|小摩|JPMorgan|JP\s?Morgan|\bJPM\b/i, ticker: "JPM", name: "摩根大通 JPMorgan" },
  { pattern: /高盛|Goldman/i, ticker: "GS", name: "高盛 Goldman Sachs" },
  { pattern: /伯克希尔|巴菲特|Berkshire/i, ticker: "BRK-B", name: "伯克希尔 Berkshire" },
  { pattern: /Visa|维萨/i, ticker: "V", name: "Visa" },
  { pattern: /万事达|Mastercard/i, ticker: "MA", name: "万事达 Mastercard" },
  { pattern: /礼来|Eli\s?Lilly|\bLLY\b/i, ticker: "LLY", name: "礼来 Eli Lilly" },
  { pattern: /强生|Johnson\s?&?\s?Johnson|\bJNJ\b/i, ticker: "JNJ", name: "强生 J&J" },
  { pattern: /辉瑞|Pfizer|\bPFE\b/i, ticker: "PFE", name: "辉瑞 Pfizer" },
  { pattern: /\bBABA\b/i, ticker: "BABA", name: "阿里巴巴 ADR" }
];

// 双重上市（港股 + 美股 ADR）。基本面是同一家公司，但 FMP 免费档只覆盖美股 ADR、
// 不覆盖港股，所以基本面/估值统一走美股 ADR 口径（数据更全），并向用户说清两地代码。
const DUAL_LISTINGS = [
  { nameZh: "阿里巴巴", hk: "9988.HK", us: "BABA" },
  { nameZh: "京东", hk: "9618.HK", us: "JD" },
  { nameZh: "百度", hk: "9888.HK", us: "BIDU" },
  { nameZh: "网易", hk: "9999.HK", us: "NTES" },
  { nameZh: "携程", hk: "9961.HK", us: "TCOM" },
  { nameZh: "哔哩哔哩", hk: "9626.HK", us: "BILI" },
  { nameZh: "理想汽车", hk: "2015.HK", us: "LI" },
  { nameZh: "小鹏汽车", hk: "9868.HK", us: "XPEV" },
  { nameZh: "蔚来", hk: "9866.HK", us: "NIO" },
  { nameZh: "名创优品", hk: "9896.HK", us: "MNSO" },
  { nameZh: "新东方", hk: "9901.HK", us: "EDU" },
  { nameZh: "贝壳", hk: "2423.HK", us: "BEKE" }
];
const DUAL_BY_TICKER = new Map();
for (const d of DUAL_LISTINGS) { DUAL_BY_TICKER.set(d.hk, d); DUAL_BY_TICKER.set(d.us, d); }

// 把"双重上市"的查询统一解析到美股 ADR 口径（基本面数据更全），并附带两地代码，
// 让前端能告诉用户"你问的是哪一边、我用哪一边做基本面"。识别不到返回 null。
function resolveDualListing(query = "") {
  const aliasTicker = extractAliasTicker(query);          // 阿里巴巴 → 9988.HK
  const usHit = resolveUsTicker(query)?.ticker || "";     // BABA
  const hkTicker = extractTicker(query);                  // 9988.HK
  const candidate = [aliasTicker, usHit, hkTicker].find((t) => t && DUAL_BY_TICKER.has(t));
  const byName = candidate ? null : DUAL_LISTINGS.find((d) => query.includes(d.nameZh));
  const hit = candidate ? DUAL_BY_TICKER.get(candidate) : byName;
  if (!hit) return null;
  const asked = candidate || hit.us; // 用户实际问的那一边（港股代码 / 美股代码 / 名称→默认美股）
  return {
    ticker: hit.us,                  // 基本面/估值统一走美股 ADR
    nameZh: hit.nameZh,
    nameEn: "",
    industry: "中概 · 双重上市",
    dualListing: { hk: hit.hk, us: hit.us, asked, primary: "us" }
  };
}

const US_STOPWORDS = new Set([
  "PE", "PB", "PS", "ROE", "ROI", "ROA", "ROC", "AI", "IPO", "GDP", "CEO",
  "CFO", "COO", "CTO", "CMO", "US", "HK", "EPS", "FCF", "DCF", "ETF",
  "Q1", "Q2", "Q3", "Q4", "YOY", "QOQ", "MOM", "TTM", "LTM", "MRQ",
  "CPI", "PPI", "PMI", "GNP", "EV", "NAV", "AUM", "BPS", "DPS", "NIM",
  "NYSE", "SEC", "SFC", "MSCI", "FTSE", "SPX", "SPY", "ESG", "SPAC"
]);

function resolveUsTicker(text = "") {
  const hit = usAliases.find((item) => item.pattern.test(text));
  if (hit) return { ticker: hit.ticker, name: hit.name };
  const t = String(text).toUpperCase().trim();
  // $TICKER or TICKER.US (explicit notation)
  const m = t.match(/\$([A-Z]{1,5})\b/) || t.match(/\b([A-Z]{1,5})\.US\b/);
  if (m && !US_STOPWORDS.has(m[1])) return { ticker: m[1], name: m[1] };
  // Bare uppercase: entire query is the ticker (e.g. "RKLB", "PLTR")
  if (/^[A-Z]{1,5}$/.test(t) && !US_STOPWORDS.has(t)) return { ticker: t, name: t };
  // Bare uppercase word embedded in mixed text (e.g. "分析 RKLB 的基本面")。
  // 但若它后面紧跟另一个拉丁词（"SPACE X"、"OPEN AI"），那是多词公司名的一部分、不是
  // 代码——不能把 "Space X" 抠成 SPACE（截图里"SPACE SPACE"张冠李戴的根因）。这类多词名
  // 交给下游权威解析（FMP 名称搜索 + LLM 校验）去查它真实的上市代码，而不是硬猜。
  const w = t.match(/(?:^|[\s,])([A-Z]{2,5})(?:[\s,.]|$)/);
  if (w && !US_STOPWORDS.has(w[1])) {
    const after = t.slice(w.index + w[0].length);
    if (!/^\s*[A-Za-z]/.test(after)) return { ticker: w[1], name: w[1] };
  }
  return null;
}

let apiStatus = null;
let isBusy = false;
let busyStartedAt = 0;
let busyLabel = "模型思考中";
let busyTimer = null;
let recentSessions = [];
let sessionsLoaded = false;
let historyOpen = true;
// 流式作答：tokens 边到边渲染。streamingActive 时用 renderStreamingCard 顶掉骨架屏，
// 后续 token 只改 #stream-body 的 innerHTML（不整页重渲，避免抖动）。
let streamingActive = false;
let streamingText = "";
// 思考型模型（deepseek-v4）出首个答案 token 前会先推理一阵，期间没有内容 token。
// 累计推理字数，让等待卡显示"正在推理 · 已 N 字"，而不是干等一片骨架屏。
let reasoningChars = 0;

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

// 流式聊天：读 SSE，token 事件边到边渲染，final 事件携带完整面板/估值/接地。
// 端点不支持流式或中途出错（且还没拿到 final）时，回退到普通 JSON 请求，绝不丢回答。
async function chatStream(body) {
  streamingActive = false;
  streamingText = "";
  reasoningChars = 0;
  let finalResult = null;
  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true })
    });
    const ctype = resp.headers.get("content-type") || "";
    if (!resp.ok || !resp.body || !ctype.includes("text/event-stream")) throw new Error("no-stream");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let evt = "message";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") { evt = "message"; continue; }
        if (line.startsWith("event:")) { evt = line.slice(6).trim(); continue; }
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (evt === "token") {
          if (!streamingActive) { stopBusy(); streamingActive = true; render(); }
          streamingText += json.t || "";
          const node = document.getElementById("stream-body");
          if (node) node.innerHTML = `${markdownToHtml(streamingText)}<span class="stream-caret"></span>`;
          document.querySelector(".conversation")?.scrollTo({ top: 999999 });
        } else if (evt === "reasoning") {
          // 推理期：累计字数，等待卡的 phase 行（1s tick）会读 reasoningChars 显示进度。
          reasoningChars += json.n || 0;
          updateBusyClock();
        } else if (evt === "final") {
          finalResult = json;
        } else if (evt === "error") {
          throw new Error(json.message || "流式作答失败");
        }
      }
    }
  } catch {
    if (!finalResult) finalResult = await api("/api/chat", { method: "POST", body: JSON.stringify(body) });
  } finally {
    streamingActive = false;
    streamingText = "";
  }
  return finalResult;
}

function linkifyEscaped(text = "") {
  return String(text).replace(/(https?:\/\/[^\s<]+)/g, (match) => {
    const trailing = match.match(/[)，。；、,.!?)]+$/)?.[0] || "";
    const url = match.slice(0, match.length - trailing.length);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
}

// 行内格式：[文字](链接) → 链接 → 转义 → 裸链接化 → **粗体**。所有行（段落 / 列表 /
// 编号 / 标题）统一走这里，避免编号行漏掉加粗导致 ** 原样漏出。
// Markdown 链接用私有区占位符隔离，避免被后面的裸链接化二次包裹。
function inlineFormat(text = "") {
  const links = [];
  const staged = String(text).replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    links.push({ label, url });
    return `${links.length - 1}`;
  });
  let out = linkifyEscaped(esc(staged)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(\d+)/g, (_m, i) => {
    const { label, url } = links[Number(i)] || {};
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";
  });
  return out;
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
    if (line.startsWith("### ")) html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
    else if (sectionTitle.test(line)) html.push(`<h3>${esc(line)}</h3>`);
    else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (/^\d+[.、]\s+/.test(line)) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p class="numbered-line">${inlineFormat(line)}</p>`);
    } else {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

// 研究段落标题 → 语气 tone（用于结构化层级与重点提权）。覆盖 prompt 里所有模式
// （泛研究 / 赚钱 / 护城河 / 竞争 / 证伪）用到的段落名，之前有一半没被识别。
const SECTION_TONES = [
  [/^(结论|我的判断)$/, "verdict"],
  [/^简单(说|结论)$/, "lead"],
  [/^事实$/, "facts"],
  [/^(推断|拆开看|怎么理解竞争格局)$/, "reason"],
  [/^估值\s*\/\s*风险$/, "valuation"],
  [/^(主要风险|风险\s*\/\s*证伪|证伪条件|会推翻逻辑的关键事实)$/, "risk"],
  [/^动作$/, "action"],
  [/^(还缺什么|数据缺口|证据缺口)/, "gap"],
  [/^来源[:：]?$/, "sources"],
  [/^(靠什么赚钱|利润质量|现金流|商业模式|护城河拆解|关键判断|主要竞争对手|接下来重点看|下一步看什么|怎么提前观察|已抓到的外部信号|深度研究)$/, "neutral"]
];

const SECTION_LABEL_EN = {
  verdict: "VERDICT", lead: "TL;DR", facts: "FACTS", reason: "ANALYSIS",
  valuation: "VALUATION", risk: "RISK", action: "ACTION", gap: "GAPS", sources: "SOURCES", neutral: ""
};

function sectionToneOf(line = "") {
  for (const [re, tone] of SECTION_TONES) if (re.test(line)) return tone;
  return null;
}

// 把一条研究回答按已知段落标题切成结构块。识别不到任何段落（画像 / 事件 / 持仓 /
// 短答）时退回平铺渲染，行为完全不变。
function renderRichAnswer(content = "") {
  const lines = String(content).split(/\r?\n/);
  const blocks = [];
  let lead = [];
  let cur = null;
  for (const raw of lines) {
    const tone = raw.trim() ? sectionToneOf(raw.trim()) : null;
    if (tone) {
      if (cur) blocks.push(cur);
      else if (lead.length) { blocks.push({ lead: lead.slice() }); lead = []; }
      cur = { title: raw.trim(), tone, body: [] };
    } else if (cur) {
      cur.body.push(raw);
    } else {
      lead.push(raw);
    }
  }
  if (cur) blocks.push(cur);
  else if (lead.length) blocks.push({ lead });

  if (!blocks.some((b) => b.tone)) return markdownToHtml(content);

  return blocks
    .map((b, i) => {
      // --i 驱动分段渐显的错峰延迟（仅最新一条回答会动，见 styles.css）。
      if (b.lead) {
        const html = markdownToHtml(b.lead.join("\n"));
        return html ? `<div class="ans-lead" style="--i:${i}">${html}</div>` : "";
      }
      const en = SECTION_LABEL_EN[b.tone] || "";
      const body = markdownToHtml(b.body.join("\n"));
      return `<section class="ans-sec tone-${b.tone}" style="--i:${i}">
        <div class="ans-sec-head"><span class="ans-dot"></span><span class="ans-sec-zh">${esc(b.title)}</span>${en ? `<span class="ans-sec-en">${en}</span>` : ""}</div>
        <div class="ans-sec-body">${body}</div>
      </section>`;
    })
    .join("");
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

// 把追问词剥掉，留下"疑似公司名"残串。用于 HK 搜索候选、FMP 兜底查询、以及
// 判断"这句到底有没有点名一家公司"。
function companyNameResidual(query = "") {
  return String(query)
    .replace(/[？?！!，,。.；;：:、""''《》()（）]/g, " ")
    // 开场白 / 客套（"我想了解"那种）先剥掉，避免残串变成"我想 泛林集团"。
    .replace(/我想了解|我想问问|我想问|我想知道|我想看看|我想|想了解|想知道|想问问|想问|帮我看看|帮我查查|帮我查|帮我分析|帮我|麻烦你|麻烦|请问|请帮我|给我讲|给我说|能否|可以/g, " ")
    .replace(/最近|怎么样|怎样|怎么|如何|分析|看看|一下|讲讲|说说|介绍|了解|这家公司|这家|公司|这只|股票|经营质量|经营|盈利能力|盈利|现金流|现金|资产负债|负债|偿债|竞争对手|竞争|对手|格局|前景|趋势|空间|催化|管理层|管理|治理|股东回报|股东|回报|分红|回购|成长|增长|增速|业绩|运营|营运|商业模式|模式|逻辑|信号|指标|怎么看|值不值|贵不贵|便宜|护城河|赚钱|不赚钱|主要风险|风险|利润|毛利|营收|估值|赔率|基本面|值得|研究|持续|能不能|是什么|有没有|多少|呢|吗|的|了/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 公司名后缀（中文）。命中说明残串多半是一家公司，而不是"毛利率/护城河"这类追问。
const CN_COMPANY_SUFFIX = /(科技|集团|股份|控股|银行|保险|证券|基金|汽车|医药|生物|制药|能源|半导体|电子|国际|地产|食品|饮料|光电|通信|网络|软件|数据|智能|重工|机械|电力|航空|航运|传媒|文化|教育|物流|材料|化工|钢铁|水泥|实业|电器|家居|服饰|乳业|酒业|影业)/;

// 开场白前缀（"我想了解…"），判断主语位时先剥掉。
const LEAD_IN_PREFIX = /^(我想了解|我想问问|我想问|我想知道|我想看看|我想|想了解|想知道|想问问|想问|帮我看看|帮我查查|帮我查|帮我分析|帮我|麻烦你|麻烦|请问|请帮我|了解一下|看下|看看)\s*/;
// 追问句常见开头（指代/时间/指标）。出现在主语位说明这是对当前公司的追问，不是点名新公司。
const FOLLOWUP_HEAD = /^(它|他|她|这|那|其|该|怎|为什么|现在|目前|当前|未来|今年|去年|最近|短期|长期|股价|估值|市值|毛利|利润|净利|营收|收入|经营|盈利|现金|负债|偿债|竞争|格局|管理|治理|股东|回报|成长|增速|业绩|运营|营运|质量|护城河|风险|基本面|赚钱|分红|回购|增长|前景|趋势|空间|逻辑|催化|对比|相比|和|跟|与|vs)/i;

// 这句是否在"点名一家（可能是新的）公司"。用于决定是否触发解析，以及解析失败时
// 是否要明确告诉用户"没识别出"，而不是默默沿用上一家公司作答（张冠李戴的根因）。
function mentionsNewCompany(query = "") {
  if (extractTicker(query) || extractAliasTicker(query) || resolveUsTicker(query) || resolveDualListing(query)) return true;
  const residual = companyNameResidual(query);
  if (residual.length < 2) return false;
  if (CN_COMPANY_SUFFIX.test(residual)) return true;        // 美光科技 / 某某集团
  if (/[A-Z][a-z]{2,}/.test(residual)) return true;         // 英文专有名词：Micron / Coinbase（排除 ROE/EBITDA 这类全大写）
  // 无后缀的中文公司名（贵州茅台 / 比亚迪 / 顺丰）：只有出现在主语位（问句开头、不是
  // 指代/指标这类追问词）才算点名公司，避免把"估值贵不贵""现在怎么看"误判成新公司。
  const lead = query.trim().replace(LEAD_IN_PREFIX, "").trim();
  if (/^[一-龥]{2,}/.test(lead) && !FOLLOWUP_HEAD.test(lead)) return true;
  return false;
}

// "强信号"版：明确点名了**另一家**公司（代码 / 别名 / 双重上市 / 未上市私人公司 /
// 带后缀的公司名 / 英文专名）。已有在研公司时只认强信号才切换标的——"经营质量怎么样"
// 这类纯追问没有强信号，会留在当前公司，连续对话才不会被打断（这是张冠李戴的反面：
// 不是答错成别家，而是别把追问当成新公司）。
function mentionsNewCompanyStrong(query = "") {
  if (extractTicker(query) || extractAliasTicker(query) || resolveUsTicker(query) || resolveDualListing(query)) return true;
  const residual = companyNameResidual(query);
  if (residual.length < 2) return false;
  if (CN_COMPANY_SUFFIX.test(residual)) return true;        // 美光科技 / 某某集团
  if (/[A-Z][a-z]{2,}/.test(residual)) return true;         // 英文专名 Micron / Coinbase
  return false;
}

function companySearchCandidates(query = "") {
  const ticker = extractTicker(query);
  const aliasTicker = extractAliasTicker(query);
  const cleaned = companyNameResidual(query);
  return [...new Set([ticker, aliasTicker, cleaned, query].filter(Boolean))];
}

async function resolveCompany(query) {
  // 双重上市优先：阿里巴巴 / 京东等统一走美股 ADR 口径，附带两地代码。
  const dual = resolveDualListing(query);
  if (dual) return dual;
  const us = resolveUsTicker(query);
  const candidates = companySearchCandidates(query);
  let company = null;
  for (const search of candidates) {
    const data = await api(`/api/companies/search?q=${encodeURIComponent(search)}`);
    company = data.companies?.[0] || null;
    if (company) break;
  }
  // US tickers aren't in the HK searchable DB — build a minimal company so the
  // research pipeline (live quote + FMP fundamentals) can run.
  if (!company && us) return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
  const fallbackTicker = candidates.find((candidate) => /^\d{4,5}\.HK$/.test(candidate));
  if (!company && fallbackTicker) return { ticker: fallbackTicker, nameZh: fallbackTicker, industry: "待补充" };
  // 没命中别名表/港股库时，走智能解析兜底：英文/拼音→FMP，中文名→LLM（如
  // 泛林集团→LRCX、商汤→0020.HK），代码再经 FMP 校验，防止张冠李戴。
  if (!company) {
    const residual = companyNameResidual(query) || query.trim();
    if (residual.length >= 2) {
      try {
        const data = await api(`/api/companies/resolve?q=${encodeURIComponent(residual)}`);
        if (data.company?.ticker) return data.company;
        // A 股（沪深）：Luvio 目前只做港股+美股，给一个专门的提示而不是泛泛"没识别"。
        if (data.reason === "cn_unsupported") return { unsupported: true, market: "CN", name: data.name || residual };
      } catch { /* 兜底失败就走下面的"未识别"分支 */ }
    }
  }
  // 点名了一家公司却怎么都解析不出 → 返回明确的"未识别"信号，让上层提示用户用代码，
  // 绝不沿用上一家公司作答（这是"美光问成中国交通建设"那种张冠李戴的根因）。
  if (!company) {
    return mentionsNewCompany(query)
      ? { unresolved: true, name: companyNameResidual(query) || query.trim() }
      : null;
  }
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
    // Only reset if our active session was explicitly deleted server-side (the DB
    // has other sessions but not ours). Never wipe live research just because the
    // list is empty — that would discard an in-progress thread.
    const activeId = getSessionId();
    if (activeId && recentSessions.length && !recentSessions.some((s) => s.id === activeId)) {
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

async function showPortfolio() {
  try {
    const data = await api("/api/portfolio");
    appendMessage("assistant", "我的持仓", { type: "portfolio", positions: data.positions || [] });
  } catch (error) {
    toast(error.message || "暂时无法读取持仓。");
  }
}

// 删除某条持仓后，原地刷新最近那张持仓面板，而不是再插一张新的。
async function refreshPortfolioPanel() {
  const data = await api("/api/portfolio");
  const positions = data.positions || [];
  const thread = getThread();
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    if (thread[i].meta?.type === "portfolio") {
      thread[i] = { ...thread[i], meta: { ...thread[i].meta, positions } };
      break;
    }
  }
  setThread(thread);
  render();
}

async function deletePortfolioPosition(ticker) {
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

async function showEventDigest() {
  try {
    const data = await api("/api/events/digest?slot=premarket");
    const digest = data.digest || {};
    const groups = Array.isArray(digest.groups) ? digest.groups : [];
    const failures = Array.isArray(digest.failures) ? digest.failures : [];
    const tag = (s) => (s === "high" ? "🔴 重要" : s === "medium" ? "🟡 关注" : "⚪ 一般");

    const withEvents = groups.filter((g) => (g.events || []).length);
    const emptyGroups = groups.filter((g) => !(g.events || []).length && g.status !== "error");

    const lines = ["## 盘前事件提醒", "", digest.summary || ""];

    // 按公司分组：每家一张小卡，事件按 severity 排好。
    for (const g of withEvents) {
      lines.push("", `### ${g.companyName} · ${g.ticker}`);
      for (const e of g.events) {
        const title = String(e.title || "").replace(/[[\]]/g, "");
        lines.push(`- ${tag(e.severity)} ${e.url ? `[${title}](${e.url})` : title}`);
      }
    }

    // 抓取失败：明确列出哪家、为什么——不再让用户以为是"没事件"。
    if (failures.length) {
      lines.push("", "### ⚠️ 本轮抓取失败");
      for (const f of failures) {
        lines.push(`- ${f.companyName} · ${f.ticker}：${(f.reasons || []).join("；") || "未知原因"}`);
      }
    }

    // 暂无事件的公司压成一行；港股财报日历缺失等说明只提示一次。
    if (emptyGroups.length) {
      lines.push("", `其余 ${emptyGroups.length} 家暂无重大事件：${emptyGroups.map((g) => g.companyName).join("、")}。`);
      const notes = [...new Set(emptyGroups.flatMap((g) => g.reasons || []))];
      if (notes.length) lines.push("", ...notes.map((n) => `> ${n}`));
    }

    if (!withEvents.length && !failures.length) {
      lines.push("", "完成一轮研究后，系统会跟踪该公司的财报与重大新闻，盘前在这里汇总。");
    }

    appendMessage("assistant", lines.join("\n"), { type: "digest" });
  } catch (error) {
    toast(error.message || "暂时无法生成事件提醒。");
  }
}

async function showPortrait() {
  const company = getCompany();
  const panel = getPanel();
  const ticker = company?.ticker || panel?.ticker;
  if (!ticker) {
    toast("先选择一家公司。");
    return;
  }
  try {
    const data = await api(`/api/company/profile?ticker=${encodeURIComponent(ticker)}`);
    // 剥掉 YAML frontmatter（仅用于存储识别，前端展示是噪音）。
    const markdown = String(data.markdown || "").replace(/^---\n[\s\S]*?\n---\n+/, "");
    if (!markdown.trim()) {
      toast("这家公司还没有沉淀画像，完成一轮研究后会自动建立。");
      return;
    }
    // 把画像作为一条特殊助手消息插入对话流，复用现有 Markdown 渲染与滚动。
    appendMessage("assistant", markdown, { type: "portrait", turnCount: data.profile?.turnCount || 0 });
  } catch (error) {
    toast(error.message || "这家公司还没有画像。");
  }
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
    if (session.ticker) {
      const resolved = await resolveCompany(session.ticker);
      if (resolved && !resolved.unresolved && !resolved.unsupported) company = resolved;
    }
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
  const prevCompany = getCompany();
  let company = prevCompany;
  // 没公司时必解析；已有在研公司时只在"强信号"（明确点名另一家公司）下才切换标的。
  // 否则"经营质量怎么样""现金流呢"这类追问会被误判成新公司、解析失败后整轮拒答——
  // 这正是"同一对话没有上下文、连续对话断掉"的根因。强信号涵盖代码/别名/双重上市/
  // 私人公司/带后缀公司名/英文专名，"美光科技怎么样"仍能正常切换。
  const shouldResolve = !company || mentionsNewCompanyStrong(question);
  if (shouldResolve) {
    // 中文名要走一轮 LLM 解析（2–5s），给个明确的"正在识别公司…"微状态，
    // 而不是让用户对着"正在检索和思考"干等、以为卡住了。
    if (isBusy) { busyLabel = "正在识别公司"; render(); }
    const resolved = await resolveCompany(question);
    // A 股（沪深）暂不支持：给专门提示，而不是泛泛的"没识别出"。
    if (resolved?.unsupported) {
      appendMessage(
        "assistant",
        `「${resolved.name}」是 A 股（沪深）。Luvio 目前只覆盖**港股和美股**，这家暂时研究不了。\n\n` +
        `如果它同时在港股或美股上市（很多中概股是双重上市），可以用对应代码再问我，比如港股 **xxxx.HK** 或美股代码。`
      );
      return;
    }
    // 点名了一家公司却解析不出：明确说"没识别出"，绝不拿上一家公司硬答。
    if (resolved?.unresolved) {
      appendMessage(
        "assistant",
        `我去权威数据源（FMP/交易所）查了「${resolved.name}」，没拿到能对上的上市代码，这轮就不硬答了，免得张冠李戴答成别的公司。\n\n` +
        `可以这样再问我一次：\n` +
        `- 美股：直接输代码，如 **MU**、**HOOD**，或写 **$MU**\n` +
        `- 港股：用代码，如 **0700.HK**\n` +
        `- 如果它**刚 IPO**、或是冷门标的（数据源可能还没收录），直接把股票代码发我最稳\n` +
        `- 也可以写更完整、更标准的公司名`
      );
      return;
    }
    if (resolved) company = resolved;
  }
  if (!company) {
    appendMessage("assistant", "我还没有识别出公司。请补充公司名、港股代码或美股代码，例如 0700.HK 腾讯、AAPL 苹果。");
    return;
  }

  // Company switch → start a fresh research session. Each company keeps its own
  // clean history entry, and context never bleeds from the previous company.
  const switched = Boolean(prevCompany?.ticker && company.ticker && company.ticker !== prevCompany.ticker);
  if (switched) {
    const thread = getThread();
    const pending = thread[thread.length - 1];
    setSessionId(null);
    setPanel(null);
    setThread(pending?.role === "user" ? [pending] : []);
    toast(`已切到 ${company.nameZh || company.ticker}，开新研究。`);
  }
  setCompany(company);
  // 双重上市：首次选中时说清楚——同一家公司，基本面走美股 ADR，两地代码都给。
  if (company.dualListing && (switched || !prevCompany?.ticker)) {
    toast(`${company.nameZh} 双重上市：港股 ${company.dualListing.hk}｜美股 ${company.dualListing.us}，基本面按美股 ADR 口径。`);
  }
  // 识别完成，回到通用检索状态再发起主请求。
  if (isBusy) busyLabel = "正在检索和思考";
  render();

  const result = await chatStream({
    question,
    company,
    sessionId: getSessionId(),
    sessionTitle: sessionTitle(question),
    history: apiHistory(question),
    documents: getDocuments(),
    memory: {}
  });
  if (!result) throw new Error("本轮没有返回结果");
  if (result.sessionId) setSessionId(result.sessionId);
  if (result.decisionPanel) setPanel(result.decisionPanel);
  // Enrich bare-ticker companies (e.g. "RKLB" → "Rocket Lab USA") once the
  // backend returns a real name from the FMP profile fetch.
  const enrichedName = result.decisionPanel?.companyName;
  if (enrichedName && company.nameZh === company.ticker && enrichedName !== company.ticker) {
    company = { ...company, nameZh: enrichedName };
    setCompany(company);
  }
  appendMessage("assistant", result.content || "本轮没有生成有效回复。", {
    mode: result.mode,
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    grounding: dataSourceGrounding(result.dataSources),
    completeness: typeof result.decisionPanel?.dataCompleteness === "number" ? result.decisionPanel.dataCompleteness : null,
    missing: Array.isArray(result.decisionPanel?.missingData) ? result.decisionPanel.missingData : [],
    confidence: result.decisionPanel?.confidence || null,
    valuation: result.valuation || null,
    analyst: result.analyst || null,
    evidence: provenanceFromPanel(result.decisionPanel)
  });
  // 长期画像反馈：建档/判断变化时轻提示，让用户感知"研究在沉淀"。
  if (result.positionSaved) toast(`已记账 ${company.nameZh || company.ticker} 的持仓信息。`);
  else if (result.portrait?.created) toast(`已为 ${company.nameZh || company.ticker} 建立长期画像。`);
  else if (result.portrait?.changed) toast(`已更新 ${company.nameZh || company.ticker} 的长期画像（判断有变化）。`);
  await refreshSessions();
  render();
}

function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Default credibility per source type so even keyless official links get a sensible dot.
const TYPE_CRED_DEFAULT = { official: 0.9, industry_research: 0.82, financial_media: 0.72, cn_financial_media: 0.6, market: 0.7, news: 0.55, web: 0.45 };

/** Build clickable provenance cards from the decision panel's sources (official + web). */
function provenanceFromPanel(panel) {
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

function dataSourceLabels(dataSources = {}) {
  const map = { market: "行情", financials: "财报", filings: "公告", news: "新闻", estimates: "预期" };
  return Object.entries(map)
    .filter(([key]) => dataSources?.[key]?.status === "ok")
    .map(([, label]) => label);
}

// 接地条用的逐槽 ✓/✗：固定 4 个核心槽（行情/财报/新闻/预期），公告只在接入时追加，
// 避免美股恒显"公告✗"的噪音。
function dataSourceGrounding(dataSources = {}) {
  const core = [["market", "行情"], ["financials", "财报"], ["news", "新闻"], ["estimates", "预期"]];
  const slots = core.map(([key, label]) => ({ label, ok: dataSources?.[key]?.status === "ok" }));
  if (dataSources?.filings?.status === "ok") slots.push({ label: "公告", ok: true });
  return slots;
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
          <button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="切换深色 / 浅色" title="切换深色 / 浅色">${themeIcon()}</button>
        </nav>
      </header>
      <main>${content}</main>
    </div>`;
}

function nav(path, label) {
  const active = currentRoute() === path;
  return `<a class="${active ? "active" : ""}" href="#${path}">${label}</a>`;
}

function themeIcon() {
  // 浅色时显示月亮（点了变深色），深色时显示太阳。
  return getTheme() === "dark"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
}

const SNAP_ICONS = {
  portrait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.2"/><path d="M5.5 19c0-3.4 2.9-5.2 6.5-5.2s6.5 1.8 6.5 5.2"/></svg>',
  digest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 4.5 2 5.8 2 5.8H4S6 13.5 6 9Z"/><path d="M10 18.5a2 2 0 0 0 4 0"/></svg>',
  "portfolio-view": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M3 12.5h18"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19.5h14"/></svg>'
};

function snapTool(action, label) {
  return `<button class="snapshot-tool" type="button" data-action="${action}" aria-label="${esc(label)}">${SNAP_ICONS[action]}<span>${esc(label)}</span></button>`;
}

function renderSnapshotCard(company, panel, thread) {
  const name = panel?.companyName || company?.nameZh || "未选择公司";
  const ticker = company?.ticker || panel?.ticker || "";
  const marketLabel = ticker ? (/\.HK$|^\d/.test(ticker) ? "港股" : "美股") : "";
  const confLevel = panel?.confidence === "高" ? "high" : panel?.confidence === "低" ? "low" : "mid";
  const confChip = panel?.confidence
    ? `<span class="conf conf-${confLevel}">置信度 ${esc(panel.confidence)}</span>`
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
  const dualNote = dual
    ? `<div class="snapshot-dual" title="同一家公司在港股和美股双重上市；FMP 免费档只覆盖美股 ADR，所以基本面与估值统一按美股口径，行情两地可分别查。">
        <span class="dual-badge">双重上市</span>
        <span class="dual-text">港股 ${esc(dual.hk)}｜美股 ${esc(dual.us)} · 基本面按美股 ADR 口径</span>
      </div>`
    : "";

  const tools = [
    ticker ? snapTool("portrait", "画像") : "",
    snapTool("digest", "事件"),
    snapTool("portfolio-view", "持仓"),
    thread.length ? snapTool("export", "导出") : ""
  ].filter(Boolean).join("");

  return `<section class="research-snapshot">
    <div class="snapshot-head">
      <div class="snapshot-id">
        <p>研究公司</p>
        <h2>${esc(name)}</h2>
        <span>${ticker ? `${esc(ticker)}${marketLabel ? ` · ${marketLabel}` : ""}` : "输入公司名、港股或美股代码"}</span>
      </div>
      ${confChip}
    </div>
    ${dualNote}
    ${quoteBlock}
    ${metricChips}
    <div class="snapshot-tools">${tools}</div>
  </section>`;
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
        ${renderSnapshotCard(company, panel, thread)}
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
          ${streamingActive ? renderStreamingCard() : (isBusy ? renderWaitingCard() : "")}
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
  // 模型已经在推理（思考型模型出答案前的阶段）：显示活的推理字数，比静态骨架更诚实。
  if (reasoningChars > 0 && !streamingActive) return `模型正在推理 · 已 ${reasoningChars} 字`;
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
      <div class="skeleton" aria-hidden="true">
        <div class="sk-line w-95"></div>
        <div class="sk-line w-75"></div>
        <div class="sk-card">
          <div class="sk-line sk-strong w-30"></div>
          <div class="sk-line w-90"></div>
          <div class="sk-line w-65"></div>
        </div>
        <div class="sk-line w-85"></div>
        <div class="sk-line w-55"></div>
      </div>
    </div>
  </article>`;
}

// 流式作答卡：token 边到边写进 #stream-body，末尾跟一个闪烁光标。final 到达后由
// appendMessage 渲染成带估值/分析师/接地条的正式回答卡，本卡随之消失。
function renderStreamingCard() {
  return `<article class="message assistant">
    <div class="bubble answer-card stream-card">
      <div class="answer-brand"><div class="answer-mark"><i></i><span>LUVIO</span></div></div>
      <div class="ans-stream" id="stream-body">${markdownToHtml(streamingText)}<span class="stream-caret"></span></div>
    </div>
  </article>`;
}

function renderComposer(company) {
  const status = isBusy
    ? `${esc(busyLabel)} · 已等待 <b data-busy-seconds>${busyElapsedSeconds()}</b>s`
    : company
      ? `${esc(company.nameZh || company.ticker)} · ${esc(company.ticker)}`
      : "先输入公司名、港股或美股代码";
  return `<form class="composer" data-form="chat">
    <div class="composer-panel">
      <textarea name="query" rows="2" maxlength="1200" placeholder="${company ? "继续追问：利润、护城河、估值或证伪条件" : "输入公司名、港股或美股代码，例如：阿里巴巴最近怎么样？AAPL 赚钱吗？"}"></textarea>
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
    { name: "腾讯", ticker: "0700.HK", market: "港股", q: "腾讯最近怎么样？" },
    { name: "苹果", ticker: "AAPL", market: "美股", q: "苹果赚钱吗？" },
    { name: "英伟达", ticker: "NVDA", market: "美股", q: "英伟达的护城河在哪？" },
    { name: "比亚迪", ticker: "1211.HK", market: "港股", q: "比亚迪靠什么赚钱？" }
  ];
  const caps = ["赚钱机制", "护城河", "竞争格局", "估值赔率", "什么会证伪"];
  return `<div class="empty-chat">
    <div class="hero-head">
      <p class="hero-eyebrow"><span class="hero-spark"></span>LUVIO RESEARCH</p>
      <h2>像研究员一样，<br>聊懂一家公司。</h2>
      <p class="hero-sub">港股与美股，一句话就开始。普通追问给精炼短答，复杂研究再沉到底层。</p>
      <div class="hero-caps">${caps.map((c) => `<span class="cap-pill">${esc(c)}</span>`).join("")}</div>
    </div>
    <div class="example-grid">
      ${examples
        .map(
          (item) => `<button class="example-card" type="button" data-action="example" data-query="${esc(item.q)}">
        <span class="ex-head"><strong>${esc(item.name)}</strong><span class="ex-badge ${item.market === "美股" ? "us" : "hk"}">${esc(item.market)}</span></span>
        <span class="ex-ticker">${esc(item.ticker)}</span>
        <span class="ex-q">${esc(item.q)}</span>
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
  market: "行情",
  news: "新闻",
  web: "网页"
};

function credLevel(score) {
  if (typeof score !== "number") return "mid";
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "mid";
  return "low";
}

function numFrom(value) {
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ── Portfolio panel ──────────────────────────────────────
function fmtPct(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}
function fmtNum(v, digits = 2) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}
function pnlDir(v) {
  return typeof v === "number" && Number.isFinite(v) ? (v > 0 ? "is-up" : v < 0 ? "is-down" : "is-flat") : "is-flat";
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

function renderPortfolioPanel(positions = []) {
  if (!positions.length) {
    return `<p class="pf-empty">还没有记账。点下面按钮，或在对话里说一句即可记录，例如：<strong>耐世特 成本 4.9 持有 3000 股 止损 4.2 止盈 6.5</strong>。</p>
      <div class="pf-actions"><button class="pf-add" type="button" data-action="portfolio-add">＋ 记一笔持仓</button></div>`;
  }
  const noQuote = positions.filter((p) => p.priceStatus !== "ok").length;
  const foot = noQuote
    ? `盘前事件会盯住止损 / 止盈线和大幅回撤。${noQuote} 家暂时取不到实时行情。`
    : "盘前事件会自动盯住这些持仓的止损 / 止盈线和大幅回撤。";
  return `<div class="pf-list">${positions.map(renderPositionCard).join("")}</div>
    <div class="pf-actions"><button class="pf-add" type="button" data-action="portfolio-add">＋ 记一笔持仓</button></div>
    <p class="pf-foot">${foot}</p>`;
}

function renderValuation(valuation) {
  if (!valuation) return "";
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
  const upText = `+${(up * 100).toFixed(0)}%`;
  const downText = `${((bear - price) / price * 100).toFixed(0)}%`;
  const zoneLeft = Math.min(pct(bear), pct(bull));
  const zoneWidth = Math.abs(pct(bull) - pct(bear));

  // 多法交叉验证：有多个口径（PE / Forward PE / FCF / DCF）时显式标出，并把关键
  // 假设折叠在"估值依据"里，让"这个区间怎么来的"可追溯，而不是一个孤零零的数字。
  const methods = Array.isArray(valuation.methods) ? valuation.methods.filter(Boolean) : [];
  const assumptions = Array.isArray(valuation.keyAssumptions) ? valuation.keyAssumptions.filter(Boolean).slice(0, 4) : [];
  const methodsLine = methods.length > 1
    ? `<div class="valuation-methods"><span class="vm-label">多法交叉</span>${methods.map((m) => `<span class="vm-tag">${esc(m)}</span>`).join("")}</div>`
    : "";
  const assumeLine = assumptions.length
    ? `<details class="valuation-assume"><summary>估值依据 · ${assumptions.length} 条</summary><ul>${assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>`
    : "";

  return `<div class="valuation-block">
    <div class="valuation-head"><span>估值区间</span><em>${esc(valuation.method || "PE 法")}</em></div>
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
function renderAnalystConsensus(analyst) {
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
function renderGroundingBar(meta = {}) {
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
        ${isPortfolio ? renderPortfolioPanel(meta.positions) : renderRichAnswer(message.content)}
        ${renderValuation(meta.valuation)}
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
  if (action === "toggle-theme") { toggleTheme(); return; }
  if (action === "export") exportResearch();
  if (action === "portrait") await showPortrait();
  if (action === "digest") await showEventDigest();
  if (action === "portfolio-view") await showPortfolio();
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
  if (action === "delete-position") await deletePortfolioPosition(target.dataset.ticker);
  if (action === "portfolio-add") {
    const input = document.querySelector(".composer textarea");
    if (input) {
      input.value = "<公司名或代码> 成本 <价> 持有 <股数> 股 止损 <价> 止盈 <价>";
      input.focus();
      input.select();
    }
  }
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
