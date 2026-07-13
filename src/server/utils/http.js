/** Shared HTTP primitives with consistent timeout and error handling. */
export async function fetchWithTimeout(url, {
  timeoutMs = 5000,
  userAgent = "EchoResearch/1.0",
  headers = {},
  errorPreviewLength = 160,
  ...options
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "User-Agent": userAgent, ...headers }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, errorPreviewLength)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchWithTimeout(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) }
  }));
}
