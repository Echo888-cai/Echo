export async function requestAgentReply(payload) {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`模型网关返回 ${response.status}`);
  }

  return response.json();
}

export async function requestMarketSnapshot(ticker) {
  const response = await fetch(`/api/market?ticker=${encodeURIComponent(ticker)}`);
  if (!response.ok) {
    throw new Error(`行情网关返回 ${response.status}`);
  }
  return response.json();
}

export async function requestDocumentParse(payload) {
  const response = await fetch("/api/parse-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`资料解析返回 ${response.status}`);
  }

  return response.json();
}

export async function requestNewsSnapshot(ticker) {
  const response = await fetch(`/api/news?ticker=${encodeURIComponent(ticker)}`);
  if (!response.ok) {
    throw new Error(`新闻网关返回 ${response.status}`);
  }
  return response.json();
}

export async function requestResearchReport(payload) {
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`报告网关返回 ${response.status}`);
  }

  return response.json();
}

export async function requestApiStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error(`状态网关返回 ${response.status}`);
  }
  return response.json();
}

// ── Phase-2 API clients ─────────────────────────────────

export async function requestCompanySearch(query) {
  const response = await fetch(`/api/companies/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`公司搜索返回 ${response.status}`);
  return response.json(); // { ok, data: { companies, total } }
}

export async function requestCompanyDetail(ticker) {
  const response = await fetch(`/api/companies/${encodeURIComponent(ticker)}`);
  if (!response.ok) throw new Error(`公司详情返回 ${response.status}`);
  return response.json();
}

export async function requestWatchlist() {
  const response = await fetch("/api/watchlist");
  if (!response.ok) throw new Error(`关注列表返回 ${response.status}`);
  return response.json();
}

export async function requestWatchlistAdd(payload) {
  const response = await fetch("/api/watchlist", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`添加关注返回 ${response.status}`);
  return response.json();
}

export async function requestWatchlistDelete(id) {
  const response = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
  return response.json();
}

export async function requestDocumentUpload(payload) {
  const response = await fetch("/api/documents", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`文档上传返回 ${response.status}`);
  return response.json();
}

export async function requestSessionList(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(`/api/research/sessions${qs ? "?" + qs : ""}`);
  if (!response.ok) throw new Error(`研究会话返回 ${response.status}`);
  return response.json();
}

export async function requestSessionDetail(id) {
  const response = await fetch(`/api/research/sessions/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`研究会话详情返回 ${response.status}`);
  return response.json();
}

export async function requestAgentFollowup(payload) {
  const response = await fetch("/api/agent/followup", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`跟进问题返回 ${response.status}`);
  return response.json();
}
