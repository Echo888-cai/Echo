import { sendJson } from "../utils/async.js";
import { getProviderStatus } from "../services/modelGateway.js";

const fmpKey = () => process.env.FMP_API_KEY;
const finnhubKey = () => process.env.FINNHUB_API_KEY;
const newsApiKey = () => process.env.ALPHAVANTAGE_API_KEY || process.env.TWELVEDATA_API_KEY;

export function handleStatusApi(req, res) {
  const hasFmp = fmpKey();
  const hasNews = finnhubKey() || newsApiKey();
  const aiStatus = getProviderStatus();

  sendJson(res, 200, {
    sources: [
      { id: "market", name: "港股行情", status: "ok", detail: "Tencent Finance 免费接口" },
      { id: "financials", name: "财务数据", status: hasFmp ? "ok" : "limited", detail: hasFmp ? "FMP 已配置" : "Tencent 财经基础数据（PE/PB/市值），详细财报需配置 FMP_API_KEY" },
      { id: "news", name: "新闻舆情", status: hasNews ? "ok" : "limited", detail: hasNews ? "Yahoo RSS + Bing + 东方财富" : "Yahoo RSS + Bing + 东方财富（国内可用）" },
      { id: "filings", name: "公告数据", status: "limited", detail: "HKEX 网页解析（Beta）" }
    ],
    ai: aiStatus,
    db: { companies: "654+" },
    updatedAt: new Date().toISOString()
  });
}
