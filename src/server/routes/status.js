import { sendJson } from "../utils/async.js";
import { getProviderStatus } from "../services/modelGateway.js";

const fmpKey = () => process.env.FMP_API_KEY;
const finnhubKey = () => process.env.FINNHUB_API_KEY;
const newsApiKey = () => process.env.ALPHAVANTAGE_API_KEY || process.env.TWELVEDATA_API_KEY;
const webSearchKey = () => process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY;

export function handleStatusApi(req, res) {
  const hasFmp = fmpKey();
  const hasNews = finnhubKey() || newsApiKey();
  const hasWebSearch = webSearchKey();
  const aiStatus = getProviderStatus();

  sendJson(res, 200, {
    sources: [
      { id: "market", name: "港美股行情", status: "ok", detail: "港股 Tencent Finance；美股 Finnhub / Alpha Vantage / Yahoo" },
      { id: "financials", name: "财务数据", status: hasFmp ? "ok" : "limited", detail: hasFmp ? "FMP 已配置（注意：免费档不含港股，港股财报仍走腾讯/Yahoo 基础数据；港股完整三表需 FMP 付费档或其它港股数据源）" : "腾讯财经基础数据（PE/PB/市值）；港股完整三表需付费数据源" },
      { id: "news", name: "新闻舆情", status: hasNews ? "ok" : "limited", detail: hasNews ? "Yahoo RSS + Bing + 东方财富" : "Yahoo RSS + Bing + 东方财富（国内可用）" },
      { id: "web_evidence", name: "网页证据层", status: hasWebSearch ? "ok" : "limited", detail: hasWebSearch ? "Tavily / SerpAPI 已配置，证据带正文抓取、来源校验与可信度评分，缓存到 SQLite" : "公开兜底：DuckDuckGo + Yahoo + Bing，已做 404 校验与去垃圾；配 TAVILY_API_KEY（免费 1000/月）可解锁稳定全覆盖" },
      { id: "filings", name: "公告数据", status: "limited", detail: "HKEX 网页解析（Beta）" }
    ],
    evidenceBacklog: [
      { id: "financial_snapshots", label: "财报三表与估值倍数", priority: "P0", providers: ["FMP", "EODHD", "Finnhub"] },
      { id: "hkex_filings", label: "HKEX 公告与公司 IR PDF", priority: "P0", providers: ["HKEXnews", "Company IR"] },
      { id: "web_evidence", label: "可信 web 搜索证据层", priority: "P1", providers: ["Bing Search", "SerpAPI"] },
      { id: "analyst_estimates", label: "一致预期与目标价", priority: "P1", providers: ["Finnhub", "FMP", "EODHD"] }
    ],
    ai: aiStatus,
    db: { companies: "654+" },
    updatedAt: new Date().toISOString()
  });
}
