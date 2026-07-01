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
let recentSessions = [];
let sessionsLoaded = false;
let historyOpen = true;
// 看盘：研究过的公司 ∪ 持仓，聚合成关注列表（画像主线 + 今日最重事件 + 价格/盈亏 + 状态）。
let watchDesk = null;
let watchDeskLoaded = false;
// 看盘台个股详情页（/watch/:ticker）：单只股票的完整聚合（卡片 + 画像 + 基本面）。
let watchStock = null;
let watchStockTicker = "";
let watchStockLoading = false;
// 公司页价格曲线的区间：1月 / 3月 / 1年。切换只在前端切片已加载的序列，不再打后端。
let chartRange = "3m";
// 公司页加载序号：用它（而非当前路由）判定"这次加载是否已被更新的加载取代"，
// 避免"点开个股→未加载完就离开→loading 卡死永远转圈"。
let watchStockSeq = 0;
// 看盘"添加关注"输入框状态。
let watchAddOpen = false;
let watchAddBusy = false;
let watchAddError = "";
// 并行会话：每个在跑的请求一条 run（key=sessionId；新研究用 new:<ticker>）。这样推理中可以
// 切到别的对话、甚至并行再发；正在跑的会话在侧栏显示转圈，结果按 key 落回对应会话。
const running = new Map(); // key -> { label, startedAt, reasoningChars, snapshot }
let busyTimer = null;
// 解析阶段（识别公司/对比对象，2-5s）的瞬时指示，不绑定具体 run。
let resolving = false;
let resolvingLabel = "正在检索和思考";
// 流式作答：只渲染"前台（当前激活）"那条 run 的 tokens；切到别的会话后，后台 run 的
// token 不再落到当前视图（避免把 A 的流写进 B）。streamingKey 标记当前在前台流的 run。
let streamingKey = null;
let streamingText = "";

function runKey(sessionId, ticker) { return sessionId || (ticker ? `new:${ticker}` : "new"); }
function activeRunKey() { return runKey(getSessionId(), getCompany()?.ticker); }
function activeRun() { return running.get(activeRunKey()) || null; }
function isActiveBusy() { return running.has(activeRunKey()); }
// 当前视图是否在"忙"（解析阶段 或 当前会话有在跑的 run）——决定是否显示等待/流式卡。
function isViewBusy() { return resolving || isActiveBusy(); }
function snapshotActive() { return { thread: getThread(), company: getCompany(), panel: getPanel(), sessionId: getSessionId() }; }

function startRun(key, label = "正在检索和思考") {
  running.set(key, { label, startedAt: Date.now(), reasoningChars: 0, snapshot: snapshotActive() });
  resolving = false;
  if (!busyTimer) busyTimer = setInterval(updateBusyClock, 1000);
}
function endRun(key) {
  running.delete(key);
  if (streamingKey === key) { streamingKey = null; streamingText = ""; }
  if (!running.size && busyTimer) { clearInterval(busyTimer); busyTimer = null; }
}

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

// 研究开始前生成稳定 sessionId（前缀 s_ 与后端 s_<uuid> 同形）。取代旧的"全程 null、跑完才落库"——
// 那会导致：生成期侧栏没条目、且每条 null 消息后端都 INSERT 新行 → 同公司重复。
function genSessionId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? `s_${crypto.randomUUID()}` : uid("s");
}

// 确保当前视图有稳定 sessionId：有就复用、没有就新生成并落地。研究/对比/深研开始前都先调它，
// 这样 run 全程用真实 id 当键、chat 体带上它 → 后端 ON CONFLICT(id) upsert 同一行（不再重复）。
function ensureSessionId() {
  let id = getSessionId();
  if (!id) { id = genSessionId(); setSessionId(id); }
  return id;
}

// 乐观插入/更新一条本地 session 到侧栏列表（不等服务端）。转圈靠 renderSessionItem 里的
// running.has(id)；服务端刷新时按 id 合并、服务端版覆盖乐观版（见 refreshSessions）。
// 已存在同 id（追问/深研）时保留原标题，只前置 + 标记 optimistic 让它转圈。
function optimisticSession(id, { company, question } = {}) {
  const existing = recentSessions.find((s) => s.id === id);
  const entry = {
    ...existing,
    id,
    title: existing?.title || String(question || "新研究").slice(0, 80),
    question: existing?.question || question || "",
    companyName: company?.nameZh || company?.ticker || existing?.companyName || "",
    ticker: company?.ticker || existing?.ticker || "",
    updatedAt: new Date().toISOString(),
    optimistic: true
  };
  recentSessions = [entry, ...recentSessions.filter((s) => s.id !== id)];
}

