/**
 * 对话内多标的抽取（P0：从"单公司绑定"迈向"一段对话能装多只股"）。
 *
 * 给一句自然语言（如"我持有 22 股思科和 7 股 spacex 成本分别是 118.3 和 151 能挣钱吗"），
 * 抽出其中**除当前会话公司之外**的其他标的及（如有）持仓信息，并把每个标的解析成已校验的
 * 上市公司。返回 [{ company, shares, cost }]，供 chat 取实时数据 + 注入作答上下文 + 多笔记账。
 *
 * 设计取舍：
 * - 门控 looksMultiHolding：只有出现"列举 + 持仓信号"才动用一次 LLM 抽取，普通单公司追问零成本。
 * - 抽取只负责"把句子拆成实体 + 映射 shares/cost"，**不信任 LLM 的代码猜测**（它训练知识可能
 *   把刚 IPO 的 SpaceX 当未上市）；代码一律走 resolveCompanyFromQuery（alias 优先）确权。
 * - 任何失败/超时都降级成 []，绝不阻断主作答。
 */
import { callModel, getProviderStatus } from "./modelGateway.js";
import { resolveCompanyFromQuery } from "./companyResolver.js";

// 列举标记（和/与/跟/、/，/, /以及/还有/及/&）。
const LIST_MARK = /[、,，&]|和|与|跟|以及|还有|及/;
// 持仓/多标的信号（含口语化的"拿着/买了/手里"等所有权动词，避免漏判真持仓问句）。
const HOLDING_HINT = /持有|持仓|组合|仓位|分别|各|股票|加上|拿着|拿了|都拿|买了|买入|入手|加仓|建仓|都有|手里|手上/;

/** 门控：只有"列举 + 持仓信号"或"出现 ≥2 个'股'"才值得动用一次 LLM 抽取。 */
export function looksMultiHolding(question = "") {
  const text = String(question || "");
  if (text.length < 4) return false;
  const multiShare = (text.match(/股/g) || []).length >= 2; // "22股…7股…" 本身就是多笔持仓强信号
  return multiShare || (LIST_MARK.test(text) && HOLDING_HINT.test(text));
}

const EXTRACT_SYSTEM =
  "你从用户一句话里抽取其中提到的所有股票/公司及（如有）持仓信息。" +
  "只输出 JSON 数组，不要解释、不要 markdown。格式：" +
  '[{"name":"公司名或代码（保留原文，如 思科 / spacex / AAPL）","shares":数字或null,"cost":数字或null}]。' +
  "规则：" +
  "1) 按出现顺序列出**每一个**被当作投资标的提到的公司/股票。" +
  '2) "分别是 A 和 B"按顺序对应到前面列出标的的 cost/shares。' +
  "3) 只抽公司/股票，不要抽指数、板块、宏观名词（非农、美联储、CPI、AI 板块等）。" +
  "4) 没有任何公司、或不是投资语境 → 返回 []。" +
  '示例："我持有22股思科和7股spacex 成本分别是118.3和151能挣钱吗" → ' +
  '[{"name":"思科","shares":22,"cost":118.3},{"name":"spacex","shares":7,"cost":151}]。';

function parseJsonArray(text = "") {
  const fenced = String(text).replace(/```json|```/gi, " ");
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** LLM 把句子拆成 [{name, shares, cost}]。未配置/失败/未命中门控 → []。 */
export async function extractHoldings(question = "") {
  if (!looksMultiHolding(question) || !getProviderStatus().configured) return [];
  let res;
  try {
    res = await callModel({ system: EXTRACT_SYSTEM, user: String(question) });
  } catch {
    return [];
  }
  return parseJsonArray(res?.content || "")
    .map((h) => ({ name: String(h?.name || "").trim(), shares: num(h?.shares), cost: num(h?.cost) }))
    .filter((h) => h.name.length >= 2)
    .slice(0, 6);
}

// 抽取项是否就是当前会话公司（别浪费一次解析去重新解析已经在研的这家）。
function isSessionCompany(name, sessionCompany) {
  if (!sessionCompany) return false;
  const n = String(name).toLowerCase();
  return [sessionCompany.ticker, sessionCompany.nameZh, sessionCompany.nameEn]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .some((c) => c && (c === n || c.includes(n) || n.includes(c)));
}

/**
 * 抽取 + 解析 + 去重，返回当前会话公司**之外**的其他标的：[{ company, shares, cost }]。
 * 串行解析以复用 resolveCompanyFromQuery 内部缓存；N 很小（≤6），不构成压力。
 */
export async function extractOtherHoldings(question = "", sessionCompany = null) {
  const holdings = await extractHoldings(question);
  if (!holdings.length) return [];
  const out = [];
  const seen = new Set(sessionCompany?.ticker ? [String(sessionCompany.ticker).toUpperCase()] : []);
  for (const h of holdings) {
    if (isSessionCompany(h.name, sessionCompany)) continue;
    let resolved;
    try {
      resolved = await resolveCompanyFromQuery(h.name);
    } catch {
      continue;
    }
    const company = resolved?.company;
    if (!company?.ticker) continue;
    const key = String(company.ticker).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ company, shares: h.shares, cost: h.cost });
  }
  return out;
}
