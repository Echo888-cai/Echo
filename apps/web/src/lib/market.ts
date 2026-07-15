// React port of the server-side market classification — only the bit
// watch/portfolio need (market badge). A-shares were delisted from coverage
// (docs/PLAN.md v3 市场聚焦)：existing .SS/.SZ records map to "unsupported"
// and render as "已停止覆盖" — never silently dropped.
export type Market = "US" | "HK" | "unsupported";

export function detectMarket(ticker: string | null | undefined): Market {
  const t = String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/\.US$/.test(t)) return "US";
  if (/\.HK$/.test(t)) return "HK";
  if (/\.(SS|SZ)$/.test(t)) return "unsupported";
  if (/^\d{6}$/.test(t)) return "unsupported";
  if (/^\d{1,5}$/.test(t)) return "HK";
  if (/^[A-Z][A-Z.]{0,6}$/.test(t)) return "US";
  return "HK";
}

export function marketLabel(ticker: string | null | undefined): "美股" | "港股" | "已停止覆盖" {
  const m = detectMarket(ticker);
  if (m === "US") return "美股";
  if (m === "HK") return "港股";
  return "已停止覆盖";
}
