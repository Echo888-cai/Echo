// React port of src/ui/resolve.js — company identification/resolution (aliases,
// dual-listing, US-ticker heuristics, intent classification for the research
// composer). Pure functions + one API-calling function (resolveCompany); ported
// as-is since this is exactly the kind of hand-tuned heuristic table that must
// not drift from the legacy behavior it's replacing.
import { companiesApi, type ResolvedCompany } from "./api";
import { extractHkTicker, extractUsTickerToken } from "@echo/domain/company-identity";

const companyAliases: { pattern: RegExp; ticker: string }[] = [
  { pattern: /腾讯控股|腾讯|Tencent/i, ticker: "0700.HK" },
  { pattern: /阿里巴巴|阿里(?!健康|影业)|Alibaba/i, ticker: "9988.HK" },
  { pattern: /阿里健康/i, ticker: "0241.HK" },
  { pattern: /阿里影业/i, ticker: "1060.HK" },
  { pattern: /美团/i, ticker: "3690.HK" },
  { pattern: /小米/i, ticker: "1810.HK" },
  { pattern: /比亚迪/i, ticker: "1211.HK" },
  { pattern: /京东/i, ticker: "9618.HK" },
  { pattern: /百度/i, ticker: "9888.HK" },
  { pattern: /快手/i, ticker: "1024.HK" },
  { pattern: /网易/i, ticker: "9999.HK" },
  { pattern: /联想/i, ticker: "0992.HK" },
  { pattern: /耐世特/i, ticker: "1316.HK" },
  { pattern: /地平线/i, ticker: "9660.HK" },
  { pattern: /港交所|香港交易所/i, ticker: "0388.HK" }
];

// US aliases (name + ticker). Chinese names only resolve via this table (FMP
// search doesn't understand Chinese); English names/pinyin/tickers that miss
// this table fall through to /api/companies/resolve (FMP + LLM) in resolveCompany.
// Other US tickers also work via $TICKER or TICKER.US, e.g. $PLTR, PLTR.US.
const usAliases: { pattern: RegExp; ticker: string; name: string }[] = [
  { pattern: /苹果|Apple|\bAAPL\b/i, ticker: "AAPL", name: "苹果 Apple" },
  { pattern: /英伟达|NVIDIA|\bNVDA\b/i, ticker: "NVDA", name: "英伟达 NVIDIA" },
  { pattern: /特斯拉|Tesla|\bTSLA\b/i, ticker: "TSLA", name: "特斯拉 Tesla" },
  { pattern: /微软|Microsoft|\bMSFT\b/i, ticker: "MSFT", name: "微软 Microsoft" },
  { pattern: /谷歌|Google|Alphabet|\bGOOGL?\b/i, ticker: "GOOGL", name: "谷歌 Alphabet" },
  { pattern: /亚马逊|Amazon|\bAMZN\b/i, ticker: "AMZN", name: "亚马逊 Amazon" },
  { pattern: /\bMeta\b|Facebook|\bMETA\b/i, ticker: "META", name: "Meta" },
  { pattern: /奈飞|网飞|Netflix|\bNFLX\b/i, ticker: "NFLX", name: "奈飞 Netflix" },
  { pattern: /英特尔|Intel|\bINTC\b/i, ticker: "INTC", name: "英特尔 Intel" },
  { pattern: /\bAMD\b|超威/i, ticker: "AMD", name: "AMD" },
  { pattern: /台积电|TSMC|\bTSM\b/i, ticker: "TSM", name: "台积电 TSMC" },
  { pattern: /美光|镁光|Micron|\bMU\b/i, ticker: "MU", name: "美光科技 Micron" },
  { pattern: /博通|Broadcom|\bAVGO\b/i, ticker: "AVGO", name: "博通 Broadcom" },
  { pattern: /高通|Qualcomm|\bQCOM\b/i, ticker: "QCOM", name: "高通 Qualcomm" },
  { pattern: /阿斯麦|阿斯麦尔|\bASML\b/i, ticker: "ASML", name: "阿斯麦 ASML" },
  { pattern: /应用材料|Applied Materials|\bAMAT\b/i, ticker: "AMAT", name: "应用材料 Applied Materials" },
  { pattern: /美满|Marvell|\bMRVL\b/i, ticker: "MRVL", name: "美满电子 Marvell" },
  { pattern: /\bARM\b|安谋/i, ticker: "ARM", name: "ARM" },
  { pattern: /甲骨文|Oracle|\bORCL\b/i, ticker: "ORCL", name: "甲骨文 Oracle" },
  { pattern: /思科|Cisco|\bCSCO\b/i, ticker: "CSCO", name: "思科 Cisco" },
  { pattern: /Adobe|\bADBE\b/i, ticker: "ADBE", name: "Adobe" },
  { pattern: /Salesforce|赛富时|\bCRM\b/i, ticker: "CRM", name: "Salesforce" },
  { pattern: /Palantir|\bPLTR\b/i, ticker: "PLTR", name: "Palantir" },
  { pattern: /Snowflake|\bSNOW\b/i, ticker: "SNOW", name: "Snowflake" },
  { pattern: /Coinbase|\bCOIN\b/i, ticker: "COIN", name: "Coinbase" },
  { pattern: /优步|Uber|\bUBER\b/i, ticker: "UBER", name: "优步 Uber" },
  { pattern: /迪士尼|Disney|\bDIS\b/i, ticker: "DIS", name: "迪士尼 Disney" },
  { pattern: /星巴克|Starbucks|\bSBUX\b/i, ticker: "SBUX", name: "星巴克 Starbucks" },
  { pattern: /麦当劳|McDonald|\bMCD\b/i, ticker: "MCD", name: "麦当劳 McDonald's" },
  { pattern: /可口可乐|Coca[ -]?Cola/i, ticker: "KO", name: "可口可乐 Coca-Cola" },
  { pattern: /百事|Pepsi|\bPEP\b/i, ticker: "PEP", name: "百事 PepsiCo" },
  { pattern: /沃尔玛|Walmart|\bWMT\b/i, ticker: "WMT", name: "沃尔玛 Walmart" },
  { pattern: /耐克|Nike/i, ticker: "NKE", name: "耐克 Nike" },
  { pattern: /波音|Boeing/i, ticker: "BA", name: "波音 Boeing" },
  { pattern: /摩根大通|小摩|JPMorgan|JP\s?Morgan|\bJPM\b/i, ticker: "JPM", name: "摩根大通 JPMorgan" },
  { pattern: /高盛|Goldman/i, ticker: "GS", name: "高盛 Goldman Sachs" },
  { pattern: /伯克希尔|巴菲特|Berkshire/i, ticker: "BRK-B", name: "伯克希尔 Berkshire" },
  { pattern: /Visa|维萨/i, ticker: "V", name: "Visa" },
  { pattern: /万事达|Mastercard/i, ticker: "MA", name: "万事达 Mastercard" },
  { pattern: /礼来|Eli\s?Lilly|\bLLY\b/i, ticker: "LLY", name: "礼来 Eli Lilly" },
  { pattern: /强生|Johnson\s?&?\s?Johnson|\bJNJ\b/i, ticker: "JNJ", name: "强生 J&J" },
  { pattern: /辉瑞|Pfizer|\bPFE\b/i, ticker: "PFE", name: "辉瑞 Pfizer" },
  { pattern: /\bBABA\b/i, ticker: "BABA", name: "阿里巴巴 ADR" }
];