function busyElapsedSeconds() {
  const startedAt = activeRun()?.startedAt || 0;
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
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
// key：这条 run 的会话键。只有当它还是"前台"（当前激活会话）时才把 token 渲染到视图；
// 切到别的会话后 token 静默累计、不污染当前视图，final 仍按 key 落回对应会话。
async function chatStream(body, key) {
  let finalResult = null;
  const isFg = () => key && key === activeRunKey(); // 这条 run 此刻是否在前台
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
          if (!isFg()) continue; // 后台 run：静默，不渲染到当前视图
          if (streamingKey !== key) { streamingKey = key; streamingText = ""; render(); }
          streamingText += json.t || "";
          const node = document.getElementById("stream-body");
          if (node) node.innerHTML = `${markdownToHtml(streamingText)}<span class="stream-caret"></span>`;
          // 只在用户本来就贴着底部时才跟随滚动；用户上滚回看时不再被 token 往下拽。
          const conv = document.querySelector(".conversation");
          if (conv && conv.scrollHeight - conv.scrollTop - conv.clientHeight < 120) {
            conv.scrollTo({ top: conv.scrollHeight });
          }
        } else if (evt === "reasoning") {
          // 推理期：累计字数到这条 run；前台时等待卡的 phase 行（1s tick）会读出来。
          const r = running.get(key);
          if (r) r.reasoningChars += json.n || 0;
          if (isFg()) updateBusyClock();
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
    if (streamingKey === key) { streamingKey = null; streamingText = ""; }
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

async function resolveCompany(query, opts = {}) {
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
  if (!company && us) {
    // 别名表命中（带真名，us.name!==ticker）→ 信任短路，不加 verify 延迟。
    // 裸代码/显式记法（us.name===ticker，纯猜）才在研究前过 verify 闸门，挡住 DRUM 这种打错的码。
    const needsVerify = opts.verify && us.name === us.ticker;
    if (!needsVerify) return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
    try {
      const v = await api(`/api/companies/verify?ticker=${encodeURIComponent(us.ticker)}`);
      if (v.status === "verified") return { ticker: us.ticker, nameZh: v.name || us.ticker, nameEn: v.name || "", industry: "美股" };
      if (v.status === "not_found") return { unverifiedTicker: us.ticker, suggestions: v.suggestions || [] };
      // status === "error"（FMP 限流/网络）→ 信任用户放行，避免误杀刚 IPO 的新股（"新上市自愈"）。
    } catch { /* verify 不可用 → 放行 */ }
    return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
  }
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

async function refreshWatchDesk() {
  try {
    const data = await api("/api/watch/desk");
    watchDesk = data.desk || null;
  } catch {
    watchDesk = null;
  } finally {
    watchDeskLoaded = true;
  }
}

async function refreshSessions() {
  try {
    const data = await api("/api/research/sessions?limit=30");
    const server = data.sessions || [];
    const serverIds = new Set(server.map((s) => s.id));
    // 按 id 合并：仍在跑、服务端还没落库的乐观条目（在途新研究）留在最前并继续转圈；
    // 服务端版覆盖同 id 乐观版（跑完即被真实数据替换）。
    const pending = recentSessions.filter((s) => s.optimistic && running.has(s.id) && !serverIds.has(s.id));
    recentSessions = [...pending, ...server];
    // Only reset if our active session was explicitly deleted server-side:既不在服务端、
    // 也不在跑（不是在途乐观）才算被删。绝不因列表为空或在途未落库就清掉在研线程。
    const activeId = getSessionId();
    if (activeId && server.length && !serverIds.has(activeId) && !running.has(activeId)) {
      setSessionId(null);
    }
  } catch {
    // 拉取失败：保留现有列表（含在途乐观条目），别让侧栏闪没。
  } finally {
    sessionsLoaded = true;
  }
}

function appendMessage(role, content, meta = {}, opts = {}) {
  const message = { id: uid("msg"), role, content, meta, createdAt: new Date().toISOString() };
  // 流式→最终切换时（keepScroll）：把已经流出来的文字原地定格，不要滚到底——否则用户正
  // 读着就被甩到下面（接地条骨架已占好高度，正文位置稳定，只需保住当前 scrollTop）。
  const conv = document.querySelector(".conversation");
  const prevTop = conv?.scrollTop ?? 0;
  setThread([...getThread(), message]);
  render();
  requestAnimationFrame(() => {
    const c = document.querySelector(".conversation");
    if (!c) return;
    if (opts.keepScroll) { c.scrollTop = prevTop; return; }
    c.scrollTo({ top: 999999, behavior: "smooth" });
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

function clearResearch() {
  // 不动后台在跑的 run（并行）。只把当前视图切到一个干净的新研究。
  setThread([]);
  setPanel(null);
  setCompany(null);
  setDocuments([]);
  setSessionId(null);
  toast("已新建研究。");
  location.hash = "#/research";
  render();
  // 后台刷新盯盘台，让刚结束的那轮研究即时出现在首页/看盘台。
  void refreshWatchDesk();
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
  if (!id) return;
  // 切到一个仍在生成的会话：从 run 快照恢复（含待答问题 + 等待/流式卡），不去拉服务端旧状态
  // （服务端要等它完成才有新答案）。这让"推理中切走再切回"看到的是正在跑、而不是空。
  const run = running.get(id);
  if (run?.snapshot) {
    const s = run.snapshot;
    setSessionId(s.sessionId || id);
    setCompany(s.company);
    setPanel(s.panel);
    setThread(s.thread);
    location.hash = "#/research";
    render();
    return;
  }
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
    location.hash = "#/research";
    toast("已恢复历史研究。");
    render();
  } catch (error) {
    toast(error.message || "恢复历史失败。");
  }
}

async function deleteSession(id) {
  if (!id) return;
  if (running.has(id)) { toast("这条研究正在生成，完成后再删。"); return; }
  const item = recentSessions.find((session) => session.id === id);
  const title = item?.title || item?.question || "这条研究";
  const ok = window.confirm(`删除“${title}”？\n\n这会从本地 SQLite 里移除这条历史研究。`);
  if (!ok) return;
  try {
    await api(`/api/research/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (getSessionId() === id) {
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
  if (!recentSessions.length) return;
  if (running.size) { toast("有研究正在生成，完成后再清空。"); return; }
  const ok = window.confirm("清空全部历史研究？\n\n这会删除本地 SQLite 里的所有历史记录。");
  if (!ok) return;
  try {
    await api("/api/research/sessions", { method: "DELETE" });
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

// 从问句里抠掉"当前公司"的名字/代码，剩下的拿去解析对比对象（另一家）。
function stripCompanyMentions(query = "", company = null) {
  if (!company) return query;
  let out = String(query);
  for (const token of [company.nameZh, company.nameEn, company.ticker].filter(Boolean)) {
    out = out.split(token).join(" ");
  }
  return out;
}

// 对比意图：句子在做横向比较（"和X比/对比/vs/谁更…/哪个更…"）。配合"点名了另一家公司"
// 一起判断，避免把"它和去年比怎么样"这种纵向追问也当成公司对比。
function isComparisonQuestion(query = "") {
  return /对比|相比|[和跟与][^，。？?]{1,14}(比|对比|相比|谁|哪个|哪家)|\bvs\b|谁(更|的)|哪(个|家)(更|的)?[^，。？?]{0,8}(好|强|贵|便宜|划算|赔率|值得)/i.test(String(query));
}

// 多持仓/多标的问句："列举（和/、…）+ 持仓信号"或"≥2 个'股'"。与后端 entityExtractor.looksMultiHolding
// 保持一致：检测到就让它作为当前公司的追问直发，后端补齐其他标的，避免被误判成切换/对比而跳走。
function isMultiHoldingQuestion(query = "") {
  const text = String(query || "");
  if (text.length < 4) return false;
  const multiShare = (text.match(/股/g) || []).length >= 2;
  const hasList = /[、,，&]|和|与|跟|以及|还有|及/.test(text);
  const holdingHint = /持有|持仓|组合|仓位|分别|各|股票|加上|拿着|拿了|都拿|买了|买入|入手|加仓|建仓|都有|手里|手上/.test(text);
  return multiShare || (hasList && holdingHint);
}

// 从一次 chat 结果构造助手消息的 meta（接地条/估值/分析师/证据卡/置信度）。
// sendChat 与对话内对比 runComparison 共用，保证两条路径渲染一致。
function answerMetaFromResult(result) {
  return {
    mode: result.mode,
    webCount: result.webEvidence?.evidence?.length ?? 0,
    sources: dataSourceLabels(result.dataSources),
    grounding: dataSourceGrounding(result.dataSources),
    completeness: typeof result.decisionPanel?.dataCompleteness === "number" ? result.decisionPanel.dataCompleteness : null,
    missing: Array.isArray(result.decisionPanel?.missingData) ? result.decisionPanel.missingData : [],
    confidence: result.decisionPanel?.confidence || null,
    valuation: result.valuation || null,
    // ① 估值被护栏抑制时的诚实说明（前端出一行"数据不足"，而非静默无卡）。
    valuationNote: result.valuationNote || null,
    // ② 底部主估值条归属的公司名（多公司轮里消歧）。
    valuationName: result.valuationName || null,
    analyst: result.analyst || null,
    comparison: result.comparison || null,
    // ② 本轮识别到的其他标的（各带紧凑估值/盈亏），用于"本轮聚焦"多卡渲染。
    otherHoldings: Array.isArray(result.otherHoldings) ? result.otherHoldings : null,
    // B2 港美双上市：港股口径实时价 + HKD 盈亏（asked=HK 且拉到才有）。
    dualQuote: result.dualQuote || null,
    evidence: provenanceFromPanel(result.decisionPanel)
  };
}

// 把一次结果落地：若这条 run 仍在前台（当前会话）→ 更新视图并 appendMessage；否则它已在
// 后台完成、服务端已存 → 只提示+刷新侧栏，不动当前视图（并行对话的核心路由）。
function applyChatResult(result, key, company) {
  const label = company?.nameZh || company?.ticker || "研究";
  if (key === activeRunKey()) {
    if (result.sessionId) setSessionId(result.sessionId);
    if (result.decisionPanel) setPanel(result.decisionPanel);
    const enrichedName = result.decisionPanel?.companyName;
    if (company && enrichedName && company.nameZh === company.ticker && enrichedName !== company.ticker) {
      setCompany({ ...company, nameZh: enrichedName });
    }
    appendMessage("assistant", result.content || "本轮没有生成有效回复。", answerMetaFromResult(result), { keepScroll: true });
    if (result.positionSaved) toast(`已记账 ${label} 的持仓信息。`);
    else if (result.portrait?.created) toast(`已为 ${label} 建立长期画像。`);
    else if (result.portrait?.changed) toast(`已更新 ${label} 的长期画像（判断有变化）。`);
    return true;
  }
  toast(`${label} 的研究完成了，点左侧查看。`);
  return false;
}

// 推荐选项消息：检测到对比意图时，不直接切换/直接答，弹一条带按钮的助手消息让用户选。
function appendCompareChoice(current, target) {
  const cName = current.nameZh || current.ticker;
  const tName = target.nameZh || target.ticker;
  appendMessage("assistant", "", {
    type: "choice",
    choice: {
      prompt: `你是想把 ${cName} 和 ${tName} 做对比，还是改为只研究 ${tName}？`,
      options: [
        { label: `在本对话里对比：${cName} vs ${tName}`, hint: "拉两家真实数据并排比，不跳走", act: "compare", ticker: target.ticker, name: tName, recommended: true },
        { label: `只研究 ${tName}`, hint: "切换到新公司、开新研究", act: "switch", ticker: target.ticker, name: tName }
      ]
    }
  });
}

// did-you-mean 纠错卡：裸代码没在美股主板查到（打错的码）→ 不硬研究，弹候选 + 退路。
// 候选按钮研究确认过的真票；退路"仍按 X 研究"兜冷门/刚 IPO 还没被收录的票。
function appendDidYouMeanChoice(badTicker, suggestions = []) {
  const options = suggestions.slice(0, 4).map((s, i) => ({
    label: `研究 ${s.ticker}${s.name && s.name !== s.ticker ? ` · ${s.name}` : ""}`,
    hint: "你可能想找这家",
    act: "research",
    ticker: s.ticker,
    name: s.name || s.ticker,
    recommended: i === 0
  }));
  options.push({ label: `仍按 ${badTicker} 研究`, hint: "冷门 / 刚 IPO 的票数据源可能还没收录", act: "force", ticker: badTicker, name: badTicker });
  appendMessage("assistant", "", {
    type: "choice",
    choice: {
      prompt: suggestions.length
        ? `我没在美股主板查到代码 ${badTicker}，你是不是想找下面这些？也可以直接输更完整的公司名，或港股 xxxx.HK / 正确的美股代码。`
        : `我没在美股主板查到代码 ${badTicker}。可以换个写法：输更完整的公司名，或港股 xxxx.HK / 正确的美股代码；确认没打错就点"仍按 ${badTicker} 研究"。`,
      options
    }
  });
}

// 纠错卡"研究某候选"：候选是确认过的真票，直接带已知公司进研究（跳过再 verify）。
async function researchSuggested(ticker, name) {
  if (!ticker || isViewBusy()) return;
  const company = { ticker, nameZh: name || ticker, nameEn: name || "", industry: "美股" };
  const q = `${name || ticker}最近怎么样？`;
  appendMessage("user", q);
  resolving = true; resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    resolving = false;
    render();
  }
}

// 纠错卡"仍按 X 研究"：用户坚持研究这个未校验代码（冷门/新票）→ 绕过 verify 闸门直接研究。
async function forceResearch(ticker) {
  if (!ticker || isViewBusy()) return;
  const company = { ticker, nameZh: ticker, nameEn: ticker, industry: "美股" };
  const q = `研究 ${ticker}`;
  appendMessage("user", q);
  resolving = true; resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(q, company);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    resolving = false;
    render();
  }
}

// 对话内对比：在当前对话里把当前公司与目标公司并排比较（带 compareWith，后端会把目标
// 那家也跑一遍数据塞进 prompt）。答案落在当前线程，不跳页、不新开对话。
async function runComparison(target) {
  const current = getCompany();
  if (!current?.ticker || isViewBusy()) return;
  const question = `把 ${current.nameZh || current.ticker} 和 ${target.name} 做个对比`;
  appendMessage("user", question);
  const sessionId = ensureSessionId();
  optimisticSession(sessionId, { company: current, question });
  const key = runKey(sessionId, current.ticker);
  startRun(key, "正在对比两家公司");
  render();
  try {
    const result = await chatStream({
      question,
      company: current,
      compareWith: { ticker: target.ticker, nameZh: target.name },
      sessionId,
      sessionTitle: sessionTitle(question),
      history: apiHistory(question),
      documents: getDocuments(),
      memory: {}
    }, key);
    if (result) applyChatResult(result, key, current);
    else if (key === activeRunKey()) appendMessage("assistant", "本轮没有生成对比。");
  } catch (error) {
    if (key === activeRunKey()) appendMessage("assistant", `这轮对比失败：${error.message || "未知错误"}。`);
  } finally {
    endRun(key);
    await refreshSessions();
    render();
  }
}

// "只研究新公司"：走正常 sendChat 切换路径（会触发软分隔+留退路；sendChat 自己管 run 生命周期）。
async function switchAndResearch(target) {
  if (isViewBusy()) return;
  const q = `${target.name}最近怎么样？`;
  appendMessage("user", q);
  resolving = true; resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(q);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    resolving = false;
    render();
  }
}

// 软分隔上的"回到上一家"：优先恢复那家最近的历史会话，没有就直接切回开新研究。
async function returnToCompany(ticker, name) {
  if (!ticker) return;
  const sess = recentSessions.find((s) => s.ticker === ticker);
  if (sess) { await loadSession(sess.id); return; }
  // 找不到历史会话 → 明确新建一条干净研究（稳定 id），不再遗留 null。否则下一句追问会以
  // null 落库另起一条重复行（问题 3 的 returnToCompany 分支根因）。
  setSessionId(genSessionId());
  setPanel(null);
  setThread([]);
  setCompany({ ticker, nameZh: name || ticker, industry: marketLabelOf(ticker) });
  location.hash = "#/research";
  render();
}

// preResolved：已确定的公司（did-you-mean 选了候选 / "仍按 X 研究"），跳过解析与 verify 闸门，
// 直接进研究流程。普通调用 preResolved=null，照常解析。
async function sendChat(question, preResolved = null) {
  const prevCompany = getCompany();
  let company = preResolved || prevCompany;
  if (!preResolved) {
  const multiHolding = Boolean(prevCompany?.ticker) && isMultiHoldingQuestion(question);
  // 多持仓/多标的问句（"我持有 A 和 B…能赚钱吗"）：保持当前在研公司为主，跳过切换/对比选择卡，
  // 直接当作对当前公司的追问发送；后端 extractOtherHoldings 会补齐其他标的（otherHoldings）。
  if (!multiHolding) {
  // 对比意图：已有在研公司 + 句子在做对比 + 点名了另一家公司 → 不直接切换/不直接答，
  // 弹推荐选项，让用户选"在本对话里对比"还是"只研究新公司"（避免突然跳走/张冠李戴）。
  if (prevCompany?.ticker && isComparisonQuestion(question) && mentionsNewCompanyStrong(question)) {
    resolving = true; resolvingLabel = "正在识别对比对象"; render();
    // 关键：要解析的是**另一家**公司，不是当前这家。先把当前公司的名字/代码从问句里抠掉，
    // 否则 "苹果和英伟达比" 会先命中"苹果"(=当前公司) → 误判成非对比、落回普通追问。
    const target = await resolveCompany(stripCompanyMentions(question, prevCompany));
    if (target?.ticker && target.ticker !== prevCompany.ticker) {
      appendCompareChoice(prevCompany, target);
      return;
    }
    // 解析不出 / 就是当前公司 → 落回常规流程（当作对当前公司的追问）。
  }
  // 没公司时必解析；已有在研公司时只在"强信号"（明确点名另一家公司）下才切换标的。
  // 否则"经营质量怎么样""现金流呢"这类追问会被误判成新公司、解析失败后整轮拒答——
  // 这正是"同一对话没有上下文、连续对话断掉"的根因。强信号涵盖代码/别名/双重上市/
  // 私人公司/带后缀公司名/英文专名，"美光科技怎么样"仍能正常切换。
  const shouldResolve = !company || mentionsNewCompanyStrong(question);
  if (shouldResolve) {
    // 中文名要走一轮 LLM 解析（2–5s），给个明确的"正在识别公司…"微状态，
    // 而不是让用户对着"正在检索和思考"干等、以为卡住了。
    resolving = true; resolvingLabel = "正在识别公司"; render();
    const resolved = await resolveCompany(question, { verify: true });
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
    // 裸代码没在美股主板查到（DRUM 这种打错的）→ 弹纠错卡（候选 + 退路），不硬研究、不崩。
    if (resolved?.unverifiedTicker) {
      appendDidYouMeanChoice(resolved.unverifiedTicker, resolved.suggestions);
      return;
    }
    if (resolved) company = resolved;
  }
  } // end if (!multiHolding)
  } // end if (!preResolved)
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
    // 软分隔：新线程顶部放一条"已从 X 切到 Y · 点此回到 X"，切换不突兀且留退路。
    const divider = {
      id: uid("msg"), role: "assistant", content: "",
      meta: { type: "switch-divider", from: { ticker: prevCompany.ticker, name: prevCompany.nameZh || prevCompany.ticker }, to: { name: company.nameZh || company.ticker } },
      createdAt: new Date().toISOString()
    };
    setThread(pending?.role === "user" ? [divider, pending] : [divider]);
  }
  setCompany(company);
  // 双重上市：首次选中时说清楚——同一家公司，基本面走美股 ADR，两地代码都给。
  if (company.dualListing && (switched || !prevCompany?.ticker)) {
    toast(`${company.nameZh} 双重上市：港股 ${company.dualListing.hk}｜美股 ${company.dualListing.us}，基本面按美股 ADR 口径。`);
  }
  // 识别完成 → 研究开始前先落地稳定 sessionId（新研究/切换后都是全新一条），run 全程用它当键、
  // chat 体带上它 → 后端 upsert 同一行；并乐观插入侧栏 → 新研究立刻出现（转圈），不等服务端。
  // 推理中可切到别的对话、并行再发；结果按 key 落回对应会话（见 applyChatResult）。
  const sessionId = ensureSessionId();
  optimisticSession(sessionId, { company, question });
  const key = runKey(sessionId, company.ticker);
  startRun(key, "正在检索和思考");
  render();
  try {
    const result = await chatStream({
      question,
      company,
      sessionId,
      sessionTitle: sessionTitle(question),
      history: apiHistory(question),
      documents: getDocuments(),
      memory: {}
    }, key);
    if (result) applyChatResult(result, key, company);
    else if (key === activeRunKey()) appendMessage("assistant", "本轮没有生成有效回复。");
  } finally {
    endRun(key);
    // 统一对账侧栏：成功→服务端真实条目替换乐观版；失败（纯新研究没落库）→死乐观条目被剪掉。
    // 放在 endRun 之后、render 之前——一次 render 直接到位，无中间闪动。
    await refreshSessions();
    render();
  }
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
  if (isViewBusy()) return;
  const company = getCompany();
  const thread = getThread();
  if (!company) {
    toast("先输入公司或股票代码。");
    return;
  }

  const lastQuestion = [...thread].reverse().find((m) => m.role === "user")?.content || `分析 ${company.ticker}`;
  const sessionId = ensureSessionId();
  optimisticSession(sessionId, { company, question: lastQuestion });
  const key = runKey(sessionId, company.ticker);
  startRun(key, "正在生成深度研究");
  render();
  try {
    const result = await api("/api/report/generate", {
      method: "POST",
      body: JSON.stringify({
        question: lastQuestion,
        company,
        sessionId,
        sessionTitle: sessionTitle(lastQuestion),
        documents: getDocuments(),
        history: thread.slice(-16).map((m) => ({ role: m.role, content: m.content })),
        memory: {}
      })
    });
    if (key === activeRunKey()) {
      if (result.sessionId) setSessionId(result.sessionId);
      if (result.decisionPanel) setPanel(result.decisionPanel);
      appendMessage("assistant", result.markdown || "深度研究没有生成有效内容。", { type: "deep_research", mode: result.mode, model: result.model }, { keepScroll: true });
    } else {
      toast(`${company.nameZh || company.ticker} 的深度研究完成了，点左侧查看。`);
    }
  } catch (error) {
    if (key === activeRunKey()) appendMessage("assistant", `深度研究失败：${error.message || "未知错误"}。`);
  } finally {
    endRun(key);
    await refreshSessions();
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

// /watch/:ticker 里的 ticker（可能带 .HK 点号，hash 路径里不需要转义）。
function routeTicker() {
  const route = currentRoute();
  const m = route.match(/^\/watch\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : "";
}

function shell(content) {
  app.innerHTML = `
    <div class="app">
      <header class="topbar">
        <a class="brand" href="#/" aria-label="Luvio 研究"><span>L</span><strong>Luvio</strong><em>Research</em></a>
        <nav>
          ${nav("/research", "研究")}
          ${nav("/watch", "看盘")}
          ${nav("/settings", "设置")}
          <button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="切换深色 / 浅色" title="切换深色 / 浅色">${themeIcon()}</button>
        </nav>
      </header>
      <main>${content}</main>
    </div>`;
}

function nav(path, label) {
  const route = currentRoute();
  // 落地页 "/" 就是研究页，所以研究 Tab 在 "/" 与 "/research" 都高亮。
  const active = path === "/research"
    ? route === "/" || route === "/research" || route.startsWith("/research/")
    : route === path || route.startsWith(`${path}/`);
  return `<a class="${active ? "active" : ""}" href="#${path}">${label}</a>`;
}

function themeIcon() {
  // 浅色时显示月亮（点了变深色），深色时显示太阳。
  return getTheme() === "dark"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
}

const EXPORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19.5h14"/></svg>';

// 市场标签：港股（数字/.HK）/ 美股（其余）。代码缺省返回空串。
function marketLabelOf(ticker = "") {
  if (!ticker) return "";
  return /\.HK$|^\d/.test(ticker) ? "港股" : "美股";
}

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
  const confChip = panel?.confidence
    ? `<span class="conf conf-${confLevel}">置信度 ${esc(panel.confidence)}</span>`
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
            <span>${esc(companySubtitle(company))} </span>
          </div>
          ${thread.length ? `<button class="desk-export-btn" type="button" data-action="export" aria-label="导出研究" title="导出研究">${EXPORT_ICON}</button>` : ""}
        </div>` : ""}
        <div class="conversation ${hasResearch ? "" : "is-empty"}">
          ${thread.length ? thread.map(renderMessage).join("") : renderEmptyState()}
          ${(streamingKey && streamingKey === activeRunKey()) ? renderStreamingCard() : (isViewBusy() ? renderWaitingCard() : "")}
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
  const isRunning = running.has(session.id); // 这条会话正在后台生成 → 显示转圈
  return `<div class="session-item ${active ? "is-active" : ""} ${isRunning ? "is-running" : ""}">
    <button class="session-open" type="button" data-action="load-session" data-id="${esc(session.id)}">
      <strong>${esc(title)}</strong>
      <span>${isRunning ? '<i class="session-spin" aria-hidden="true"></i>正在生成…' : esc(company)}</span>
    </button>
    ${isRunning ? "" : `<button class="session-delete" type="button" data-action="delete-session" data-id="${esc(session.id)}" aria-label="删除历史研究">×</button>`}
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
  const rc = activeRun()?.reasoningChars || 0;
  const streaming = streamingKey && streamingKey === activeRunKey();
  if (rc > 0 && !streaming) return `模型正在推理 · 已 ${rc} 字`;
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
        <strong>${esc(activeRun()?.label || resolvingLabel)}</strong>
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

// 接地条骨架：流式期先占住接地条的位置（同结构、同高度，灰色 pending 态）。final 到达后
// 真接地条原地替换它——高度不变，正文不会被往下顶，消除"看着看着卡片闪到下面"。
const GROUNDING_PENDING_SLOTS = ["行情", "财报", "新闻", "预期"];
function renderGroundingSkeleton() {
  const chips = GROUNDING_PENDING_SLOTS
    .map((label) => `<span class="ground-chip pending">${label}<i>·</i></span>`)
    .join("");
  return `<div class="grounding-bar grounding-pending" aria-hidden="true">${chips}<span class="ground-complete pending">完整度 —</span></div>`;
}

// 流式作答卡：token 边到边写进 #stream-body，末尾跟一个闪烁光标。final 到达后由
// appendMessage 渲染成带估值/分析师/接地条的正式回答卡，本卡随之消失。顶部预留接地条骨架。
function renderStreamingCard() {
  return `<article class="message assistant">
    <div class="bubble answer-card stream-card">
      <div class="answer-brand"><div class="answer-mark"><i></i><span>LUVIO</span></div></div>
      ${renderGroundingSkeleton()}
      <div class="ans-stream" id="stream-body">${markdownToHtml(streamingText)}<span class="stream-caret"></span></div>
    </div>
  </article>`;
}

function renderComposer(company) {
  const status = isViewBusy()
    ? `${esc(activeRun()?.label || resolvingLabel)} · 已等待 <b data-busy-seconds>${busyElapsedSeconds()}</b>s`
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

// ── Watch (看盘：关注列表 + 公司页) ───────────────────────
const WD_STATUS = {
  falsified: { label: "已触发证伪", cls: "wd-falsified" },
  at_risk: { label: "有风险", cls: "wd-risk" },
  intact: { label: "逻辑还在", cls: "wd-intact" }
};

// changePct 已是百分数（如 -3.1），不再 ×100；returnPct 是小数，走 fmtPct。
function wdChg(p) {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const dir = p > 0 ? "is-up" : p < 0 ? "is-down" : "is-flat";
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return { text: `${sign}${Math.abs(p).toFixed(1)}%`, dir };
}

function wdWhen(date) {
  const s = String(date || "");
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "今天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ── 看盘瘦列表（替代原盯盘卡墙）：一行一家，扫一眼 + 点进公司页 ──
const WL_CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const WL_X = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
// 失败占位/无信息的主线不配当"一句话摘要"，跳过它退回事件。
const WL_BAD_THESIS = /不可用|无法形成|暂无|尚未|待补充/;

// 每行：状态点 · 名称 · 代码 · 市场 ·（紧急时才显示状态标）· 一句摘要 …… 现价 · 涨跌 · 持有盈亏 · 悬停×移除。
function renderWatchRow(c) {
  const st = WD_STATUS[c.status] || WD_STATUS.intact;
  const mkt = c.market === "US" ? `<span class="ex-badge us">美股</span>` : `<span class="ex-badge hk">港股</span>`;
  // intact 靠圆点 + 左沿颜色表达即可，不再多贴一个状态标签（克制）；falsified/at_risk 才点名。
  const statusPill = c.status !== "intact" ? `<span class="wd-status ${st.cls}">${st.label}</span>` : "";
  // 一句摘要：优先我的投资主线（中文、干净）；主线是失败占位就退回今日事件（去掉" - 来源"后缀）。
  let sec = c.thesis && !WL_BAD_THESIS.test(c.thesis) ? c.thesis : "";
  if (!sec && c.topEvent?.title) sec = c.topEvent.title.replace(/\s+[-–—]\s+[^-–—]*$/, "").trim();
  const secondary = sec ? `<span class="wl-thesis">${esc(sec)}</span>` : "";

  let quote;
  if (c.priceStatus === "ok" && c.price != null) {
    const chg = wdChg(c.changePct);
    quote = `<span class="wl-price">${fmtNum(c.price)}</span>${chg ? `<span class="wd-chg ${chg.dir}">${chg.text}</span>` : ""}`;
  } else if (c.priceStatus === "loading") {
    quote = `<span class="wd-noquote">加载中…</span>`;
  } else {
    quote = `<span class="wd-noquote">现价暂不可用</span>`;
  }
  const pnl = c.held && typeof c.returnPct === "number"
    ? `<span class="wl-pnl">持有 <b class="${pnlDir(c.returnPct)}">${fmtPct(c.returnPct)}</b></span>`
    : `<span class="wl-pnl"></span>`;

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
        ${secondary}
      </span>
      <span class="wl-quote">${quote}</span>
      ${pnl}
      <span class="wl-chev">${WL_CHEVRON}</span>
    </button>
    <button class="wl-x" type="button" data-action="untrack-stock" data-ticker="${esc(c.ticker)}" aria-label="移出关注：${esc(c.companyName)}" title="移出关注">${WL_X}</button>
  </div>`;
}

// "添加关注"输入框：输公司名或代码 → 复用研究页的 resolveCompany 解析 → track。
function renderWatchAddForm() {
  return `<form class="wl-add" data-form="watch-add">
    <input name="q" type="text" autocomplete="off" spellcheck="false" placeholder="公司名或代码，如 苹果 / AAPL / 0700.HK" ${watchAddBusy ? "disabled" : ""} />
    <button class="wl-add-submit" type="submit" ${watchAddBusy ? "disabled" : ""}>${watchAddBusy ? "添加中…" : "添加"}</button>
    <button class="wl-add-cancel" type="button" data-action="watch-add-close">取消</button>
    ${watchAddError ? `<span class="wl-add-error">${esc(watchAddError)}</span>` : ""}
  </form>`;
}

function renderWatchList(desk, { heading = "" } = {}) {
  const cards = Array.isArray(desk.cards) ? desk.cards : [];
  const counts = desk.counts || {};
  const bits = [];
  if (counts.falsified) bits.push(`<span class="wd-count wd-falsified">${counts.falsified} 已触发证伪</span>`);
  if (counts.atRisk) bits.push(`<span class="wd-count wd-risk">${counts.atRisk} 有风险</span>`);
  bits.push(`<span class="wd-count wd-intact">${counts.intact || 0} 逻辑还在</span>`);

  return `<div class="watchdesk">
    <div class="wd-head">
      <div>
        <p class="hero-eyebrow"><span class="hero-spark"></span>看盘</p>
        <h2 class="wd-title">${esc(heading || `你在盯的 ${counts.total || cards.length} 家公司`)}</h2>
      </div>
      <div class="wd-summary">
        ${bits.join("")}
        <button class="wd-portfolio-link" type="button" data-action="portfolio-view">我的持仓</button>
        <button class="wd-portfolio-link wl-add-btn" type="button" data-action="watch-add-open">＋ 添加</button>
      </div>
    </div>
    ${watchAddOpen ? `<div class="wl-addbar">${renderWatchAddForm()}</div>` : ""}
    <div class="wl-list">${cards.map(renderWatchRow).join("")}</div>
  </div>`;
}

// 关注列表为空（新用户，零研究零持仓）时的引导卡：去研究，或直接手动添加代码。
function renderWatchEmptyCta() {
  return `<div class="wd-empty-cta">
    <p class="hero-eyebrow"><span class="hero-spark"></span>看盘</p>
    <h2>还没有可盯的公司</h2>
    <p>完成一轮研究，或记一笔持仓，公司就会自动出现在这里，跟踪它的画像、事件、涨跌和价格曲线。</p>
    <a class="primary" href="#/research">去研究一家公司</a>
    <div class="wl-empty-add">${watchAddOpen ? renderWatchAddForm() : `<button class="wl-linkbtn" type="button" data-action="watch-add-open">或直接添加代码关注 →</button>`}</div>
  </div>`;
}

// ── 看盘：无 ticker → 关注列表；有 ticker → 公司页 ──
function renderWatchPage() {
  const ticker = routeTicker();
  if (!ticker) {
    shell(`<div class="page-wide">${renderWatchListBody()}</div>`);
    return;
  }
  if (watchStockTicker !== ticker && !watchStockLoading) void loadWatchStock(ticker);
  shell(`<div class="page-wide">${renderStockPage(ticker)}</div>`);
}

function renderWatchListBody() {
  if (watchDesk && Array.isArray(watchDesk.cards) && watchDesk.cards.length) {
    return renderWatchList(watchDesk, { heading: `${watchDesk.counts?.total || watchDesk.cards.length} 只关注中的股票` });
  }
  if (!watchDeskLoaded) return `<div class="wd-loading">正在加载看盘…</div>`;
  return renderWatchEmptyCta();
}

async function loadWatchStock(ticker) {
  if (!ticker) return;
  const seq = ++watchStockSeq;
  watchStockLoading = true;
  watchStockTicker = ticker;
  watchStock = null;
  chartRange = "3m"; // 每次打开新公司回到默认区间
  try {
    const data = await api(`/api/watch/stock?ticker=${encodeURIComponent(ticker)}`);
    if (seq === watchStockSeq) watchStock = data.stock || null;
  } catch {
    if (seq === watchStockSeq) watchStock = null;
  } finally {
    // 只有最新一次加载才负责收尾（清 loading）；被取代的旧加载直接作废，不会卡死。
    if (seq === watchStockSeq) watchStockLoading = false;
    render();
  }
}

// 重算列表顶部的状态计数（乐观增删后本地对齐，等后台刷新再校准）。
function recountDesk() {
  if (!watchDesk || !Array.isArray(watchDesk.cards)) return;
  const cards = watchDesk.cards;
  watchDesk.counts = {
    falsified: cards.filter((c) => c.status === "falsified").length,
    atRisk: cards.filter((c) => c.status === "at_risk").length,
    intact: cards.filter((c) => c.status === "intact").length,
    total: cards.length
  };
}

// 添加关注：复用研究页的 resolveCompany（名/代码/双重上市都能解），解出 ticker 再 track。
// 整盘刷新慢（要重建所有卡的行情/事件），所以乐观插一张最小卡立即可见，后台再补齐。
async function addWatch(q) {
  if (!q || watchAddBusy) return;
  watchAddBusy = true; watchAddError = ""; render();
  try {
    const company = await resolveCompany(q, { verify: true });
    const ticker = company && company.ticker;
    if (ticker) {
      await api("/api/watch/track", { method: "POST", body: JSON.stringify({ ticker, name: company.nameZh || ticker }) });
      watchAddOpen = false; watchAddError = ""; watchAddBusy = false;
      if (watchDesk && Array.isArray(watchDesk.cards) && !watchDesk.cards.some((c) => c.ticker === ticker)) {
        const market = /\.HK$/i.test(ticker) || /^\d{3,5}$/.test(ticker) ? "HK" : "US";
        watchDesk.cards.unshift({ ticker, companyName: company.nameZh || ticker, market, status: "intact", priceStatus: "loading", held: false });
        recountDesk();
      }
      render();
      void refreshWatchDesk().then(render); // 后台对账，不阻塞
      return;
    }
    watchAddError = company && company.unsupported
      ? `${company.name || q} 看起来是 A 股，目前只支持港股 / 美股`
      : `没识别出「${q}」，换个代码试试，如 AAPL、0700.HK`;
  } catch {
    watchAddError = "添加失败，请重试";
  }
  watchAddBusy = false; render();
  if (watchAddOpen) document.querySelector(".wl-add input")?.focus();
}

// 移出关注：乐观先本地摘掉这行立即重渲染（别等慢吞吞的整盘刷新），再后台 untrack + 对账。
async function removeWatch(ticker) {
  if (!ticker) return;
  if (watchDesk && Array.isArray(watchDesk.cards)) {
    watchDesk.cards = watchDesk.cards.filter((c) => c.ticker !== ticker);
    recountDesk();
    render();
  }
  try {
    await api("/api/watch/untrack", { method: "POST", body: JSON.stringify({ ticker }) });
  } catch { /* 失败下次刷新自愈 */ }
  void refreshWatchDesk().then(render);
}

function renderStockPage(ticker) {
  if (watchStockTicker !== ticker || watchStockLoading) return renderStockSkeleton(ticker);
  if (!watchStock) return renderStockError(ticker);
  return renderStockDetail(watchStock);
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
  const n = CHART_RANGES[chartRange] || CHART_RANGES["3m"];
  const pts = series.points.slice(-n);
  const chart = buildChartPaths(pts, 640, 168);
  const col = chart.up ? "#1c8c4a" : "var(--danger)";
  const fill = chart.up ? "rgba(28,140,74,0.1)" : "rgba(255,59,48,0.09)";
  const ret = `${chart.up ? "+" : "−"}${Math.abs(chart.retPct).toFixed(1)}%`;
  const btns = [["1m", "1月"], ["3m", "3月"], ["1y", "1年"]]
    .map(([k, l]) => `<button class="pc-btn ${chartRange === k ? "is-active" : ""}" type="button" data-action="chart-range" data-range="${k}">${l}</button>`)
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

  const note = stock.status === "falsified" && stock.statusReason
    ? `<div class="wd-note stock-note">${esc(stock.statusReason)}</div>`
    : "";

  const p = stock.profile;
  const researchCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("target")}研究状况</div>
    ${p?.thesis ? `<p class="stock-card-body">${esc(p.thesis)}</p>` : `<p class="stock-card-body is-empty">还没有画像 · 点「深入研究」建立</p>`}
    ${p?.researchStatus || p?.confidence ? `<div class="stock-tags">
      ${p.researchStatus ? `<span class="stock-tag">研究状态 · ${esc(p.researchStatus)}</span>` : ""}
      ${p.confidence ? `<span class="stock-tag">置信度 · ${esc(p.confidence)}</span>` : ""}
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

  const falsifiers = Array.isArray(p?.falsifiers) ? p.falsifiers : [];
  const falsifiersCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("alert")}证伪条件</div>
    ${falsifiers.length
      ? `<ul class="stock-list">${falsifiers.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
      : `<p class="stock-card-body is-empty">还没有沉淀证伪条件</p>`}
  </div>`;

  const events = Array.isArray(stock.events) ? stock.events : [];
  const eventsCard = `<div class="stock-card">
    <div class="stock-card-head">${stockIcon("news")}近期事件</div>
    ${events.length
      ? `<div class="stock-events">${events.map(stockEventRow).join("")}</div>`
      : `<p class="stock-card-body is-empty">近期暂无重大事件</p>`}
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
      </div>
      <button class="primary" type="button" data-action="return-company" data-ticker="${esc(stock.ticker)}" data-name="${esc(stock.companyName)}">深入研究</button>
    </div>
    ${note}
    ${renderPriceChart(stock.series)}
    <div class="stock-grid">
      ${researchCard}
      ${fundamentalsCard}
      ${falsifiersCard}
      ${eventsCard}
    </div>
  </div>`;
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

// A-P1.1：对话内对比的两列并排表。后端 finalizeChat 收口 comparison={left,right}，每家含现价/
// 涨跌/PE/赔率/利润质量/区间回报/目标价。散文保留在表下，让"两家谁更优"一眼可比。
function renderComparisonTable(comparison) {
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
// null/"" 经 Number() 会变成 0（finite），不能直接用 Number.isFinite 判存在性——isNum 显式挡掉空值，
// 否则缺失的目标价/盈亏会渲染成误导的 "0.00 / +0.0%"。
const isNum = (v) => v != null && v !== "" && Number.isFinite(Number(v));
const fmtMoney = (v) => (isNum(v) ? (Math.abs(Number(v)) >= 100 ? Number(v).toFixed(0) : Number(v).toFixed(2)) : "—");
const fmtSigned = (v) => (isNum(v) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%` : null);
const dirClass = (v) => (Number(v) > 0 ? "up" : Number(v) < 0 ? "down" : "flat");

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

function renderFocusStrip(meta) {
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
function renderDualQuote(dq) {
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
function renderValuationNote(note) {
  if (!note) return "";
  return `<div class="valuation-block valuation-na">
    <div class="valuation-head"><span>估值区间</span><em>暂不可用</em></div>
    <p class="val-na-text">${esc(note)}</p>
  </div>`;
}

function renderValuation(valuation, opts = {}) {
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
        ${isPortfolio ? renderPortfolioPanel(meta.positions) : renderRichAnswer(message.content)}
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
        <p>研究 / 看盘 / 设置三个分区各司其职：落地即研究（连续对话，产品灵魂）；看盘是精简关注列表，点进公司页看真价格曲线（美股日线收盘价）、研究状况、基本面、证伪条件与事件。港股曲线预留付费源，暂标"待接入"。</p>
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
  // 后台会话完成会触发 render() 重建视图——若用户正在 composer 里打字，full innerHTML 会清掉
  // 输入。渲染前抓住 textarea 内容/光标，渲染后还原，避免并行场景下"打字打一半被清空"。
  const ta = document.querySelector(".composer textarea");
  const preserved = ta ? { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd, focused: document.activeElement === ta } : null;
  const route = currentRoute();
  if (route === "/settings") renderSettings();
  else if (route === "/watch" || route.startsWith("/watch/")) renderWatchPage();
  else renderResearch(); // "/" 与 "/research" 都落到研究页（灵魂入口）
  if (preserved && preserved.value) {
    const next = document.querySelector(".composer textarea");
    if (next) {
      next.value = preserved.value;
      if (preserved.focused) {
        next.focus();
        try { next.setSelectionRange(preserved.start, preserved.end); } catch { /* ignore */ }
      }
    }
  }
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form='chat']");
  if (!form) return;
  event.preventDefault();
  const input = form.elements.query;
  const question = input.value.trim();
  // 只挡"当前会话正忙"——别的会话在后台跑不影响在这条/新建里发问（并行）。
  if (!question || isViewBusy()) return;
  input.value = "";
  appendMessage("user", question);
  resolving = true; resolvingLabel = "正在检索和思考"; render();
  try {
    await sendChat(question);
  } catch (error) {
    appendMessage("assistant", `这轮研究失败：${error.message || "未知错误"}。`);
  } finally {
    resolving = false;
    render();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form='watch-add']");
  if (!form) return;
  event.preventDefault();
  void addWatch(form.elements.q.value.trim());
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "new") clearResearch();
  if (action === "toggle-theme") { toggleTheme(); return; }
  if (action === "export") exportResearch();
  if (action === "open-stock") { location.hash = `#/watch/${target.dataset.ticker}`; render(); return; }
  if (action === "chart-range") { chartRange = target.dataset.range || "3m"; render(); return; }
  if (action === "watch-add-open") { watchAddOpen = true; watchAddError = ""; render(); setTimeout(() => document.querySelector(".wl-add input")?.focus(), 0); return; }
  if (action === "watch-add-close") { watchAddOpen = false; watchAddError = ""; render(); return; }
  if (action === "untrack-stock") { void removeWatch(target.dataset.ticker); return; }
  // 持仓管理沉在研究对话里（复用现成的自然语言记账 + 面板），从任意页点入都先切到研究页。
  if (action === "portfolio-view") { location.hash = "#/research"; render(); await showPortfolio(); return; }
  if (action === "load-session") await loadSession(target.dataset.id);
  if (action === "choice-act") {
    const { act, ticker, name } = target.dataset;
    if (act === "compare") await runComparison({ ticker, name });
    else if (act === "switch") await switchAndResearch({ ticker, name });
    else if (act === "research") await researchSuggested(ticker, name);
    else if (act === "force") await forceResearch(ticker);
    return;
  }
  if (action === "return-company") { await returnToCompany(target.dataset.ticker, target.dataset.name); return; }
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
    if (isViewBusy()) return;
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

await Promise.all([refreshStatus(), refreshSessions(), refreshWatchDesk()]);
render();
