/**
 * 服务端公司解析——"任意美股/港股都能研究"的兑现点。
 *
 * 此前的断裂（2026-07-20 实测）：companies 表只有历史遗留行，服务端解析只是本地
 * DB ILIKE，而前端注释却承诺 "fall through to FMP + LLM"。于是 "alibaba" 在前端
 * 正确解析成 BABA 后，服务端因为表里没有 BABA 行直接答"我还没识别出要研究的公司"
 * ——对话-first 产品只能研究曾经研究过的公司。本文件把那句假承诺做成真的：
 *
 *   DB → 别名表（domain 唯一底账）→ FMP 真实搜索 → 行情探活 → LLM 结构化兜底
 *
 * 纪律：
 * - **验证先于建档**：只有外部数据源真实确认过的代码（FMP search-symbol 精确命中，
 *   或行情链能报出价格）才允许 ensureCompanyRow——未验证的猜测写进表就是脏数据，
 *   会永远留在搜索结果里。
 * - LLM 只出候选，不出结论：它给的代码必须再过一遍同样的验证门，过不了就诚实
 *   unresolved，绝不"模型说有就有"（红线 2）。
 * - 读写分离：resolve/verify 端点只读；建档只发生在研究链路（resolveResearchCompany）。
 */
import { getCompanyByTickerComplete, searchCompanies, ensureCompanyRow } from "@echo/db/repositories/companyRepository.js";
import { detectMarket, fetchLiveQuote, fmpSearchSymbol, fmpSearchName, isFmpSearchConfigured, type FmpSymbolHit } from "@echo/data-plane";
import { extractHkTicker, extractUsTickerToken, normalizeQuestionText } from "@echo/domain/company-identity";
import { HK_COMPANY_ALIASES, US_COMPANY_ALIASES } from "@echo/domain/company-aliases";
import { createHash } from "node:crypto";
import { modelAnswer, parseJsonObject, providerConfig } from "./modelGateway.js";
import { getCachedJson, setCachedJson } from "./cache.js";

/** 美股主板（含 ETF 主场所）。FMP 搜索会吐全球挂牌，候选只认这些交易所。 */
const US_MAIN_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSE AMERICAN", "CBOE"]);

export interface ServerResolvedCompany {
  ticker: string;
  nameZh: string;
  nameEn: string;
  industry: string;
  /** 命中路径，进 llm_audit/日志用；不进契约。 */
  source: "db" | "alias" | "fmp" | "probe" | "llm";
}

function fromDbRow(row: any): ServerResolvedCompany {
  return {
    ticker: row.ticker,
    nameZh: row.nameZh || row.ticker,
    nameEn: row.nameEn || "",
    industry: row.industry || "",
    source: "db"
  };
}

/** 行情链探活：任一已注册源能报出价格即视为"这个代码真实存在且可研究"。 */
async function probeQuote(ticker: string): Promise<boolean> {
  try {
    const { result } = await fetchLiveQuote(ticker);
    return result?.price != null;
  } catch {
    return false;
  }
}

/** FMP 精确代码命中（限美股主板）；未配 key 返回 null。 */
async function fmpExactHit(ticker: string): Promise<FmpSymbolHit | null> {
  if (!isFmpSearchConfigured()) return null;
  const symbol = ticker.trim().toUpperCase();
  const hits = await fmpSearchSymbol(symbol);
  return hits.find((h) => h.symbol === symbol && (!h.exchange || US_MAIN_EXCHANGES.has(String(h.exchange).toUpperCase()))) || null;
}

/**
 * 对一个候选代码做"DB 或外部源"验证，返回可用的公司形状（不写库）。
 * 港股代码走行情探活（FMP 免费档不认港股）；美股优先 FMP 精确命中（顺带拿到官方名），
 * 没 key 或没命中再探活。
 */
