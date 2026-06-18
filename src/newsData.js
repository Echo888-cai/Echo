import { normalizeTicker } from "./data.js";

const POSITIVE_WORDS = [
  "beat",
  "growth",
  "surge",
  "rise",
  "rises",
  "up",
  "upgrade",
  "profit",
  "buyback",
  "record",
  "strong",
  "增长",
  "上升",
  "回购",
  "盈利",
  "超预期",
  "创新高",
  "升级",
  "强劲"
];

const NEGATIVE_WORDS = [
  "fall",
  "falls",
  "drop",
  "drops",
  "down",
  "decline",
  "probe",
  "scrutiny",
  "loss",
  "cuts",
  "risk",
  "weak",
  "regulatory",
  "下跌",
  "下降",
  "亏损",
  "监管",
  "审查",
  "风险",
  "疲弱",
  "降级",
  "承压"
];

const NEWS_SCOPES = [
  {
    scope: "财经",
    source: "Google News · 财经",
    terms: ["stock", "earnings", "revenue", "profit", "shares", "业绩", "股价", "营收", "利润", "回购"]
  },
  {
    scope: "监管",
    source: "Google News · 监管",
    terms: ["regulation", "regulator", "probe", "lawsuit", "监管", "审查", "调查", "诉讼", "处罚"]
  },
  {
    scope: "舆论",
    source: "Google News · 舆论",
    terms: ["consumer", "customer", "public opinion", "social media", "用户", "消费者", "舆论", "口碑", "投诉"]
  },
  {
    scope: "社会",
    source: "Google News · 社会",
    terms: ["accident", "safety", "labor", "environment", "supply chain", "安全", "事故", "劳工", "环境", "供应链"]
  },
  {
    scope: "行业",
    source: "Google News · 行业",
    terms: ["industry", "competition", "market share", "price war", "行业", "竞争", "市场份额", "价格战"]
  }
];

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function scoreSentiment(text) {
  const lower = String(text || "").toLowerCase();
  const positive = POSITIVE_WORDS.reduce((score, word) => score + (lower.includes(word.toLowerCase()) ? 1 : 0), 0);
  const negative = NEGATIVE_WORDS.reduce((score, word) => score + (lower.includes(word.toLowerCase()) ? 1 : 0), 0);
  return positive - negative;
}

function summarizeSentiment(articles) {
  const scores = articles.map((article) => scoreSentiment(`${article.title} ${article.description}`));
  const total = scores.reduce((sum, score) => sum + score, 0);
  const negativeCount = scores.filter((score) => score < 0).length;
  const positiveCount = scores.filter((score) => score > 0).length;
  let label = "中性偏观察";
  if (total >= 2) label = "偏正面";
  if (total <= -2) label = "偏负面";
  return {
    label,
    score: total,
    positiveCount,
    negativeCount,
    neutralCount: Math.max(0, articles.length - positiveCount - negativeCount)
  };
}

async function fetchText(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 Luvio/0.1",
        Accept: "application/rss+xml, application/xml, text/xml, */*"
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseYahooRss(xml, ticker) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);
  return items
    .map(([, item]) => ({
      title: tagValue(item, "title"),
      description: tagValue(item, "description"),
      url: tagValue(item, "link"),
      source: "Yahoo Finance",
      publishedAt: tagValue(item, "pubDate"),
      ticker: normalizeTicker(ticker)
    }))
    .filter((article) => article.title);
}

function parseYahooSearchRss(xml, company, scope, source) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);
  return items
    .map(([, item]) => ({
      title: tagValue(item, "title"),
      description: tagValue(item, "description"),
      url: tagValue(item, "link"),
      source,
      scope,
      publishedAt: tagValue(item, "pubDate"),
      ticker: normalizeTicker(company.ticker)
    }))
    .filter((article) => article.title);
}

function parseBingSearchHtml(html, company, scope) {
  const blocks = [...String(html).matchAll(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|$)/gi)].slice(0, 8);
  const blockedHosts = ["tencent.com", "tencentcloud.com", "qq.com", "baike.baidu.com", "microsoft.com", "wegame.com.cn"];
  const blockedTitleWords = ["百度百科", "实时行情", "股票股价", "腾讯视频频道", "官方下载", "应用商店", "WeGame", "关于我们"];
  return blocks
    .map(([block]) => {
      const heading = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
      if (!heading) return null;
      const description = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      return {
        title: decodeXml(heading[2]),
        description: decodeXml(description?.[1] || ""),
        url: decodeXml(heading[1]),
        source: `Bing Web · ${scope}`,
        scope,
        publishedAt: "",
        ticker: normalizeTicker(company.ticker)
      };
    })
    .filter(Boolean)
    .filter((article) => {
      try {
        const host = new URL(article.url).hostname.replace(/^www\./, "");
        const title = article.title.toLowerCase();
        return !blockedHosts.some((blocked) => host.endsWith(blocked)) && !blockedTitleWords.some((word) => title.includes(word.toLowerCase()));
      } catch {
        return true;
      }
    });
}

