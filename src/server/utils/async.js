/**
 * Timeout wrapper for any promise.
 * - Falls back to `fallback` (or `null`) on rejection OR when the deadline hits.
 * - Keeps the request handler from blocking on flaky upstream APIs.
 */
export function withTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    promise.catch((error) =>
      fallback && typeof fallback === "object"
        ? { ...fallback, errors: [...(fallback.errors || []), error.message || "request failed"] }
        : fallback
    ),
    timeout
  ]).finally(() => clearTimeout(timer));
}

/** Parse a JSON request body. Throws on parse error or oversized payload. */
export function readJsonBody(req, { maxBytes = 8_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/** Generate a short request ID for tracing. */
function requestId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Wrap a successful response body in the unified API envelope.
 *   { ok: true, data: ..., meta: { requestId, asOf } }
 */
export function apiOk(data, meta = {}) {
  return {
    ok: true,
    data,
    meta: { requestId: requestId(), asOf: new Date().toISOString(), ...meta }
  };
}

/**
 * Send a successful response with the unified envelope.
 */
export function sendOk(res, data, meta = {}) {
  sendJson(res, 200, apiOk(data, meta));
}

/**
 * Wrap an error in the unified API envelope:
 *   { ok: false, error: { code, message, details? }, meta: { requestId } }
 */
export function apiError(code, message, details = null) {
  const error = { code, message };
  if (details) error.details = details;
  return {
    ok: false,
    error,
    meta: { requestId: requestId() }
  };
}

/**
 * Send an error response with the unified envelope.
 */
export function sendError(res, code, message, details = null) {
  const status = typeof code === "number" ? code : String(code).startsWith("5") ? 500 : 400;
  sendJson(res, status, apiError(code, message, details));
}

/**
 * Send a 200 OK response in the old flat format (backward-compatible).
 */
export function sendFlat(res, payload) {
  sendJson(res, 200, payload);
}
