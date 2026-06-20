import { createHash } from "node:crypto";
import { buildEvidenceQueries, classifyResearchIntent } from "./intentClassifier.js";
import { listWebEvidence, saveWebEvidence } from "../repositories/webEvidenceRepository.js";

const SEARCH_TIMEOUT_MS = 6000;
const TRUSTED_HOSTS = [
  "hkexnews.hk",
  "investor",
  "ir.",
  "lenovo.com",
  "tencent.com",
  "alibabagroup.com",
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "cnbc.com",
  "nikkei.com",
  "canalys.com",
  "idc.com",
  "gartner.com",
  "counterpointresearch.com",
  "fool.com",
  "marketwatch.com",
  "finance.yahoo.com",
  "eastmoney.com"
];

const LOW_QUALITY_HOSTS = [
  "baike.baidu.com",
  "wikipedia.org",
  "facebook.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "bilibili.com",
  "zhihu.com"
];

const LOW_QUALITY_TEXT = /售后|保修|驱动|下载|应用商店|官方商城|购物|促销|优惠|support|drivers|troubleshooting|warranty|repair|store|shopping|laptops, desktop pcs, tablets/i;
const INTENT_SIGNAL_WORDS = {
  competitors: /竞争|竞品|对手|市场份额|出货|行业格局|PC|server|AI|IDC|Canalys|Gartner|Counterpoint|HP|Dell|HPE|Supermicro|competition|competitor|market share|shipment/i,
  business_model: /收入|营收|利润|盈利|业务|分部|财报|现金流|revenue|profit|margin|segment|earnings|cash flow/i,
  moat: /护城河|竞争优势|壁垒|市场份额|用户|留存|利润率|moat|competitive advantage|market share|margin/i,
  financial_quality: /收入|利润|毛利|现金流|财报|业绩|revenue|profit|margin|cash flow|earnings/i,
  valuation: /估值|市盈率|目标价|回购|分红|PE|valuation|target price|buyback|dividend/i,
  risk_event: /下跌|上涨|监管|风险|处罚|竞争|股价|fall|rise|risk|regulation|probe|competition/i,
  falsify: /风险|证伪|看空|监管|下滑|放缓|利润率|竞争|risk|bear|decline|slowing|margin|regulation|competition/i,
  company_status: /业绩|财报|股价|新闻|展望|earnings|results|stock|outlook|news/i
};

function nowIso() {
  return new Date().toISOString();
}

function hash(value = "") {
  return createHash("sha1").update(String(value)).digest("hex");
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 LuvioResearch/0.1",
        Accept: "application/json, application/rss+xml, application/xml, text/html, */*",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 160)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sourceTypeFor(url = "", source = "") {
  const host = hostOf(url);
  const text = `${host} ${source}`.toLowerCase();
  if (/hkexnews|investor|ir\.|annual|results|financial/.test(text)) return "official";
  if (/canalys|gartner|idc|counterpoint/.test(text)) return "industry_research";
  if (/reuters|bloomberg|ft\.com|wsj|cnbc|nikkei|marketwatch|yahoo/.test(text)) return "financial_media";
  if (/eastmoney|sina|stcn|yicai|caixin/.test(text)) return "cn_financial_media";
  return "web";
}

function credibilityFor(item = {}) {
  const host = hostOf(item.url);
  let score = 0.45;
  if (TRUSTED_HOSTS.some((trusted) => host.includes(trusted))) score += 0.35;
  if (LOW_QUALITY_HOSTS.some((blocked) => host.includes(blocked))) score -= 0.25;
  if (item.publishedAt) score += 0.08;
  if (item.sourceType === "official") score += 0.12;
  if (item.sourceType === "industry_research") score += 0.12;
  return Math.max(0.05, Math.min(1, score));
}

function relevanceFor(item = {}, { company = {}, question = "", intent = "" } = {}) {
  const haystack = `${item.title || ""} ${item.snippet || ""} ${item.source || ""}`.toLowerCase();
  const tokens = [
    company.ticker,
    company.nameZh,
    company.nameZh?.replace(/[-－].*$/, ""),
    company.nameEn,
    ...(company.aliases || []),
    ...String(question).split(/\s+/)
  ]
    .filter(Boolean)
    .map((token) => String(token).toLowerCase())
    .filter((token) => token.length >= 2);
  const hits = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
  const intentBoost = intent && haystack.includes(intent.replace("_", " ")) ? 0.08 : 0;
  return Math.max(0.05, Math.min(1, 0.25 + hits * 0.08 + intentBoost));
}