function parseGoogleNewsRss(xml, company, scope, source) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);
  return items
    .map(([, item]) => ({
      title: tagValue(item, "title"),
      description: tagValue(item, "description"),
      url: tagValue(item, "link"),
      source,
      scope,
      publishedAt: tagValue(item, "pubDate"),
      ticker: normalizeTicker(company.ticker)
    }))
    .filter((article) => article.title);
}

function companyTokens(company) {
  const ticker = normalizeTicker(company.ticker);
  return [
    ticker,
    ticker.replace(".HK", ""),
    company.nameZh,
    company.nameZh?.replace(/[-－].*$/, ""),
    company.nameEn,
    company.nameEn?.split(/[,\s]/)[0],
    ...(company.aliases || [])
  ]
    .filter(Boolean)
    .map((token) => String(token).toLowerCase())
    .filter((token) => token.length >= 2);
}

function primarySearchNames(company) {
  return [
    company.nameZh,
    company.nameZh?.replace(/[-－].*$/, ""),
    company.nameEn,
    normalizeTicker(company.ticker),
    normalizeTicker(company.ticker).replace(".HK", "")
  ]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter((item, index, arr) => item && arr.indexOf(item) === index)
    .slice(0, 3);
}

function filterRelevantArticles(articles, company) {
  const tokens = companyTokens(company);
  const relevant = articles.filter((article) => {
    const text = `${article.title} ${article.description}`.toLowerCase();
    return tokens.some((token) => text.includes(token));
  });
  const candidates = relevant.length ? relevant : articles;
  const seenScopes = new Map();
  return candidates
    .map((article) => {
      const scope = article.scope || "财经";
      const scopeCount = seenScopes.get(scope) || 0;
      seenScopes.set(scope, scopeCount + 1);
      const text = `${article.title} ${article.description}`.toLowerCase();
      const title = String(article.title || "").toLowerCase();
      const relevance = tokens.reduce((score, token) => score + (title.includes(token) ? 3 : text.includes(token) ? 1 : 0), 0);
      const diversityBoost = scope === "财经" ? 0 : 3 - Math.min(scopeCount, 2);
      return { article, score: relevance + diversityBoost };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.article);
}

function dedupeArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const key = `${article.title}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scopeSummary(articles) {
  return articles.reduce((acc, article) => {
    const scope = article.scope || "财经";
    acc[scope] = (acc[scope] || 0) + 1;
    return acc;
  }, {});
}

function missingScopes(articles) {
  const present = new Set(articles.map((article) => article.scope || "财经"));
  return NEWS_SCOPES.map((scope) => scope.scope).filter((scope) => !present.has(scope));
}

function searchPlanFor(company, missing) {
  return missing.map((scope) => {
    const config = NEWS_SCOPES.find((item) => item.scope === scope);
    return {
      scope,
      query: `${company.nameZh || company.nameEn} ${config?.terms.slice(0, 4).join(" / ") || ""}`,
      status: "未取得可用新闻，需继续监控"
    };
  });
}

async function fetchYahooFinanceNews(ticker) {
  const symbol = normalizeTicker(ticker);
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const xml = await fetchText(url);
  const articles = parseYahooRss(xml, symbol).map((article) => ({ ...article, scope: "财经" }));
  if (!articles.length) throw new Error("Yahoo Finance 没有返回新闻");
  return articles;
}

async function fetchGoogleNewsForScope(company, scopeConfig) {
  const names = primarySearchNames(company);
  const query = `(${names.map((name) => `"${name}"`).join(" OR ")}) (${scopeConfig.terms.slice(0, 6).join(" OR ")})`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=HK&ceid=HK:zh-Hans`;
  const xml = await fetchText(url);
  return parseGoogleNewsRss(xml, company, scopeConfig.scope, scopeConfig.source);
}

async function fetchYahooSearchForScope(company, scopeConfig) {
  const names = primarySearchNames(company);
  const query = `${names.join(" ")} ${scopeConfig.terms.slice(0, 5).join(" ")}`;
  const url = `https://news.search.yahoo.com/rss?p=${encodeURIComponent(query)}`;
  const xml = await fetchText(url, 10000);
  const articles = parseYahooSearchRss(xml, company, scopeConfig.scope, `Yahoo News · ${scopeConfig.scope}`);
  if (!articles.length) throw new Error(`Yahoo News ${scopeConfig.scope} 没有返回新闻`);
  return articles;
}

