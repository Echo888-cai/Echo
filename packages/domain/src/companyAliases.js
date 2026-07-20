/**
 * 公司别名、港美双重上市与 ADR 映射的**唯一一份**底账。
 *
 * 此前同一批事实散落三处并且已经漂移：前端 resolve.ts 两张别名表 + 一张 12 对的
 * DUAL_LISTINGS，data-plane hkAdr.ts 又一张 9 对的 HK_TO_ADR（BABA/9988、JD/9618
 * 两处重复登记）。手工表多一份副本就多一处"改了这边忘了那边"——停用词表当年就是
 * 这么在前后端漂移出 SPY/QQQ 误判的（见 companyIdentity.js 注释）。
 *
 * 准入纪律沿用 hkAdr.ts：**每条 ADR 映射都必须经真实数据源调用人工核实**后才能进表
 * （最近一次核实 2026-07-14，Finnhub `/calendar/earnings?symbol=<adr>` 返回的
 * `earningsCalendar[].symbol` 与 HK 代码对得上）。错配的代价（自信地给出错日期/
 * 错同业）比"未核到"更糟，宁缺毋滥。
 */

/**
 * 港股公司中文/英文别名 → 港股代码。命中即视为用户点名了这家公司。
 * 顺序有意义：更具体的名字（阿里健康）排在泛称（阿里）之前由负向断言处理。
 */
export const HK_COMPANY_ALIASES = [
  { pattern: /腾讯控股|腾讯|Tencent/i, ticker: "0700.HK" },
  { pattern: /阿里巴巴|阿里(?!健康|影业)|Alibaba/i, ticker: "9988.HK" },
  { pattern: /阿里健康/i, ticker: "0241.HK" },
  { pattern: /阿里影业/i, ticker: "1060.HK" },
  { pattern: /美团|Meituan/i, ticker: "3690.HK" },
  { pattern: /小米|Xiaomi/i, ticker: "1810.HK" },
  { pattern: /比亚迪|BYD(?![A-Z])/i, ticker: "1211.HK" },
  { pattern: /京东(?!方)|JD\.com|jingdong/i, ticker: "9618.HK" },
  { pattern: /百度|Baidu/i, ticker: "9888.HK" },
  { pattern: /快手|Kuaishou/i, ticker: "1024.HK" },
  { pattern: /网易|NetEase/i, ticker: "9999.HK" },
  { pattern: /联想|Lenovo/i, ticker: "0992.HK" },
  { pattern: /耐世特|Nexteer/i, ticker: "1316.HK" },
  { pattern: /地平线机器人|地平线|Horizon Robotics/i, ticker: "9660.HK" },
  { pattern: /港交所|香港交易所|HKEX(?![A-Za-z])/i, ticker: "0388.HK" }
];

/**
 * 美股公司别名（中文名 + 英文名 + 代码）→ 美股代码。
 * 中文名只能靠这张表命中（供应商的模糊搜索不认中文）；不在表里的英文名/拼音
 * 走服务端解析（FMP 搜索 + LLM 兜底，application/companyResolution）。
 */
