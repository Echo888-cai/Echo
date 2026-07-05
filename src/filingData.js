import { normalizeTicker } from "./data.js";
import { isUS } from "./market.js";
import { getUsFilings } from "./secFilings.js";
import { searchHkexAllAnnouncements } from "./server/services/hkFilingsPipeline.js";

/**
 * 统一出口：获取最近公告。
 *
 * G-1.5：HK 分支此前自建了一条 HTML 抓取路径（titlesearch.xhtml 是 JS 渲染的页面
 * 壳，正文里根本没有公告数据）+ Bing 搜索兜底，两条路都拿不到真实数据——`npm run
 * canary` 跑真实调用时先是抓到一个解构 bug 导致直接崩溃，修完 bug 后发现即使不崩溃
 * 也总是"两条路都失败"，因为壳页面本来就是空的。现在改用 hkFilingsPipeline.js 里
 * 已验证有效的 titleSearchServlet 真实端点（与港股一手财报管道同源，真实数据不是
 * mock 出来的）。
 */
export async function getRecentFilings(ticker) {
  // US tickers go to SEC EDGAR (8-K / 10-Q / 10-K); HK stays on HKEX 披露易.
  if (isUS(ticker)) return getUsFilings(ticker);

  try {
    const rows = await searchHkexAllAnnouncements(ticker);
    if (!rows.length) throw new Error("HKEX 近一年没有公告记录（可能停牌/新上市/代码有误）");
    return {
      ticker: normalizeTicker(ticker),
      providerStatus: "ok",
      source: "HKEX 披露易",
      filings: rows.map((r) => ({ ...r, source: "HKEX 披露易" })),
      asOf: new Date().toISOString(),
      errors: []
    };
  } catch (error) {
    return {
      ticker: normalizeTicker(ticker),
      providerStatus: "missing",
      source: "未接入",
      filings: [],
      asOf: new Date().toISOString(),
      errors: [error.message]
    };
  }
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