async function fetchBingSignalsForScope(company, scopeConfig) {
  const searchName = company.nameEn || company.nameZh || normalizeTicker(company.ticker);
  const query = `"${searchName}" ${scopeConfig.terms.slice(0, 5).join(" ")} Reuters Bloomberg SCMP CNBC Nikkei`;
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans&mkt=zh-HK`;
  const html = await fetchText(url, 10000);
  const articles = parseBingSearchHtml(html, company, scopeConfig.scope);
  if (!articles.length) throw new Error(`Bing ${scopeConfig.scope} 没有返回可用信号`);
  return articles;
}

async function fetchEastMoneyNews(companyName) {
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery&param=${encodeURIComponent(JSON.stringify([{uid: "", keyword: companyName, type: ["cmsArticleWebOld"], client: ["web"]}]))}`;
  const text = await fetchText(url, 8000);
  const jsonMatch = text.match(/jQuery\((.+)\)$/);
  if (!jsonMatch) throw new Error("East Money 新闻没有返回数据");
  const data = JSON.parse(jsonMatch[1]);
  const items = data?.result?.cmsArticleWebOld || [];
  if (!items.length) throw new Error("East Money 没有返回相关新闻");
  return items.slice(0, 8).map(item => ({
    title: item.title?.replace(/<[^>]*>/g, "") || "",
    description: item.content?.replace(/<[^>]*>/g, "").slice(0, 200) || "",
    url: item.url || "",
    source: `东方财富 · ${item.mediaName || "财经"}`,
    scope: "财经",
    publishedAt: item.date || "",
    ticker: ""
  }));
}

async function fetchBroadNews(company) {
  const enableGoogleNews = process.env.LUVIO_ENABLE_GOOGLE_NEWS === "1";
  const searchJobs = [
    fetchYahooFinanceNews(company.ticker),
    ...NEWS_SCOPES.map((scope) => fetchYahooSearchForScope(company, scope)),
    ...NEWS_SCOPES.map((scope) => fetchBingSignalsForScope(company, scope)),
    ...(enableGoogleNews ? NEWS_SCOPES.map((scope) => fetchGoogleNewsForScope(company, scope)) : [])
  ];

  // Add Chinese news sources
  if (company.nameZh) {
    searchJobs.push(fetchEastMoneyNews(company.nameZh));
  }
  const results = await Promise.allSettled(searchJobs);
  const errors = [];
  const articles = [];
  for (const result of results) {
    if (result.status === "fulfilled") articles.push(...result.value);
    else errors.push(result.reason?.message || "新闻抓取失败");
  }
  return {
    articles: dedupeArticles(filterRelevantArticles(articles, company)).slice(0, 14),
    errors
  };
}

export async function getNewsSnapshot(company) {
  if (!company?.ticker) {
    return {
      providerStatus: "missing",
      source: "未接入",
      articles: [],
      sentiment: summarizeSentiment([]),
      asOf: new Date().toISOString(),
      errors: ["缺少公司代码"]
    };
  }

  try {
    const { articles, errors } = await fetchBroadNews(company);
    if (!articles.length) throw new Error("多源新闻没有返回相关新闻");
    return {
      providerStatus: "ok",
      source: "Yahoo Finance + Yahoo News + Bing Web Signals",
      ticker: normalizeTicker(company.ticker),
      company: company.nameZh,
      articles,
      sentiment: summarizeSentiment(articles),
      scopeSummary: scopeSummary(articles),
      coverageGaps: missingScopes(articles),
      searchPlan: searchPlanFor(company, missingScopes(articles)),
      asOf: new Date().toISOString(),
      errors
    };
  } catch (error) {
    return {
      providerStatus: "missing",
      source: "未接入",
      ticker: normalizeTicker(company.ticker),
      company: company.nameZh,
      articles: [],
      sentiment: summarizeSentiment([]),
      scopeSummary: {},
      coverageGaps: NEWS_SCOPES.map((scope) => scope.scope),
      searchPlan: searchPlanFor(company, NEWS_SCOPES.map((scope) => scope.scope)),
      asOf: new Date().toISOString(),
      errors: [error.message]
    };
  }
}

export function newsSnapshotToMarkdown(snapshot) {
  if (!snapshot || snapshot.providerStatus !== "ok") {
    return "新闻与舆论：暂未取得可用新闻源。模型必须把这视为缺口，不能编造市场舆论。";
  }

  const headlines = snapshot.articles
    .slice(0, 6)
    .map((article, index) => {
      const date = article.publishedAt ? ` | ${article.publishedAt}` : "";
      const description = article.description ? `：${article.description.slice(0, 180)}` : "";
      const scope = article.scope ? `【${article.scope}】` : "";
      const url = article.url ? `\n   链接：${article.url}` : "";
      return `${index + 1}. ${scope}${article.title}${description}${date}${url}`;
    })
    .join("\n");
  const scopes = Object.entries(snapshot.scopeSummary || {})
    .map(([scope, count]) => `${scope} ${count}`)
    .join(" / ");
  const gaps = (snapshot.coverageGaps || []).length ? snapshot.coverageGaps.join(" / ") : "无明显缺口";
  const searchPlan = (snapshot.searchPlan || [])
    .slice(0, 5)
    .map((item) => `- ${item.scope}：${item.query}（${item.status}）`)
    .join("\n");

  return `新闻与舆论来源：${snapshot.source}
舆论温度：${snapshot.sentiment.label}（正面 ${snapshot.sentiment.positiveCount} / 负面 ${snapshot.sentiment.negativeCount} / 中性 ${snapshot.sentiment.neutralCount}）
覆盖范围：${scopes || "未分类"}
覆盖缺口：${gaps}
抓取时间：${snapshot.asOf}
最近新闻：
${headlines || "暂无可用新闻标题"}

后续检索面：
${searchPlan || "- 暂无"}`;
}
