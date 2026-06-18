/**
 * Luvio server entry point.
 *
 * Phase-2: added company search, watchlist CRUD, document persistence,
 * market snapshot caching, report composer, and unified API format.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./src/server/utils/env.js";
import { withTimeout, sendJson } from "./src/server/utils/async.js";
import { getMarketSnapshot } from "./src/marketData.js";
import { getNewsSnapshot } from "./src/newsData.js";
import { getFinancials, financialsToMarkdown } from "./src/financialData.js";
import { getRecentFilings, filingsToMarkdown } from "./src/filingData.js";
import { generateResearchReport } from "./src/data.js";
import { marketSnapshotToMarkdown } from "./src/marketData.js";
import { newsSnapshotToMarkdown } from "./src/newsData.js";
import { buildPromptContext, PROMPTS, INVESTMENT_OUTPUT_REQUIREMENTS } from "./src/prompts.js";
import { callModel } from "./src/server/services/modelGateway.js";

// Routes
import { handleAgentApi, handleAgentFollowup } from "./src/server/routes/agent.js";
import { handleMarketApi, handleNewsApi, handleFinancialsApi, handleFilingsApi } from "./src/server/routes/marketData.js";
import { handleStatusApi } from "./src/server/routes/status.js";
import { handleDocumentParseApi, handleDocumentList, handleDocumentUpload, handleDocumentGet, handleDocumentDelete } from "./src/server/routes/documents.js";
import { handleCompanySearch, handleCompanyByTicker, handleCompanyHealth } from "./src/server/routes/companies.js";
import { handleWatchlistList, handleWatchlistAdd, handleWatchlistGet, handleWatchlistUpdate, handleWatchlistDelete } from "./src/server/routes/watchlist.js";
import { handleSessionList, handleSessionClear, handleSessionGet, handleSessionDelete, handleSessionMemo } from "./src/server/routes/research.js";
import { handleChatApi } from "./src/server/routes/chat.js";
import { handleReportGenerateApi } from "./src/server/routes/reports.js";

// Data repositories for snapshot caching
import { saveMarketSnapshot } from "./src/db/index.js";

const root = fileURLToPath(new URL(".", import.meta.url));
loadEnvFile(root);

const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = normalize(cleanPath === "/" ? "/index.html" : cleanPath);
  return join(root, normalized);
}

async function handleReportApi(req, res) {
  try {
    const raw = await new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => resolve(body ? JSON.parse(body) : {}));
      req.on("error", reject);
    });
    const { company, filings = [], question = "" } = raw;
    if (!company?.ticker) {
      sendJson(res, 400, { error: "缺少公司上下文" });
      return;
    }
    const [marketSnapshot, newsSnapshot, financialsData, filingsData] = await Promise.all([
      getMarketSnapshot(company.ticker),
      getNewsSnapshot(company),
      withTimeout(getFinancials(company.ticker), 5000, { providerStatus: "missing", errors: ["超时"] }),
      withTimeout(getRecentFilings(company.ticker), 5000, { providerStatus: "missing", errors: ["超时"], filings: [] })
    ]);
    const context = `${buildPromptContext(company, question, filings, financialsData)}

${marketSnapshotToMarkdown(marketSnapshot)}

${financialsToMarkdown(financialsData)}

${filingsToMarkdown(filingsData)}

${newsSnapshotToMarkdown(newsSnapshot)}

核心规则：你必须直接回答四个问题，然后按 8 章结构展开判断。
${INVESTMENT_OUTPUT_REQUIREMENTS}`;

    const modelResult = await callModel({ system: PROMPTS.research.system, user: context });
    if (modelResult?.content) {
      sendJson(res, 200, { mode: "model", provider: modelResult.provider, model: modelResult.model, marketSnapshot, newsSnapshot, markdown: modelResult.content });
      return;
    }

    const localReport = `${generateResearchReport(company, filings, question)}

## 实时行情状态
${marketSnapshotToMarkdown(marketSnapshot)}

## 新闻与舆论状态
${newsSnapshotToMarkdown(newsSnapshot)}`;

    sendJson(res, 200, { mode: "local", marketSnapshot, newsSnapshot, markdown: localReport });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "报告生成失败" });
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // ── Company routes ─────────────────────────────────────
  if (method === "GET" && url.startsWith("/api/companies/search")) return handleCompanySearch(req, res);
  if (method === "GET" && url.startsWith("/api/companies/health")) {
    const ticker = new URL(url, `http://${req.headers.host || "127.0.0.1"}`).searchParams.get("ticker");
    return handleCompanyHealth(req, res, ticker || "");
  }
  // Match /api/companies/:ticker (not sub-routes)
  if (method === "GET" && /^\/api\/companies\/[^/]+$/.test(url)) {
    const ticker = url.replace("/api/companies/", "");
    return handleCompanyByTicker(req, res, ticker);
  }

  // ── Watchlist routes ───────────────────────────────────
  if (method === "GET" && url === "/api/watchlist") return handleWatchlistList(req, res);
  if (method === "POST" && url === "/api/watchlist") return handleWatchlistAdd(req, res);
  if (method === "GET" && /^\/api\/watchlist\/[^/]+$/.test(url)) {
    const id = url.replace("/api/watchlist/", "");
    return handleWatchlistGet(req, res, id);
  }
  if (method === "PATCH" && /^\/api\/watchlist\/[^/]+$/.test(url)) {
    const id = url.replace("/api/watchlist/", "");
    return handleWatchlistUpdate(req, res, id);
  }
  if (method === "DELETE" && /^\/api\/watchlist\/[^/]+$/.test(url)) {
    const id = url.replace("/api/watchlist/", "");
    return handleWatchlistDelete(req, res, id);
  }

  // ── Document routes ────────────────────────────────────
  if (method === "GET" && /^\/api\/documents(?:\?|$)/.test(url)) return handleDocumentList(req, res);
  if (method === "POST" && /^\/api\/documents$/.test(url.split("?")[0])) return handleDocumentUpload(req, res);
  if (method === "GET" && /^\/api\/documents\/[^/]+$/.test(url.split("?")[0])) {
    const id = url.replace("/api/documents/", "").split("?")[0];
    return handleDocumentGet(req, res, id);
  }
  if (method === "DELETE" && /^\/api\/documents\/[^/]+$/.test(url.split("?")[0])) {
    const id = url.replace("/api/documents/", "").split("?")[0];
    return handleDocumentDelete(req, res, id);
  }

  // ── Legacy /api endpoints ──────────────────────────────
  if (method === "GET" && url.startsWith("/api/status")) return handleStatusApi(req, res);
  if (method === "GET" && url.startsWith("/api/market")) return handleMarketApi(req, res);
  if (method === "GET" && url.startsWith("/api/news")) return handleNewsApi(req, res);
  if (method === "GET" && url.startsWith("/api/financials")) return handleFinancialsApi(req, res);
  if (method === "GET" && url.startsWith("/api/filings")) return handleFilingsApi(req, res);
  if (method === "POST" && url.startsWith("/api/parse-document")) return handleDocumentParseApi(req, res);
  if (method === "POST" && url === "/api/agent/followup") return handleAgentFollowup(req, res);
  if (method === "POST" && url.startsWith("/api/chat")) return handleChatApi(req, res);
  if (method === "POST" && url.startsWith("/api/agent")) return handleAgentApi(req, res);
  if (method === "POST" && url.startsWith("/api/report/generate")) return handleReportGenerateApi(req, res);
  if (method === "POST" && url.startsWith("/api/report")) return handleReportApi(req, res);

  // ── Research session routes ──────────────────────────
  if (method === "GET" && url.startsWith("/api/research/sessions") && !url.includes("/api/research/sessions/")) return handleSessionList(req, res);
  if (method === "DELETE" && url.split("?")[0] === "/api/research/sessions") return handleSessionClear(req, res);
  if (method === "GET" && /^\/api\/research\/sessions\/[^/]+$/.test(url.split("?")[0])) {
    const id = url.replace("/api/research/sessions/", "").split("?")[0];
    return handleSessionGet(req, res, id);
  }
  if (method === "DELETE" && /^\/api\/research\/sessions\/[^/]+$/.test(url.split("?")[0])) {
    const id = url.replace("/api/research/sessions/", "").split("?")[0];
    return handleSessionDelete(req, res, id);
  }
  if (method === "POST" && /^\/api\/research\/sessions\/[^/]+\/memo$/.test(url.split("?")[0])) {
    const id = url.split("?")[0].match(/\/api\/research\/sessions\/([^/]+)\/memo/)?.[1] || "";
    return handleSessionMemo(req, res, id);
  }

  // ── Static file fallback ───────────────────────────────
  try {
    const filePath = resolvePath(url);
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(root, "index.html"));
      res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Luvio is running at http://127.0.0.1:${port}`);
});
