/**
 * FMP `stable` symbol/name search — the real backing for server-side company
 * resolution (application/companyResolution.ts).
 *
 * 实测边界（与 fmpFundamentalsAdapter 同一批探测 + PLAN §7 事实表）：
 * - `search-symbol` 精确命中代码，免费档可用；
 * - `search-name` 是模糊匹配，会把同名公司的所有交易所挂牌都吐回来（腾讯会同时给
 *   TCEHY 和 TCTZF），**单靠它挑第一条不可靠**——调用方必须再做交易所过滤 + 探活验证；
 * - 中文查询基本不命中（FMP 索引不含中文名），中文名走 LLM 兜底，不在这里硬试。
 *
 * 这里只做取数与最小规整，怎么挑候选是应用层的判断。
 */
const BASE = "https://financialmodelingprep.com/stable";

export interface FmpSymbolHit {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string | null;
}

async function fetchJson(path: string, apiKey: string): Promise<any> {
  const url = `${BASE}/${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`fmp ${path.split("?")[0]} ${response.status}`);
  const body: any = await response.json();
  // FMP 对 premium 门槛/退役端点同样返回 200 + 错误体（见 fmpFundamentalsAdapter）。
  if (body && !Array.isArray(body) && (body["Error Message"] || body.error)) {
    throw new Error(`fmp ${path.split("?")[0]} error: ${body["Error Message"] || body.error}`);
  }
  return body;
}

function normalizeHits(body: any): FmpSymbolHit[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((item: any) => ({
      symbol: String(item.symbol || "").toUpperCase(),
      name: String(item.name || item.companyName || ""),
      exchange: item.exchangeShortName || item.exchange || null,
      currency: item.currency || null
    }))
    .filter((item) => item.symbol);
}

export function isFmpSearchConfigured(): boolean {
  return Boolean(process.env.FMP_API_KEY);
}

/** 精确代码查询（search-symbol）。未配 key 或失败返回 []，不抛给研究主链路。 */
export async function fmpSearchSymbol(symbol: string): Promise<FmpSymbolHit[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || !symbol.trim()) return [];
  try {
    const body = await fetchJson(`search-symbol?query=${encodeURIComponent(symbol.trim())}&limit=8`, apiKey);
    return normalizeHits(body);
  } catch {
    return [];
  }
}

/** 名称模糊查询（search-name）。结果只是候选池，调用方必须过滤交易所并验证。 */
export async function fmpSearchName(name: string): Promise<FmpSymbolHit[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || !name.trim()) return [];
  try {
    const body = await fetchJson(`search-name?query=${encodeURIComponent(name.trim())}&limit=10`, apiKey);
    return normalizeHits(body);
  } catch {
    return [];
  }
}