async function verifyCandidate(ticker: string, patch: { nameZh?: string; nameEn?: string } = {}): Promise<ServerResolvedCompany | null> {
  const market = detectMarket(ticker);
  if (market === "unsupported") return null;
  const existing = await getCompanyByTickerComplete(ticker);
  if (existing) return fromDbRow(existing);
  if (market === "US") {
    const exact = await fmpExactHit(ticker);
    if (exact) {
      return { ticker: exact.symbol, nameZh: patch.nameZh || exact.name || exact.symbol, nameEn: patch.nameEn || exact.name || "", industry: "美股", source: "fmp" };
    }
  }
  if (await probeQuote(ticker)) {
    const normalized = ticker.trim().toUpperCase();
    const withSuffix = market === "HK" && !normalized.endsWith(".HK") ? `${normalized.padStart(4, "0")}.HK` : normalized;
    return {
      ticker: withSuffix,
      nameZh: patch.nameZh || patch.nameEn || withSuffix,
      nameEn: patch.nameEn || "",
      industry: market === "HK" ? "港股" : "美股",
      source: "probe"
    };
  }
  return null;
}

const RESOLVER_SYSTEM_PROMPT = `你是金融产品的公司代码解析器，负责把用户口中的公司名映射成股票代码。只输出 JSON，不回答任何问题。
输出格式：{"ticker":"...","market":"US"|"HK"|"UNKNOWN","nameZh":"...","nameEn":"...","confidence":0.0-1.0}
规则：
- 只考虑美股与港股主板上市公司；美股输出裸代码（如 LRCX），港股输出四位数字加 .HK（如 0020.HK）。
- 名字对不上任何上市公司、或指的是行业词/基金/指数/加密资产/未上市公司时，market 用 UNKNOWN。
- 宁可 UNKNOWN，不要猜一个可能不存在的代码。`;

/** LLM 兜底：中文名/生僻叫法 → 候选代码。**结果必须再过 verifyCandidate**。 */
async function llmCandidate(name: string, userId: string): Promise<{ ticker: string; nameZh?: string; nameEn?: string } | null> {
  if (!providerConfig()) return null;
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  const cacheId = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  const cached = await getCachedJson<any>("company-resolve", cacheId);
  if (cached?.ticker) return cached;
  const result = await modelAnswer(RESOLVER_SYSTEM_PROMPT, `公司名：${name}`, userId, undefined, {
    kind: "resolver", thinking: false, maxTokens: 160, json: true
  });
  const parsed = result ? parseJsonObject(result.content) : null;
  if (!parsed?.ticker || parsed.market === "UNKNOWN" || Number(parsed.confidence) < 0.6) return null;
  const candidate = { ticker: String(parsed.ticker).toUpperCase(), nameZh: parsed.nameZh || undefined, nameEn: parsed.nameEn || undefined };
  // 只缓存候选，不缓存"已验证"——验证门每次都要真实过（源可能下线、代码可能退市）。
  await setCachedJson("company-resolve", cacheId, candidate, 7 * 86_400);
  return candidate;
}

/** FMP 名称搜索里挑最可信的美股主板候选（模糊结果必须过验证门）。 */
function bestUsNameHit(hits: FmpSymbolHit[]): FmpSymbolHit | null {
  return hits.find((h) => h.exchange && US_MAIN_EXCHANGES.has(String(h.exchange).toUpperCase())) || null;
}

/**
 * 自由文本 → 已验证的公司（只读，不建档）。tRPC companies.resolve 的真实实现，
 * 也是研究链路无 ticker 时的解析入口。
 */
