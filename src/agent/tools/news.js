/**
 * NewsTool - 获取新闻与公告数据
 */
import { Tool } from "../tool.js";
import { getNewsSnapshot, newsSnapshotToMarkdown } from "../../newsData.js";
import { getRecentFilings, filingsToMarkdown } from "../../filingData.js";

export class NewsTool extends Tool {
  name() { return "get_news_and_filings"; }
  description() { return "获取港股公司的近期新闻、舆论信号和公告信息。"; }
  parameters() {
    return [
      { name: "ticker", type: "string", description: "港股代码，如 0700.HK", required: true }
    ];
  }

  async execute(args) {
    const [news, filings] = await Promise.all([
      getNewsSnapshot(args.ticker).catch(() => ({ providerStatus: "missing", articles: [] })),
      getRecentFilings(args.ticker).catch(() => ({ providerStatus: "missing", filings: [] }))
    ]);

    const articles = (news?.articles || []).slice(0, 8);
    const filingList = (filings?.filings || []).slice(0, 5);

    return {
      ticker: args.ticker,
      newsCount: articles.length,
      newsProviderStatus: news?.providerStatus || "missing",
      articles: articles.map(a => ({
        title: a.title || "",
        summary: a.summary || "",
        source: a.source || "",
        date: a.date || ""
      })),
      filingsCount: filingList.length,
      filingsProviderStatus: filings?.providerStatus || "missing",
      filings: filingList.map(f => ({
        title: f.title || "",
        date: f.date || "",
        type: f.type || ""
      })),
      markdown: [
        newsSnapshotToMarkdown ? newsSnapshotToMarkdown(news) : "",
        filingsToMarkdown ? filingsToMarkdown(filings) : ""
      ].filter(Boolean).join("\n\n")
    };
  }
}
