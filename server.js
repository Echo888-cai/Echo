/**
 * Luvio server entry point.
 *
 * Thin HTTP layer: serves the static SPA and dispatches the JSON API the
 * frontend actually uses — company search, chat research, deep report,
 * research sessions, document parsing and status.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./src/server/utils/env.js";

// Routes
import { handleStatusApi } from "./src/server/routes/status.js";
import { handleDocumentParseApi } from "./src/server/routes/documents.js";
import { handleCompanySearch, handleCompanyResolve } from "./src/server/routes/companies.js";
import { handleSessionList, handleSessionClear, handleSessionGet, handleSessionDelete } from "./src/server/routes/research.js";
import { handleChatApi } from "./src/server/routes/chat.js";
import { handleReportGenerateApi } from "./src/server/routes/reports.js";
import { handleProfileList, handleProfileGet, handleProfileDelete } from "./src/server/routes/portraits.js";
import { handleEventsDigest } from "./src/server/routes/events.js";
import { handlePortfolioList, handlePortfolioUpsert, handlePortfolioDelete } from "./src/server/routes/portfolio.js";

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

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  // ── Company search ─────────────────────────────────────
  if (method === "GET" && url.startsWith("/api/companies/resolve")) return handleCompanyResolve(req, res);
  if (method === "GET" && url.startsWith("/api/companies/search")) return handleCompanySearch(req, res);

  // ── Status ─────────────────────────────────────────────
  if (method === "GET" && url.startsWith("/api/status")) return handleStatusApi(req, res);

  // ── Documents (upload parsing for the composer) ────────
  if (method === "POST" && url.startsWith("/api/parse-document")) return handleDocumentParseApi(req, res);

  // ── Research conversation + deep report ────────────────
  if (method === "POST" && url.startsWith("/api/chat")) return handleChatApi(req, res);
  if (method === "POST" && url.startsWith("/api/report/generate")) return handleReportGenerateApi(req, res);

  // ── Event engine digest ────────────────────────────────
  if (method === "GET" && url.startsWith("/api/events/digest")) return handleEventsDigest(req, res);

  // ── Portfolio (natural-language ledger + manual edit) ──
  if (method === "GET" && url.startsWith("/api/portfolio")) return handlePortfolioList(req, res);
  if (method === "POST" && url.startsWith("/api/portfolio")) return handlePortfolioUpsert(req, res);
  if (method === "DELETE" && url.startsWith("/api/portfolio")) return handlePortfolioDelete(req, res);

  // ── Company portraits (long-term memory) ───────────────
  if (method === "GET" && url.startsWith("/api/company/profiles")) return handleProfileList(req, res);
  if (method === "GET" && url.startsWith("/api/company/profile")) return handleProfileGet(req, res);
  if (method === "DELETE" && url.startsWith("/api/company/profile")) return handleProfileDelete(req, res);

  // ── Research sessions ──────────────────────────────────
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