export async function resolveCompanyQuery(query: string, userId = "system"): Promise<{ company: ServerResolvedCompany | null; reason?: string }> {
  const q = normalizeQuestionText(query).trim();
  if (q.length < 2) return { company: null, reason: "empty" };

  // 1) 显式港股代码
  const hk = extractHkTicker(q);
  if (hk) {
    const company = await verifyCandidate(hk);
    return company ? { company } : { company: null, reason: "hk_not_found" };
  }

  // 2) 别名底账（domain 唯一一份；中文名的主要命中路径）
  const hkAlias = HK_COMPANY_ALIASES.find((item) => item.pattern.test(q));
  if (hkAlias) {
    const company = await verifyCandidate(hkAlias.ticker);
    if (company) return { company: { ...company, source: "alias" } };
  }
  const usAlias = US_COMPANY_ALIASES.find((item) => item.pattern.test(q));
  if (usAlias) {
    const company = await verifyCandidate(usAlias.ticker, { nameZh: usAlias.name });
    if (company) return { company: { ...company, source: "alias" } };
  }

  // 3) 本地库（历史研究沉淀）
  const direct = await getCompanyByTickerComplete(q);
  const dbMatch = direct || (await searchCompanies(q, { limit: 1 }))[0];
  if (dbMatch) {
    const complete = direct || (await getCompanyByTickerComplete(dbMatch.ticker));
    if (complete) return { company: fromDbRow(complete) };
  }

  // 4) 裸美股代码词元（"what about rklb"）
  const usToken = extractUsTickerToken(q);
  if (usToken) {
    const company = await verifyCandidate(usToken);
    if (company) return { company };
  }

  // 5) FMP 名称搜索（英文名/拼音："lam research" → LRCX）
  if (isFmpSearchConfigured() && /[A-Za-z]/.test(q)) {
    const hit = bestUsNameHit(await fmpSearchName(q));
    if (hit) {
      const company = await verifyCandidate(hit.symbol, { nameEn: hit.name });
      if (company) return { company };
    }
  }

  // 6) LLM 兜底（中文名："泛林集团" → LRCX、"商汤" → 0020.HK），候选必须过同一道验证门
  const candidate = await llmCandidate(q, userId);
  if (candidate) {
    const company = await verifyCandidate(candidate.ticker, candidate);
    if (company) return { company: { ...company, source: "llm" } };
  }

  return { company: null, reason: "not_found" };
}

/**
 * tRPC companies.verify 的真实实现：先库、再 FMP 精确、再行情探活；
 * 全落空给"你是不是想找"候选（库 + FMP 名称搜索）。只读。
 */
export async function verifyTickerListing(ticker: string): Promise<{ status: "verified" | "not_found"; name?: string; suggestions?: { ticker: string; name: string }[] }> {
  const symbol = String(ticker || "").trim();
  if (!symbol) return { status: "not_found", suggestions: [] };
  const existing = await getCompanyByTickerComplete(symbol);
  if (existing) return { status: "verified", name: existing.nameZh || existing.nameEn || existing.ticker };
  if (detectMarket(symbol) === "US") {
    const exact = await fmpExactHit(symbol);
    if (exact) return { status: "verified", name: exact.name || exact.symbol };
  }
  if (await probeQuote(symbol)) return { status: "verified", name: "" };
  const [dbSuggestions, fmpHits] = await Promise.all([
    searchCompanies(symbol, { limit: 5 }),
    isFmpSearchConfigured() ? fmpSearchName(symbol) : Promise.resolve([] as FmpSymbolHit[])
  ]);
  const suggestions = [
    ...dbSuggestions.map((item: any) => ({ ticker: item.ticker, name: item.nameZh || item.nameEn || item.ticker })),
    ...fmpHits.filter((h) => h.exchange && US_MAIN_EXCHANGES.has(String(h.exchange).toUpperCase())).map((h) => ({ ticker: h.symbol, name: h.name || h.symbol }))
  ].filter((item, index, list) => list.findIndex((x) => x.ticker === item.ticker) === index).slice(0, 5);
  return { status: "not_found", suggestions };
}

/**
 * 研究链路的公司入口（唯一会建档的路径）：
 * - 前端给了 ticker：库里有→直接用；没有→验证→建档→继续。此前这里是死路 null。
 * - 没给 ticker：对问题全文跑 resolveCompanyQuery，命中后同样建档。
 */
export async function resolveResearchCompany(
  inputCompany: { ticker?: string; nameZh?: string } | undefined,
  question: string,
  userId: string
) {
  if (inputCompany?.ticker) {
    const existing = await getCompanyByTickerComplete(inputCompany.ticker);
    if (existing) return existing;
    const verified = await verifyCandidate(inputCompany.ticker, { nameZh: inputCompany.nameZh });
    if (!verified) return null;
    return ensureCompanyRow(verified.ticker, { nameZh: verified.nameZh, nameEn: verified.nameEn, industry: verified.industry });
  }
  const { company } = await resolveCompanyQuery(question, userId);
  if (!company) return null;
  const existing = await getCompanyByTickerComplete(company.ticker);
  if (existing) return existing;
  return ensureCompanyRow(company.ticker, { nameZh: company.nameZh, nameEn: company.nameEn, industry: company.industry });
}
