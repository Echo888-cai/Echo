import { normalizeTicker, companyByTicker } from "./data.js";
import { isUS } from "./market.js";
import { getUsFilings } from "./secFilings.js";

function toStockCode(ticker) {
  return normalizeTicker(ticker).replace(".HK", "");
}

async function fetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 Luvio/0.1 HKEX research adapter",
        Accept: "text/html, application/json, */*"
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Luvio/0.1 HKEX research adapter",
        Accept: "application/json"
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 HKEX 披露易获取公告列表
 * 使用 HKEX 的搜索接口获取上市公司最新公告
 */
async function fetchHkexNewsFilings(ticker) {
  const stockCode = toStockCode(ticker);
  const company = companyByTicker(ticker);
  const searchName = company?.nameEn || company?.nameZh || "";

  // HKEX News 搜索 API — 获取最新公告
  const url = `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=ZH&category=company&market=hkex&stockId=${stockCode}&from=20250101&to=20261231`;

  const html = await fetchText(url, 10000);

  // 解析 HTML 中的公告条目
  const filings = [];
  const rowPattern = /<tr[^>]*class="row"[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = [...html.matchAll(rowPattern)];

  for (const [, row] of rows.slice(0, 15)) {
    try {
      const titleMatch = row.match(/<td[^>]*class="title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
        || row.match(/<a[^>]*href="([^"]*)"[^>]*class="news-url"[^>]*>([\s\S]*?)<\/a>/i);
      const dateMatch = row.match(/<td[^>]*class="date"[^>]*>([\s\S]*?)<\/td>/i)
        || row.match(/class="release-time"[^>]*>([\s\S]*?)</i);
      const typeMatch = row.match(/<td[^>]*class="category"[^>]*>([\s\S]*?)<\/td>/i)
        || row.match(/class="category"[^>]*>([\s\S]*?)</i);

      if (titleMatch) {
        const href = titleMatch[1].replace(/&amp;/g, "&");
        const fullUrl = href.startsWith("http") ? href : `https://www1.hkexnews.hk${href}`;
        filings.push({
          title: decodeHtmlEntities(titleMatch[2].trim()),
          filingType: typeMatch ? decodeHtmlEntities(typeMatch[1].trim()) : "公告",
          publishedAt: dateMatch ? decodeHtmlEntities(dateMatch[1].trim()) : "",
          url: fullUrl,
          source: "HKEX 披露易"
        });
      }
    } catch {
      // 解析单条失败，跳过
    }
  }

  // 备用方案：通过 HKEX RSS 或 API
  if (!filings.length) {
    try {
      const rssUrl = `https://www1.hkexnews.hk/app/appyearlyindex.html?lang=zh&category=company&market=hkex&stockId=${stockCode}`;
      // 尝试 HKEX 的 JSON API
      const apiUrl = `https://www1.hkexnews.hk/ncms/json/eds/search_result_json.json?lang=ZH&category=company&market=HKEX&stockId=${stockCode}&from=20250101&to=20261231&rowRange=15`;
      const data = await fetchJson(apiUrl, 6000);
      if (data?.result?.length) {
        for (const item of data.result.slice(0, 15)) {
          filings.push({
            title: item.title || "",
            filingType: item.category || "公告",
            publishedAt: item.date || "",
            url: item.link ? (item.link.startsWith("http") ? item.link : `https://www1.hkexnews.hk${item.link}`) : "",
            source: "HKEX 披露易"
          });
        }
      }
    } catch {
      // RSS/API 备用方案也失败
    }
  }

  if (!filings.length) throw new Error("HKEX 披露易没有返回公告");

  return filings;
}

/**
 * 备用数据源：通过搜索爬取公告信息
 */
async function fetchFilingsViaSearch(ticker) {
  const company = companyByTicker(ticker);
  if (!company) throw new Error("未找到公司信息");

  const stockCode = toStockCode(ticker);
  const searchName = company.nameEn || company.nameZh;
  const query = `"${searchName}" site:hkexnews.hk OR site:hkex.com.hk 公告 通告`;
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans&mkt=zh-HK`;

  const html = await fetchText(url, 8000);
  const filings = [];
  const blocks = [...html.matchAll(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|$)/gi)].slice(0, 10);

  for (const [, block] of blocks) {
    const heading = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    if (!heading) continue;
    const link = decodeHtmlEntities(heading[1]);
    if (!link.includes("hkexnews.hk") && !link.includes("hkex.com.hk")) continue;
    filings.push({
      title: decodeHtmlEntities(heading[2]),
      filingType: "公告",
      publishedAt: "",
      url: link,
      source: "Bing · HKEX"
    });
  }

  if (!filings.length) throw new Error("Bing 搜索没有找到 HKEX 公告");
  return filings;
}

function decodeHtmlEntities(text = "") {
  return String(text)
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

/**
 * 统一出口：获取最近公告
 */
export async function getRecentFilings(ticker) {
  // US tickers go to SEC EDGAR (8-K / 10-Q / 10-K); HK stays on HKEX 披露易.
  if (isUS(ticker)) return getUsFilings(ticker);

  const providers = [fetchHkexNewsFilings, fetchFilingsViaSearch];
  const errors = [];

  for (const provider of providers) {
    try {
      const filings = await provider(ticker);
      return {
        ticker: normalizeTicker(ticker),
        providerStatus: "ok",
        source: filings[0]?.source || "HKEX",
        filings,
        asOf: new Date().toISOString(),
        errors: []
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    ticker: normalizeTicker(ticker),
    providerStatus: "missing",
    source: "未接入",
    filings: [],
    asOf: new Date().toISOString(),
    errors
  };
}

/**
 * 公告列表转 Markdown
 */
export function filingsToMarkdown(filingsData) {
  if (!filingsData || filingsData.providerStatus !== "ok") {
    return "公告（HKEX 披露易 / SEC EDGAR）：暂未取得可用公告。模型不能编造公告内容。";
  }

  const items = filingsData.filings
    .slice(0, 10)
    .map((f, i) => `${i + 1}. [${f.title}](${f.url})（${f.filingType}，${f.publishedAt || "日期未知"}）`)
    .join("\n");

  // P7：8-K 原文关键条目（一手抽取），让模型看到事件性质而不只是标题。
  let eightK = "";
  if (filingsData.eightK?.providerStatus === "ok" && filingsData.eightK.filings?.length) {
    const blocks = filingsData.eightK.filings.map((f) => {
      const lines = f.items
        .slice(0, 6)
        .map((it) => `  - Item ${it.code}${it.name ? `（${it.name}）` : ""}：${it.excerpt.slice(0, 200)}`)
        .join("\n");
      return `- ${f.publishedAt} [8-K 原文](${f.url})\n${lines}`;
    });
    eightK = `\n\n8-K 关键条目（SEC EDGAR 原文抽取，一手事实）：\n${blocks.join("\n")}`;
  }

  return `公告来源：${filingsData.source}\n最近公告：\n${items || "暂无"}${eightK}`;
}