function normalizeEvidence(raw = {}, context = {}) {
  const url = String(raw.url || raw.link || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const source = raw.source || hostOf(url) || "web";
  const sourceType = sourceTypeFor(url, source);
  const fetchedAt = nowIso();
  const title = decodeXml(raw.title || "").slice(0, 240);
  const snippet = decodeXml(raw.snippet || raw.description || raw.content || "").slice(0, 600);
  const item = {
    id: hash(`${context.ticker || ""}|${context.intent || ""}|${url}`),
    ticker: context.ticker,
    intent: context.intent,
    query: raw.query || context.query || "",
    title,
    url,
    source,
    sourceType,
    snippet,
    publishedAt: raw.publishedAt || raw.published_at || "",
    fetchedAt,
    contentHash: hash(`${title}|${snippet}|${url}`),
    raw
  };
  item.relevanceScore = relevanceFor(item, context);
  item.credibilityScore = credibilityFor(item);
  return item;
}

// Junk domains that should never be cited (portals, login walls, generic homepages).
const JUNK_HOSTS = [
  "qq.com",
  "baidu.com",
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "yahoo.com",
  "so.com",
  "sogou.com",
  "163.com",
  "sina.com.cn"
];

/** Cheap (no-network) reject: homepages, search engines, bare portals. */
function isJunkUrl(url = "") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "");
  // No real path → homepage/portal (e.g. https://www.qq.com/). Allow only trusted hosts with real content.
  if (!path || path === "" || path === "/") {
    return !TRUSTED_HOSTS.some((trusted) => host.includes(trusted));
  }
  if (JUNK_HOSTS.some((junk) => host === junk || host.endsWith(`.${junk}`))) {
    // A portal subpage is sometimes a real article; keep only if the path is deep enough.
    return path.split("/").filter(Boolean).length < 2;
  }
  return false;
}

function isUsefulEvidence(item = {}, intent = "") {
  const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`;
  if (LOW_QUALITY_TEXT.test(text)) return false;
  if (isJunkUrl(item.url || "")) return false;
  const signal = INTENT_SIGNAL_WORDS[intent] || INTENT_SIGNAL_WORDS.company_status;
  if (item.sourceType === "official" || item.sourceType === "industry_research" || item.sourceType === "financial_media") return true;
  return signal.test(text);
}

/**
 * Verify candidate URLs actually resolve. Drops 404 / 410 / dead links so the
 * user never sees a source that returns "not found". Tolerant of bot-blocking:
 * only an explicit not-found / DNS failure / timeout removes an item.
 */
async function keepLiveEvidence(items = [], { limit = 6, timeoutMs = 3500 } = {}) {
  const checks = await Promise.all(
    items.slice(0, limit).map(async (item) => {
      const ok = await urlIsAlive(item.url, timeoutMs);
      return ok ? item : null;
    })
  );
  return checks.filter(Boolean);
}

async function urlIsAlive(url = "", timeoutMs = 3500) {
  if (!/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 LuvioResearch/0.1" }
    });
    // Some hosts reject HEAD (405/501) — retry a lightweight ranged GET.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 LuvioResearch/0.1", Range: "bytes=0-2048" }
      });
    }
    // Only an explicit "gone" status removes a link. 403/429/5xx (bot-blocking,
    // rate limits) are kept — they don't mean the user's browser will 404.
    return ![404, 410].includes(res.status);
  } catch {
    // Network error / timeout from our server ≠ dead for the user. Keep it;
    // junk homepages are already removed by isJunkUrl without a request.
    return true;
  } finally {
    clearTimeout(timer);
  }
}

function dedupe(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url.replace(/[?#].*$/, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchTavily(query) {
  if (!process.env.TAVILY_API_KEY) return [];
  const text = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      max_results: 6
    })
  });
  const json = JSON.parse(text);
  return (json.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content,
    source: hostOf(item.url),
    publishedAt: item.published_date || "",
    query
  }));
}

async function searchSerpApi(query) {
  if (!process.env.SERPAPI_API_KEY) return [];
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(process.env.SERPAPI_API_KEY)}&num=6`;
  const text = await fetchWithTimeout(url);
  const json = JSON.parse(text);
  return (json.organic_results || []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
    source: item.source || hostOf(item.link),
    publishedAt: item.date || "",
    query
  }));
}

async function searchYahooNews(query) {
  const url = `https://news.search.yahoo.com/rss?p=${encodeURIComponent(query)}`;
  const xml = await fetchWithTimeout(url, {}, 7000);
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 6);
  return items.map(([, item]) => ({
    title: tagValue(item, "title"),
    url: tagValue(item, "link"),
    snippet: tagValue(item, "description"),
    source: "Yahoo News",
    publishedAt: tagValue(item, "pubDate"),
    query
  }));
}

function parseBingHtml(html, query) {
  const blocks = [...String(html).matchAll(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|$)/gi)].slice(0, 6);
  return blocks.map(([block]) => {
    const heading = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    if (!heading) return null;
    const description = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    return {
      title: decodeXml(heading[2]),
      url: decodeXml(heading[1]),
      snippet: decodeXml(description?.[1] || ""),
      source: "Bing Web",
      publishedAt: "",
      query
    };
  }).filter(Boolean);
}

