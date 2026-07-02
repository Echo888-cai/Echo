// ── 公司识别与解析：别名表 / 双重上市 / 美股代码 / 意图判定 ──
import { api } from "./api.js";

const companyAliases = [
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

// 美股别名（名称 + 代码）。中文名只能靠这张表（FMP 搜索不认中文）；英文名/拼音/代码
// 没命中这张表时，resolveCompany 会再走 /api/companies/resolve（FMP + LLM）兜底。
// 其它美股也可用 $代码 或 代码.US，例如 $PLTR、PLTR.US。
const usAliases = [
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
  // 半导体 / 硬件
  { pattern: /美光|镁光|Micron|\bMU\b/i, ticker: "MU", name: "美光科技 Micron" },
  { pattern: /博通|Broadcom|\bAVGO\b/i, ticker: "AVGO", name: "博通 Broadcom" },
  { pattern: /高通|Qualcomm|\bQCOM\b/i, ticker: "QCOM", name: "高通 Qualcomm" },
  { pattern: /阿斯麦|阿斯麦尔|\bASML\b/i, ticker: "ASML", name: "阿斯麦 ASML" },
  { pattern: /应用材料|Applied Materials|\bAMAT\b/i, ticker: "AMAT", name: "应用材料 Applied Materials" },
  { pattern: /美满|Marvell|\bMRVL\b/i, ticker: "MRVL", name: "美满电子 Marvell" },
  { pattern: /\bARM\b|安谋/i, ticker: "ARM", name: "ARM" },
  // 软件 / 互联网
  { pattern: /甲骨文|Oracle|\bORCL\b/i, ticker: "ORCL", name: "甲骨文 Oracle" },
  { pattern: /思科|Cisco|\bCSCO\b/i, ticker: "CSCO", name: "思科 Cisco" },
  { pattern: /Adobe|\bADBE\b/i, ticker: "ADBE", name: "Adobe" },
  { pattern: /Salesforce|赛富时|\bCRM\b/i, ticker: "CRM", name: "Salesforce" },
  { pattern: /Palantir|\bPLTR\b/i, ticker: "PLTR", name: "Palantir" },
  { pattern: /Snowflake|\bSNOW\b/i, ticker: "SNOW", name: "Snowflake" },
  { pattern: /Coinbase|\bCOIN\b/i, ticker: "COIN", name: "Coinbase" },
  { pattern: /优步|Uber|\bUBER\b/i, ticker: "UBER", name: "优步 Uber" },
  // 消费 / 工业 / 金融 / 医药
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

// 双重上市（港股 + 美股 ADR）。基本面是同一家公司，但 FMP 免费档只覆盖美股 ADR、
// 不覆盖港股，所以基本面/估值统一走美股 ADR 口径（数据更全），并向用户说清两地代码。
const DUAL_LISTINGS = [
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
const DUAL_BY_TICKER = new Map();
for (const d of DUAL_LISTINGS) { DUAL_BY_TICKER.set(d.hk, d); DUAL_BY_TICKER.set(d.us, d); }

// 把"双重上市"的查询统一解析到美股 ADR 口径（基本面数据更全），并附带两地代码，
// 让前端能告诉用户"你问的是哪一边、我用哪一边做基本面"。识别不到返回 null。
export function resolveDualListing(query = "") {
  const aliasTicker = extractAliasTicker(query);          // 阿里巴巴 → 9988.HK
  const usHit = resolveUsTicker(query)?.ticker || "";     // BABA
  const hkTicker = extractTicker(query);                  // 9988.HK
  const candidate = [aliasTicker, usHit, hkTicker].find((t) => t && DUAL_BY_TICKER.has(t));
  const byName = candidate ? null : DUAL_LISTINGS.find((d) => query.includes(d.nameZh));
  const hit = candidate ? DUAL_BY_TICKER.get(candidate) : byName;
  if (!hit) return null;
  const asked = candidate || hit.us; // 用户实际问的那一边（港股代码 / 美股代码 / 名称→默认美股）
  return {
    ticker: hit.us,                  // 基本面/估值统一走美股 ADR
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

export function resolveUsTicker(text = "") {
  const hit = usAliases.find((item) => item.pattern.test(text));
  if (hit) return { ticker: hit.ticker, name: hit.name };
  const t = String(text).toUpperCase().trim();
  // $TICKER or TICKER.US (explicit notation)
  const m = t.match(/\$([A-Z]{1,5})\b/) || t.match(/\b([A-Z]{1,5})\.US\b/);
  if (m && !US_STOPWORDS.has(m[1])) return { ticker: m[1], name: m[1] };
  // Bare uppercase: entire query is the ticker (e.g. "RKLB", "PLTR")
  if (/^[A-Z]{1,5}$/.test(t) && !US_STOPWORDS.has(t)) return { ticker: t, name: t };
  // Bare uppercase word embedded in mixed text (e.g. "分析 RKLB 的基本面")。
  // 但若它后面紧跟另一个拉丁词（"SPACE X"、"OPEN AI"），那是多词公司名的一部分、不是
  // 代码——不能把 "Space X" 抠成 SPACE（截图里"SPACE SPACE"张冠李戴的根因）。这类多词名
  // 交给下游权威解析（FMP 名称搜索 + LLM 校验）去查它真实的上市代码，而不是硬猜。
  const w = t.match(/(?:^|[\s,])([A-Z]{2,5})(?:[\s,.]|$)/);
  if (w && !US_STOPWORDS.has(w[1])) {
    const after = t.slice(w.index + w[0].length);
    if (!/^\s*[A-Za-z]/.test(after)) return { ticker: w[1], name: w[1] };
  }
  return null;
}

export function extractTicker(text = "") {
  const raw = String(text).toUpperCase();
  const hk = raw.match(/\b(\d{1,5})(?:\.HK|HK)?\b/);
  if (!hk) return "";
  return `${hk[1].padStart(4, "0")}.HK`;
}

export function extractAliasTicker(text = "") {
  const hit = companyAliases.find((item) => item.pattern.test(text));
  return hit?.ticker || "";
}

// 把追问词剥掉，留下"疑似公司名"残串。用于 HK 搜索候选、FMP 兜底查询、以及
// 判断"这句到底有没有点名一家公司"。
export function companyNameResidual(query = "") {
  return String(query)
    .replace(/[？?！!，,。.；;：:、""''《》()（）]/g, " ")
    // 开场白 / 客套（"我想了解"那种）先剥掉，避免残串变成"我想 泛林集团"。
    .replace(/我想了解|我想问问|我想问|我想知道|我想看看|我想|想了解|想知道|想问问|想问|帮我看看|帮我查查|帮我查|帮我分析|帮我|麻烦你|麻烦|请问|请帮我|给我讲|给我说|能否|可以/g, " ")
    .replace(/最近|怎么样|怎样|怎么|如何|分析|看看|一下|讲讲|说说|介绍|了解|这家公司|这家|公司|这只|股票|经营质量|经营|盈利能力|盈利|现金流|现金|资产负债|负债|偿债|竞争对手|竞争|对手|格局|前景|趋势|空间|催化|管理层|管理|治理|股东回报|股东|回报|分红|回购|成长|增长|增速|业绩|运营|营运|商业模式|模式|逻辑|信号|指标|怎么看|值不值|贵不贵|便宜|护城河|赚钱|不赚钱|主要风险|风险|利润|毛利|营收|估值|赔率|基本面|值得|研究|持续|能不能|是什么|有没有|多少|呢|吗|的|了/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 公司名后缀（中文）。命中说明残串多半是一家公司，而不是"毛利率/护城河"这类追问。
const CN_COMPANY_SUFFIX = /(科技|集团|股份|控股|银行|保险|证券|基金|汽车|医药|生物|制药|能源|半导体|电子|国际|地产|食品|饮料|光电|通信|网络|软件|数据|智能|重工|机械|电力|航空|航运|传媒|文化|教育|物流|材料|化工|钢铁|水泥|实业|电器|家居|服饰|乳业|酒业|影业)/;

// 开场白前缀（"我想了解…"），判断主语位时先剥掉。
const LEAD_IN_PREFIX = /^(我想了解|我想问问|我想问|我想知道|我想看看|我想|想了解|想知道|想问问|想问|帮我看看|帮我查查|帮我查|帮我分析|帮我|麻烦你|麻烦|请问|请帮我|了解一下|看下|看看)\s*/;
// 追问句常见开头（指代/时间/指标）。出现在主语位说明这是对当前公司的追问，不是点名新公司。
const FOLLOWUP_HEAD = /^(它|他|她|这|那|其|该|怎|为什么|现在|目前|当前|未来|今年|去年|最近|短期|长期|股价|估值|市值|毛利|利润|净利|营收|收入|经营|盈利|现金|负债|偿债|竞争|格局|管理|治理|股东|回报|成长|增速|业绩|运营|营运|质量|护城河|风险|基本面|赚钱|分红|回购|增长|前景|趋势|空间|逻辑|催化|对比|相比|和|跟|与|vs)/i;

// 这句是否在"点名一家（可能是新的）公司"。用于决定是否触发解析，以及解析失败时
// 是否要明确告诉用户"没识别出"，而不是默默沿用上一家公司作答（张冠李戴的根因）。
export function mentionsNewCompany(query = "") {
  if (extractTicker(query) || extractAliasTicker(query) || resolveUsTicker(query) || resolveDualListing(query)) return true;
  const residual = companyNameResidual(query);
  if (residual.length < 2) return false;
  if (CN_COMPANY_SUFFIX.test(residual)) return true;        // 美光科技 / 某某集团
  if (/[A-Z][a-z]{2,}/.test(residual)) return true;         // 英文专有名词：Micron / Coinbase（排除 ROE/EBITDA 这类全大写）
  // 无后缀的中文公司名（贵州茅台 / 比亚迪 / 顺丰）：只有出现在主语位（问句开头、不是
  // 指代/指标这类追问词）才算点名公司，避免把"估值贵不贵""现在怎么看"误判成新公司。
  const lead = query.trim().replace(LEAD_IN_PREFIX, "").trim();
  if (/^[一-龥]{2,}/.test(lead) && !FOLLOWUP_HEAD.test(lead)) return true;
  return false;
}

// "强信号"版：明确点名了**另一家**公司（代码 / 别名 / 双重上市 / 未上市私人公司 /
// 带后缀的公司名 / 英文专名）。已有在研公司时只认强信号才切换标的——"经营质量怎么样"
// 这类纯追问没有强信号，会留在当前公司，连续对话才不会被打断（这是张冠李戴的反面：
// 不是答错成别家，而是别把追问当成新公司）。
export function mentionsNewCompanyStrong(query = "") {
  if (extractTicker(query) || extractAliasTicker(query) || resolveUsTicker(query) || resolveDualListing(query)) return true;
  const residual = companyNameResidual(query);
  if (residual.length < 2) return false;
  if (CN_COMPANY_SUFFIX.test(residual)) return true;        // 美光科技 / 某某集团
  if (/[A-Z][a-z]{2,}/.test(residual)) return true;         // 英文专名 Micron / Coinbase
  return false;
}

export function companySearchCandidates(query = "") {
  const ticker = extractTicker(query);
  const aliasTicker = extractAliasTicker(query);
  const cleaned = companyNameResidual(query);
  return [...new Set([ticker, aliasTicker, cleaned, query].filter(Boolean))];
}

export async function resolveCompany(query, opts = {}) {
  // 双重上市优先：阿里巴巴 / 京东等统一走美股 ADR 口径，附带两地代码。
  const dual = resolveDualListing(query);
  if (dual) return dual;
  const us = resolveUsTicker(query);
  const candidates = companySearchCandidates(query);
  let company = null;
  for (const search of candidates) {
    const data = await api(`/api/companies/search?q=${encodeURIComponent(search)}`);
    company = data.companies?.[0] || null;
    if (company) break;
  }
  // US tickers aren't in the HK searchable DB — build a minimal company so the
  // research pipeline (live quote + FMP fundamentals) can run.
  if (!company && us) {
    // 别名表命中（带真名，us.name!==ticker）→ 信任短路，不加 verify 延迟。
    // 裸代码/显式记法（us.name===ticker，纯猜）才在研究前过 verify 闸门，挡住 DRUM 这种打错的码。
    const needsVerify = opts.verify && us.name === us.ticker;
    if (!needsVerify) return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
    try {
      const v = await api(`/api/companies/verify?ticker=${encodeURIComponent(us.ticker)}`);
      if (v.status === "verified") return { ticker: us.ticker, nameZh: v.name || us.ticker, nameEn: v.name || "", industry: "美股" };
      if (v.status === "not_found") return { unverifiedTicker: us.ticker, suggestions: v.suggestions || [] };
      // status === "error"（FMP 限流/网络）→ 信任用户放行，避免误杀刚 IPO 的新股（"新上市自愈"）。
    } catch { /* verify 不可用 → 放行 */ }
    return { ticker: us.ticker, nameZh: us.name, nameEn: us.name, industry: "美股" };
  }
  const fallbackTicker = candidates.find((candidate) => /^\d{4,5}\.HK$/.test(candidate));
  if (!company && fallbackTicker) return { ticker: fallbackTicker, nameZh: fallbackTicker, industry: "待补充" };
  // 没命中别名表/港股库时，走智能解析兜底：英文/拼音→FMP，中文名→LLM（如
  // 泛林集团→LRCX、商汤→0020.HK），代码再经 FMP 校验，防止张冠李戴。
  if (!company) {
    const residual = companyNameResidual(query) || query.trim();
    if (residual.length >= 2) {
      try {
        const data = await api(`/api/companies/resolve?q=${encodeURIComponent(residual)}`);
        if (data.company?.ticker) return data.company;
        // A 股（沪深）：目前只做港股+美股，给一个专门的提示而不是泛泛"没识别"。
        if (data.reason === "cn_unsupported") return { unsupported: true, market: "CN", name: data.name || residual };
      } catch { /* 兜底失败就走下面的"未识别"分支 */ }
    }
  }
  // 点名了一家公司却怎么都解析不出 → 返回明确的"未识别"信号，让上层提示用户用代码，
  // 绝不沿用上一家公司作答（这是"美光问成中国交通建设"那种张冠李戴的根因）。
  if (!company) {
    return mentionsNewCompany(query)
      ? { unresolved: true, name: companyNameResidual(query) || query.trim() }
      : null;
  }
  return {
    ticker: company.ticker,
    nameZh: company.nameZh || company.name_zh || company.name || company.ticker,
    nameEn: company.nameEn || company.name_en || "",
    sector: company.sector || "",
    industry: company.industry || "",
    hasPortrait: Boolean(company.hasPortrait)
  };
}

// 从问句里抠掉"当前公司"的名字/代码，剩下的拿去解析对比对象（另一家）。
export function stripCompanyMentions(query = "", company = null) {
  if (!company) return query;
  let out = String(query);
  for (const token of [company.nameZh, company.nameEn, company.ticker].filter(Boolean)) {
    out = out.split(token).join(" ");
  }
  return out;
}

// 对比意图：句子在做横向比较（"和X比/对比/vs/谁更…/哪个更…"）。配合"点名了另一家公司"
// 一起判断，避免把"它和去年比怎么样"这种纵向追问也当成公司对比。
export function isComparisonQuestion(query = "") {
  return /对比|相比|[和跟与][^，。？?]{1,14}(比|对比|相比|谁|哪个|哪家)|\bvs\b|谁(更|的)|哪(个|家)(更|的)?[^，。？?]{0,8}(好|强|贵|便宜|划算|赔率|值得)/i.test(String(query));
}

// ── P6 发现层意图（与后端 intentClassifier 保持镜像）────────
// 筛选/宏观问题不进公司研究管道：sendChat 在公司解析之前先判定，命中走 /api/discover。
const SCREEN_VERB = /帮我筛|筛选|筛一下|筛一筛|筛出|选股|挑(几只|一些|几个|出)|找(几只|一些|几个)|有(哪些|什么).{0,12}(股票|公司|标的)(值得|可以|推荐)?/;
const SCREEN_COND = /(PE|PB|市盈率|市净率|市值|股息率?|分红率?|价格|营收增速|增速)\s*(小于|大于|低于|高于|超过|不到|少于|多于|以上|以下|<|>|≤|≥|＜|＞)/i;
const MACRO_SIGNAL = /大盘|宏观|美联储|议息|加息|降息|非农|CPI|PPI|通胀|国债收益率|流动性|美股(今晚|今天|今年|本周|下周|最近|接下来|怎么|如何|行情|市场)|港股(今晚|今天|本周|大盘|行情|市场|最近|怎么)|恒生指数|恒指|纳斯达克|纳指|标普|道琼斯|道指|指数(怎么|如何|走势)|今晚.{0,10}(关键事件|有什么事件|数据|财报|事件)|市场情绪|风险偏好|宏观经济/;

export function isScreenerQuestion(question = "") {
  const text = String(question || "");
  return SCREEN_VERB.test(text) || SCREEN_COND.test(text);
}

export function isMacroQuestion(question = "") {
  return MACRO_SIGNAL.test(String(question || ""));
}

// 发现层判定：筛选/宏观，且没有点名具体公司（点名了公司永远优先公司研究管道——
// "腾讯 PE 低于 20 吗"是估值追问不是筛选；"美股今晚有什么关键事件"才是宏观）。
// 注意筛选句要先判：条件式问句里的裸数字（"PE小于40"）会被 extractTicker 误认成
// 港股代码 0040.HK，所以筛选场景只认"显式"公司信号（别名 / 美股代码 / 带 .HK 后缀）。
export function discoveryKindOf(question = "") {
  if (isScreenerQuestion(question)) {
    const explicitCompany = extractAliasTicker(question) || resolveUsTicker(question) || /\d{3,5}\.HK/i.test(question);
    return explicitCompany ? null : "screener";
  }
  if (mentionsNewCompanyStrong(question)) return null;
  if (isMacroQuestion(question)) return "macro";
  return null;
}

// 多持仓/多标的问句："列举（和/、…）+ 持仓信号"或"≥2 个'股'"。与后端 entityExtractor.looksMultiHolding
// 保持一致：检测到就让它作为当前公司的追问直发，后端补齐其他标的，避免被误判成切换/对比而跳走。
export function isMultiHoldingQuestion(query = "") {
  const text = String(query || "");
  if (text.length < 4) return false;
  const multiShare = (text.match(/股/g) || []).length >= 2;
  const hasList = /[、,，&]|和|与|跟|以及|还有|及/.test(text);
  const holdingHint = /持有|持仓|组合|仓位|分别|各|股票|加上|拿着|拿了|都拿|买了|买入|入手|加仓|建仓|都有|手里|手上/.test(text);
  return multiShare || (hasList && holdingHint);
}
