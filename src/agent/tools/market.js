/**
 * MarketTool - 获取实时行情数据
 */
import { Tool } from "../tool.js";
import { getMarketSnapshot, marketSnapshotToMarkdown } from "../../marketData.js";

export class MarketTool extends Tool {
  name() { return "get_market_data"; }
  description() { return "获取指定港股代码的实时行情数据，包括价格、涨跌幅、市值、PE。"; }
  parameters() {
    return [
      { name: "ticker", type: "string", description: "港股代码，如 0700.HK", required: true }
    ];
  }

  async execute(args) {
    const snapshot = await getMarketSnapshot(args.ticker);
    const md = marketSnapshotToMarkdown(snapshot);
    return {
      ticker: args.ticker,
      price: snapshot.price || null,
      changePercent: snapshot.changePercent || null,
      marketCap: snapshot.marketCap || null,
      pe: snapshot.pe || null,
      currency: snapshot.currency || "HKD",
      source: snapshot.source || "",
      providerStatus: snapshot.providerStatus || "missing",
      markdown: md
    };
  }
}