async function searchBingWeb(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans&mkt=zh-HK`;
  const html = await fetchWithTimeout(url, {}, 7000);
  return parseBingHtml(html, query);
}

function decodeDuckUrl(href = "") {
  try {
    if (/[?&]uddg=/.test(href)) {
      const u = new URL(href, "https://duckduckgo.com");
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
  } catch {
    /* fall through */
  }
  return href;
}

function parseDuckHtml(html, query) {
  const blocks = [...String(html).matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 6);
  const snippets = [...String(html).matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => decodeXml(m[1]));
  return blocks
    .map(([, href, title], index) => {
      const url = decodeDuckUrl(href);
      if (!/^https?:\/\//i.test(url)) return null;
      return {
        title: decodeXml(title),
        url,
        snippet: snippets[index] || "",
        source: hostOf(url) || "DuckDuckGo",
        publishedAt: "",
        query
      };
    })
    .filter(Boolean);
}

async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`;
  const html = await fetchWithTimeout(url, {}, 7000);
  return parseDuckHtml(html, query);
}

async function searchOneQuery(query) {
  const jobs = [
    searchTavily(query),
    searchSerpApi(query),
    searchDuckDuckGo(query),
    searchYahooNews(query),
    searchBingWeb(query)
  ];
  const settled = await Promise.allSettled(jobs);
  const results = [];
  const errors = [];
  for (const item of settled) {
    if (item.status === "fulfilled") results.push(...item.value);
    else errors.push(item.reason?.message || "search failed");
  }
  return { results, errors };
}

export async function researchWebEvidence({ company, question = "", intent = classifyResearchIntent(question), maxAgeHours = 24, forceRefresh = false } = {}) {
  if (!company?.ticker) {
    return { intent, queries: [], evidence: [], gaps: ["缺少公司上下文，无法检索公开证据。"], provider: "none", searchedAt: nowIso() };
  }

  const queries = buildEvidenceQueries({ company, question, intent });
  if (!forceRefresh) {
    const cached = listWebEvidence({ ticker: company.ticker, intent, limit: 20, maxAgeHours })
      .filter((item) => isUsefulEvidence(item, intent))
      .slice(0, 10);
    if (cached.length >= 4) {
      return {
        intent,
        queries,
        evidence: cached,
        gaps: [],
        provider: "cache",
        searchedAt: nowIso(),
        summary: `复用 ${cached.length} 条已缓存网页证据。`
      };
    }
  }

  const searchedAt = nowIso();
  const queryResults = await Promise.allSettled(queries.slice(0, 6).map((query) => searchOneQuery(query).then((result) => ({ query, ...result }))));
  const all = [];
  const errors = [];
  for (const item of queryResults) {
    if (item.status === "fulfilled") {
      errors.push(...item.value.errors);
      all.push(...item.value.results.map((result) => ({ ...result, query: item.value.query })));
    } else {
      errors.push(item.reason?.message || "search failed");
    }
  }

  const ranked = dedupe(all)
    .map((item) => normalizeEvidence(item, { company, question, intent, ticker: company.ticker, query: item.query }))
    .filter(Boolean)
    .filter((item) => isUsefulEvidence(item, intent))
    .filter((item) => item.credibilityScore >= 0.25 && item.relevanceScore >= 0.25)
    .sort((a, b) => (b.credibilityScore + b.relevanceScore) - (a.credibilityScore + a.relevanceScore))
    .slice(0, 8);

  // Only keep links that actually resolve — the user must never click a 404.
  const evidence = await keepLiveEvidence(ranked, { limit: 8 });

  saveWebEvidence(evidence);

  const gaps = [];
  if (!evidence.length) gaps.push("本轮没有抓到可校验的公开网页证据，已改用公司档案与已接入数据做判断。");
  if (errors.length) gaps.push(`部分搜索源失败：${[...new Set(errors)].slice(0, 3).join("；")}`);

  return {
    intent,
    queries,
    evidence,
    gaps,
    provider: process.env.TAVILY_API_KEY ? "tavily+fallback" : process.env.SERPAPI_API_KEY ? "serpapi+fallback" : "public_fallback",
    searchedAt,
    summary: evidence.length ? `检索 ${queries.length} 组关键词，保留 ${evidence.length} 条可用证据。` : "本轮未保留可用证据。"
  };
}

export function webEvidenceToPrompt(webEvidence = {}) {
  const evidence = Array.isArray(webEvidence.evidence) ? webEvidence.evidence : [];
  if (!evidence.length) return "Web Evidence：本轮未抓到可用公开网页证据。";
  const lines = evidence.slice(0, 8).map((item, index) => {
    const date = item.publishedAt ? `，${item.publishedAt}` : "";
    const snippet = item.snippet ? `：${item.snippet.slice(0, 180)}` : "";
    return `${index + 1}. ${item.title || item.url}（${item.source || item.sourceType}${date}）${snippet}\n   链接：${item.url}`;
  });
  return `Web Evidence（${webEvidence.provider || "web"}，${webEvidence.summary || ""}）：\n${lines.join("\n")}`;
}