// Dual listings (HK + US ADR). Same underlying company, but FMP's free tier only
// covers the US ADR (not HK), so fundamentals/valuation always use the US ADR
// leg (more complete data), while surfacing both tickers to the user.
const DUAL_LISTINGS: { nameZh: string; hk: string; us: string }[] = [
  { nameZh: "阿里巴巴", hk: "9988.HK", us: "BABA" },
  { nameZh: "京东", hk: "9618.HK", us: "JD" },
  { nameZh: "百度", hk: "9888.HK", us: "BIDU" },
  { nameZh: "网易", hk: "9999.HK", us: "NTES" },
  { nameZh: "携程", hk: "9961.HK", us: "TCOM" },
  { nameZh: "哔哩哔哩", hk: "9626.HK", us: "BILI" },
  { nameZh: "理想汽车", hk: "2015.HK", us: "LI" },
  { nameZh: "小鹏汽车", hk: "9868.HK", us: "XPEV" },
  { nameZh: "蔚来", hk: "9866.HK", us: "NIO" },
  { nameZh: "名创优品", hk: "9896.HK", us: "MNSO" },
  { nameZh: "新东方", hk: "9901.HK", us: "EDU" },
  { nameZh: "贝壳", hk: "2423.HK", us: "BEKE" }
];
const DUAL_BY_TICKER = new Map<string, (typeof DUAL_LISTINGS)[number]>();
for (const d of DUAL_LISTINGS) {
  DUAL_BY_TICKER.set(d.hk, d);
  DUAL_BY_TICKER.set(d.us, d);
}

export interface DualListingResult {
  ticker: string;
  nameZh: string;
  nameEn: string;
  industry: string;
  dualListing: { hk: string; us: string; asked: string; primary: "us" };
}