export const US_COMPANY_ALIASES = [
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

/**
 * 港↔美关联的唯一底账。两种性质，用 `kind` 区分，**不可混用**：
 *
 * - `dual_primary`：两边都是真实主/二次上市，用户可能实际持有任一边。识别到这类
 *   公司且用户没指明市场时，产品必须**先问用户按哪边分析**（口径、币种、盈亏都不同）。
 *   `us` 即可交易的美股代码，同时充当数据源替身（adr === us）。
 * - `adr_otc`：美股侧只是 OTC ADR（TCEHY 之类），是 Finnhub 免费档查日历/同业的
 *   **数据源替身**，不是用户的研究口径选项——绝不为它弹"港股还是美股"的问询。
 *
 * ADR 兑换比例（腾讯 1:1、阿里 1:8）每家不同且必须逐条向存托银行/官方披露核实
 * （PLAN §7：从价格反推是推断不是核实，禁止），核实前一律不做跨腿价格换算。
 */
export const HK_US_LINKS = [
  // pattern：中英文名的点名匹配（dualListingByName 用）；显式代码命中不走它。
  { nameZh: "阿里巴巴", hk: "9988.HK", us: "BABA", adr: "BABA", kind: "dual_primary", pattern: /阿里巴巴|阿里(?!健康|影业)|Alibaba/i },
  { nameZh: "京东", hk: "9618.HK", us: "JD", adr: "JD", kind: "dual_primary", pattern: /京东(?!方)|JD\.com|jingdong/i },
  { nameZh: "百度", hk: "9888.HK", us: "BIDU", adr: "BIDU", kind: "dual_primary", pattern: /百度|Baidu/i },
  { nameZh: "网易", hk: "9999.HK", us: "NTES", adr: "NTES", kind: "dual_primary", pattern: /网易|NetEase/i },
  { nameZh: "携程", hk: "9961.HK", us: "TCOM", adr: "TCOM", kind: "dual_primary", pattern: /携程|Trip\.com|ctrip/i },
  { nameZh: "哔哩哔哩", hk: "9626.HK", us: "BILI", adr: "BILI", kind: "dual_primary", pattern: /哔哩哔哩|bilibili/i },
  { nameZh: "理想汽车", hk: "2015.HK", us: "LI", adr: "LI", kind: "dual_primary", pattern: /理想汽车|Li\s?Auto/i },
  { nameZh: "小鹏汽车", hk: "9868.HK", us: "XPEV", adr: "XPEV", kind: "dual_primary", pattern: /小鹏|XPeng/i },
  { nameZh: "蔚来", hk: "9866.HK", us: "NIO", adr: "NIO", kind: "dual_primary", pattern: /蔚来|\bNIO\b/i },
  { nameZh: "名创优品", hk: "9896.HK", us: "MNSO", adr: "MNSO", kind: "dual_primary", pattern: /名创优品|Miniso/i },
  { nameZh: "新东方", hk: "9901.HK", us: "EDU", adr: "EDU", kind: "dual_primary", pattern: /新东方|New\s?Oriental/i },
  { nameZh: "贝壳", hk: "2423.HK", us: "BEKE", adr: "BEKE", kind: "dual_primary", pattern: /贝壳|Beike|KE\s?Holdings/i },
  // 以下美股侧为 OTC ADR：仅作数据源替身（经 2026-07-14 Finnhub 真实调用核实）。
  { nameZh: "腾讯控股", hk: "0700.HK", us: null, adr: "TCEHY", kind: "adr_otc" },
  { nameZh: "美团", hk: "3690.HK", us: null, adr: "MPNGY", kind: "adr_otc" },
  { nameZh: "小米集团", hk: "1810.HK", us: null, adr: "XIACY", kind: "adr_otc" },
  { nameZh: "中国平安", hk: "2318.HK", us: null, adr: "PNGAY", kind: "adr_otc" },
  { nameZh: "比亚迪", hk: "1211.HK", us: null, adr: "BYDDY", kind: "adr_otc" },
  { nameZh: "汇丰控股", hk: "0005.HK", us: null, adr: "HSBC", kind: "adr_otc" },
  { nameZh: "中国移动", hk: "0941.HK", us: null, adr: "CHL", kind: "adr_otc" }
];

function hkCodeOf(ticker) {
  return String(ticker || "").trim().toUpperCase().replace(/\.HK$/, "").padStart(4, "0");
}

/** 仅"真双重上市"（需要问用户市场口径的那类）。返回拷贝，防调用方改内部状态。 */
export function dualListings() {
  return HK_US_LINKS.filter((link) => link.kind === "dual_primary").map((link) => ({ ...link }));
}

const LINK_BY_TICKER = new Map();
for (const link of HK_US_LINKS) {
  LINK_BY_TICKER.set(link.hk, link);
  if (link.us) LINK_BY_TICKER.set(link.us, link);
}

/** 任一腿代码 → 双重上市条目（仅 dual_primary；ADR 替身不构成"双重上市"）。 */
export function dualListingByTicker(ticker) {
  const link = LINK_BY_TICKER.get(String(ticker || "").trim().toUpperCase());
  return link && link.kind === "dual_primary" ? { ...link } : null;
}

/** 问句里点名的双重上市公司（中英文名模式匹配；代码命中请用 dualListingByTicker）。 */
export function dualListingByName(text = "") {
  const value = String(text || "");
  const hit = HK_US_LINKS.find(
    (link) => link.kind === "dual_primary" && (link.pattern ? link.pattern.test(value) : value.includes(link.nameZh))
  );
  return hit ? { ...hit } : null;
}

/** 港股代码（裸码或 x.HK）→ Finnhub 可查询的美股符号；无核实条目即 null。 */
export function adrForHk(ticker) {
  const code = hkCodeOf(ticker);
  const hit = HK_US_LINKS.find((link) => hkCodeOf(link.hk) === code);
  return hit?.adr || null;
}