// Resolves "dual listing" queries to the US ADR leg (fuller fundamentals data),
// with both tickers attached so the frontend can tell the user which side was
// asked about vs which side drives the numbers. Returns null if not a dual listing.
export function resolveDualListing(query = ""): DualListingResult | null {
  const aliasTicker = extractAliasTicker(query); // 阿里巴巴 → 9988.HK
  const usHit = resolveUsTicker(query)?.ticker || ""; // BABA
  const hkTicker = extractTicker(query); // 9988.HK
  const candidate = [aliasTicker, usHit, hkTicker].find((t) => t && DUAL_BY_TICKER.has(t));
  const byName = candidate ? null : DUAL_LISTINGS.find((d) => query.includes(d.nameZh));
  const hit = candidate ? DUAL_BY_TICKER.get(candidate) : byName;
  if (!hit) return null;
  const asked = candidate || hit.us; // which side the user actually asked about
  return {
    ticker: hit.us,
    nameZh: hit.nameZh,
    nameEn: "",
    industry: "中概 · 双重上市",
    dualListing: { hk: hit.hk, us: hit.us, asked, primary: "us" }
  };
}

const US_STOPWORDS = new Set([
  "PE", "PB", "PS", "ROE", "ROI", "ROA", "ROC", "AI", "IPO", "GDP", "CEO",
  "CFO", "COO", "CTO", "CMO", "US", "HK", "EPS", "FCF", "DCF", "ETF",
  "Q1", "Q2", "Q3", "Q4", "YOY", "QOQ", "MOM", "TTM", "LTM", "MRQ",
  "CPI", "PPI", "PMI", "GNP", "EV", "NAV", "AUM", "BPS", "DPS", "NIM",
  "NYSE", "SEC", "SFC", "MSCI", "FTSE", "SPX", "SPY", "ESG", "SPAC"
]);

export function resolveUsTicker(text = ""): { ticker: string; name: string } | null {
  const hit = usAliases.find((item) => item.pattern.test(text));
  if (hit) return { ticker: hit.ticker, name: hit.name };
  const ticker = extractUsTickerToken(text, US_STOPWORDS);
  return ticker ? { ticker, name: ticker } : null;
}

export function extractTicker(text = ""): string {
  return extractHkTicker(text);
}

export function extractAliasTicker(text = ""): string {
  const hit = companyAliases.find((item) => item.pattern.test(text));
  return hit?.ticker || "";
}

// Strips follow-up words, leaving a "likely company name" residual. Used for HK
// search candidates, FMP fallback queries, and deciding whether a sentence names
// a company at all.
export function companyNameResidual(query = ""): string {
  return String(query)
    .replace(/[？?！!，,。.；;：:、""''《》()（）]/g, " ")
    .replace(/我想了解|我想问问|我想问|我想知道|我想看看|我想|想了解|想知道|想问问|想问|帮我看看|帮我查查|帮我查|帮我分析|帮我|麻烦你|麻烦|请问|请帮我|给我讲|给我说|能否|可以/g, " ")
    .replace(/最近|怎么样|怎样|怎么|如何|分析|看看|一下|讲讲|说说|介绍|了解|这家公司|这家|公司|这只|股票|经营质量|经营|盈利能力|盈利|现金流|现金|资产负债|负债|偿债|竞争对手|竞争|对手|格局|前景|趋势|空间|催化|管理层|管理|治理|股东回报|股东|回报|分红|回购|成长|增长|增速|业绩|运营|营运|商业模式|模式|逻辑|信号|指标|怎么看|值不值|贵不贵|便宜|护城河|赚钱|不赚钱|主要风险|风险|利润|毛利|营收|估值|赔率|基本面|值得|研究|持续|能不能|是什么|有没有|多少|呢|吗|的|了/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Chinese company-name suffixes — a hit means the residual is likely a company
// name, not a follow-up like "毛利率/护城河".
const CN_COMPANY_SUFFIX =
  /(科技|集团|股份|控股|银行|保险|证券|基金|汽车|医药|生物|制药|能源|半导体|电子|国际|地产|食品|饮料|光电|通信|网络|软件|数据|智能|重工|机械|电力|航空|航运|传媒|文化|教育|物流|材料|化工|钢铁|水泥|实业|电器|家居|服饰|乳业|酒业|影业)/;

const LEAD_IN_PREFIX = /^(我想了解|我想问问|我想问|我想知道|我想看看|我想|想了解|想知道|想问问|想问|帮我看看|帮我查查|帮我查|帮我分析|帮我|麻烦你|麻烦|请问|请帮我|了解一下|看下|看看)\s*/;
const FOLLOWUP_HEAD =
  /^(它|他|她|这|那|其|该|怎|为什么|现在|目前|当前|未来|今年|去年|最近|短期|长期|股价|估值|市值|毛利|利润|净利|营收|收入|经营|盈利|现金|负债|偿债|竞争|格局|管理|治理|股东|回报|成长|增速|业绩|运营|营运|质量|护城河|风险|基本面|赚钱|分红|回购|增长|前景|趋势|空间|逻辑|催化|对比|相比|和|跟|与|vs)/i;

// Whether this sentence "names a (possibly new) company". Used to decide whether
// to trigger resolution, and whether a failed resolution should tell the user
// explicitly "couldn't identify" rather than silently continuing on the previous
// company.
export function mentionsNewCompany(query = ""): boolean {
  if (extractTicker(query) || extractAliasTicker(query) || resolveUsTicker(query) || resolveDualListing(query)) return true;
  const residual = companyNameResidual(query);
  if (residual.length < 2) return false;
  if (CN_COMPANY_SUFFIX.test(residual)) return true;
  if (/[A-Z][a-z]{2,}/.test(residual)) return true;
  const lead = query.trim().replace(LEAD_IN_PREFIX, "").trim();
  if (/^[一-龥]{2,}/.test(lead) && !FOLLOWUP_HEAD.test(lead)) return true;
  return false;
}

// "Strong signal" variant: explicitly names *another* company (ticker / alias /
// dual listing / unlisted private company / suffixed company name / English proper
// noun). When a company is already under research, only a strong signal switches
// the subject — a bare follow-up like "经营质量怎么样" has no strong signal, so it
// stays on the current company.
export function mentionsNewCompanyStrong(query = ""): boolean {
  if (extractTicker(query) || extractAliasTicker(query) || resolveUsTicker(query) || resolveDualListing(query)) return true;
  const residual = companyNameResidual(query);
  if (residual.length < 2) return false;
  if (CN_COMPANY_SUFFIX.test(residual)) return true;
  if (/[A-Z][a-z]{2,}/.test(residual)) return true;
  return false;
}

export function companySearchCandidates(query = ""): string[] {
  const ticker = extractTicker(query);
  const aliasTicker = extractAliasTicker(query);
  const cleaned = companyNameResidual(query);
  return [...new Set([ticker, aliasTicker, cleaned, query].filter(Boolean))];
}

export type ResolveCompanyResult =
  | (ResolvedCompany & { dualListing?: DualListingResult["dualListing"] })
  | { unverifiedTicker: string; suggestions: { ticker: string; name: string }[] }
  | { unresolved: true; name: string }
  | null;

export async function resolveCompany(query: string, opts: { verify?: boolean } = {}): Promise<ResolveCompanyResult> {
  const dual = resolveDualListing(query);
  if (dual) return dual;
  const us = resolveUsTicker(query);
  const candidates = companySearchCandidates(query);
  let company: any = null;
  for (const search of candidates) {
    const data = await companiesApi.search(search);
    company = data.companies?.[0] || null;
    if (company) break;
  }
  // US tickers aren't in the HK searchable DB — build a minimal company so the
  // research pipeline (live quote + FMP fundamentals) can run.
  if (!company && us) {
    // Alias-table hit (carries a real name, us.name !== us.ticker) → trust it, no
    // verify delay. A bare/explicit-notation ticker (us.name === us.ticker, a pure
    // guess) goes through the verify gate first to catch typos like "DRUM".
    const needsVerify = opts.verify && us.name === us.ticker;
    if (!needsVerify) return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
    try {
      const v = await companiesApi.verify(us.ticker);
      if (v.status === "verified") return { ticker: us.ticker, nameZh: v.name || us.ticker, nameEn: v.name || "", industry: "美股" };
      if (v.status === "not_found") return { unverifiedTicker: us.ticker, suggestions: v.suggestions || [] };
      // status === "error" (FMP rate-limited/network) → let it through rather than
      // wrongly blocking a freshly-IPO'd new listing.
    } catch {
      /* verify unavailable → let it through */
    }
    return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
  }
  const fallbackTicker = candidates.find((candidate) => /^\d{4,5}\.HK$/.test(candidate));
  if (!company && fallbackTicker) return { ticker: fallbackTicker, nameZh: fallbackTicker, industry: "待补充" };
  // No alias/HK-DB hit → fall back to smart resolution: English/pinyin → FMP,
  // Chinese name → LLM (e.g. 泛林集团 → LRCX, 商汤 → 0020.HK), ticker re-verified via
  // FMP to prevent mismatches.
  if (!company) {
    const residual = companyNameResidual(query) || query.trim();
    if (residual.length >= 2) {
      try {
        const data = await companiesApi.resolve(residual);
        if (data.company?.ticker) return data.company;
      } catch {
        /* fallback failed → fall through to "unresolved" */
      }
    }
  }
  // A company was named but nothing resolved → return an explicit "unresolved"
  // signal rather than silently continuing on the previous company.
  if (!company) {
    return mentionsNewCompany(query) ? { unresolved: true, name: companyNameResidual(query) || query.trim() } : null;
  }
  return {
    ticker: company.ticker,
    nameZh: company.nameZh || company.name_zh || company.name || company.ticker,
    nameEn: company.nameEn || company.name_en || "",
    industry: company.industry || ""
  };
}

// Strips the "current company"'s name/ticker out of a question, leaving the
// residual to resolve as the comparison target.
export function stripCompanyMentions(query = "", company: { nameZh?: string; nameEn?: string; ticker?: string } | null = null): string {
  if (!company) return query;
  let out = String(query);
  for (const token of [company.nameZh, company.nameEn, company.ticker].filter(Boolean) as string[]) {
    out = out.split(token).join(" ");
  }
  return out;
}

// Comparison intent: "跟X比/对比/vs/谁更…/哪个更…". Combined with "names another
// company" to avoid mistaking a longitudinal follow-up ("它和去年比怎么样") for one.
export function isComparisonQuestion(query = ""): boolean {
  return /对比|相比|[和跟与][^，。？?]{1,14}(比|对比|相比|谁|哪个|哪家)|\bvs\b|谁(更|的)|哪(个|家)(更|的)?[^，。？?]{0,8}(好|强|贵|便宜|划算|赔率|值得)/i.test(
    String(query)
  );
}

// ── P6 discovery-layer intent (mirrors the server's intentClassifier) ──
const SCREEN_VERB = /帮我筛|筛选|筛一下|筛一筛|筛出|选股|挑(几只|一些|几个|出)|找(几只|一些|几个)|有(哪些|什么).{0,12}(股票|公司|标的)(值得|可以|推荐)?/;
const SCREEN_COND = /(PE|PB|市盈率|市净率|市值|股息率?|分红率?|价格|营收增速|增速)\s*(小于|大于|低于|高于|超过|不到|少于|多于|以上|以下|<|>|≤|≥|＜|＞)/i;
const MACRO_SIGNAL =
  /大盘|宏观|美联储|议息|加息|降息|非农|CPI|PPI|通胀|国债收益率|流动性|美股(今晚|今天|今年|本周|下周|最近|接下来|怎么|如何|行情|市场)|港股(今晚|今天|本周|大盘|行情|市场|最近|怎么)|恒生指数|恒指|纳斯达克|纳指|标普|道琼斯|道指|指数(怎么|如何|走势)|今晚.{0,10}(关键事件|有什么事件|数据|财报|事件)|市场情绪|风险偏好|宏观经济/;

export function isScreenerQuestion(question = ""): boolean {
  const text = String(question || "");
  return SCREEN_VERB.test(text) || SCREEN_COND.test(text);
}

export function isMacroQuestion(question = ""): boolean {
  return MACRO_SIGNAL.test(String(question || ""));
}

// Screener condition sentences contain bare digits ("PE小于40") that extractTicker
// would misread as an HK ticker (0040.HK), so screener detection only trusts
// "explicit" company signals (alias / US ticker / .HK suffix).
export function discoveryKindOf(question = ""): "screener" | "macro" | null {
  if (isScreenerQuestion(question)) {
    const explicitCompany = extractAliasTicker(question) || resolveUsTicker(question) || /\d{3,5}\.HK/i.test(question);
    return explicitCompany ? null : "screener";
  }
  if (mentionsNewCompanyStrong(question)) return null;
  if (isMacroQuestion(question)) return "macro";
  return null;
}

// Multi-position/multi-ticker question: "list (and/、…) + holding signal" or
// "≥2 occurrences of '股'". Mirrors the server's entityExtractor.looksMultiHolding
// so it's treated as a follow-up on the current company (server fills in the rest)
// rather than misread as a switch/comparison.
export function isMultiHoldingQuestion(query = ""): boolean {
  const text = String(query || "");
  if (text.length < 4) return false;
  const multiShare = (text.match(/股/g) || []).length >= 2;
  const hasList = /[、,，&]|和|与|跟|以及|还有|及/.test(text);
  const holdingHint = /持有|持仓|组合|仓位|分别|各|股票|加上|拿着|拿了|都拿|买了|买入|入手|加仓|建仓|都有|手里|手上/.test(text);
  return multiShare || (hasList && holdingHint);
}
