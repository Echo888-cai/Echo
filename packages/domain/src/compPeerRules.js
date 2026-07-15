/**
 * compPeerRules — 同业可比的纯领域规则：按估值阶段分桶 + 锚点分位数。
 *
 * 为什么分桶：把亏损股的 EV/Sales 和盈利股的 PE 平均在一起是没有意义的数字。倍数口径
 * 按阶段决定（profitable → PE；loss / loss_growth → EV/Sales），桶不同的 peer 仍然列
 * 出来（前端"为什么选这些"面板要能解释），但不计入锚点。
 *
 * 阶段判断复用 valuation.js 已验证的 classifyAssetStage，不重新发明一套：它对"经营利润
 * 率一次性告负但净利明确为正"这类真实噪音已经踩过坑（见该函数注释）。peer 的阶段同样
 * 用它判断，而不是看供应商给没给 PE——真实探测到 IONQ 这类公司利润全靠一次性收益，
 * Finnhub 仍然吐出 peTTM=44.8，直接信 PE 会把亏损公司塞进 PE 桶。
 *
 * 同阶段可比 < 2 家时不生成锚点：不为了"有同业"而硬凑（valuation.js 的 PE/EV-Sales 锚点
 * 路径都以 anchor.n >= 2 为前提）。
 */
import { classifyAssetStage } from "./valuation.js";

const STAGE_LABEL = { profitable: "盈利", loss: "亏损", loss_growth: "亏损高成长", unknown: "未知阶段" };

/**
 * 倍数可比上限：超过就不是"估值观点"，而是分母趋近于零的产物，不能拿来当锚点。
 *
 * 真实回测抓到：查腾讯（经 TCEHY）的同业里有 BIDU，Finnhub 给的 peTTM=698.7x——百度 TTM
 * 盈利几乎归零，PE 就会爆掉；classifyAssetStage 看 eps>0 仍判"盈利"，于是它和 BILI(34.9x)
 * 一起进锚点，median 算出 366.8x。那会让 valuation.js 的同业 PE 锚点给腾讯算出 366 倍 PE
 * 的估值带，并在提示词里把"同业锚点中位 366.8x"当事实喂给模型——一个荒谬到用户一眼能看穿
 * 的数字，正是红线2 要挡的东西。
 *
 * 越界的 peer 仍然列出并说明原因（前端"为什么选这些"面板要能解释为什么它没被计入），
 * 只是不进锚点。宁可"同业不足、沿用原方法"，也不要一个错的锚。
 */
const MULTIPLE_BOUNDS = { PE: 100, "EV/Sales": 50 };

/** 阶段 → 倍数桶：只有同桶的 peer 才能拿来互相对照。 */
export function bucketOf(stage) {
  if (stage === "profitable") return "pe";
  if (stage === "loss" || stage === "loss_growth") return "ev_sales";
  return "unknown";
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** PeerQuote（供应商原始倍数）→ 领域视角的 peer：阶段、可用倍数、是否与主体同桶。 */
function annotatePeer(peer, subjectBucket) {
  const stage = classifyAssetStage({
    providerStatus: "ok",
    eps: peer.epsTtm,
    netMargin: peer.netMargin,
    revenueGrowth: peer.revenueGrowth
  });
  const bucket = bucketOf(stage);
  let multiple = null;
  let multipleType = null;
  if (bucket === "pe" && peer.pe != null && peer.pe > 0) { multiple = peer.pe; multipleType = "PE"; }
  else if (bucket === "ev_sales" && peer.evRevenue != null && peer.evRevenue > 0) { multiple = peer.evRevenue; multipleType = "EV/Sales"; }
  if (multiple == null) {
    return { ticker: peer.ticker, stage, multiple: null, multipleType: null, matched: false,
      reason: bucket === "unknown" ? "阶段未知（财务数据不足）" : "缺算倍数所需字段" };
  }
  const bound = MULTIPLE_BOUNDS[multipleType];
  if (bound && multiple > bound) {
    return { ticker: peer.ticker, stage, multiple, multipleType, matched: false,
      reason: `${multipleType} ${multiple.toFixed(1)}x 超出可比上限 ${bound}x（盈利/收入接近于零，倍数失真），不计入锚点` };
  }
  const matched = bucket === subjectBucket;
  return { ticker: peer.ticker, stage, multiple, multipleType, matched,
    reason: matched ? null : `阶段不同（${STAGE_LABEL[stage] || stage}），未计入锚点` };
}

/**
 * @param {object} subjectFinancials 主体的 financialsData（判断主体阶段）
 * @param {Array} peerQuotes         供应商返回的 PeerQuote 列表
 * @returns {{stage, peers, anchor, providerStatus, detail}}
 */
export function buildCompPeers(subjectFinancials, peerQuotes = []) {
  const stage = classifyAssetStage(subjectFinancials);
  const subjectBucket = bucketOf(stage);
  if (subjectBucket === "unknown") {
    return { stage, peers: [], anchor: null, providerStatus: "missing",
      detail: "本标的财务数据不足，无法判断估值阶段，暂不建同业锚点" };
  }
  const peers = (peerQuotes || []).map((p) => annotatePeer(p, subjectBucket));
  const matched = peers.filter((p) => p.matched);
  const multiples = matched.map((p) => p.multiple).sort((a, b) => a - b);
  let anchor = null;
  if (multiples.length >= 2) {
    anchor = {
      multipleType: subjectBucket === "pe" ? "PE" : "EV/Sales",
      p25: percentile(multiples, 0.25),
      median: percentile(multiples, 0.5),
      p75: percentile(multiples, 0.75),
      n: multiples.length,
      tickers: matched.map((p) => p.ticker)
    };
  }
  const detail = anchor
    ? `${anchor.n} 家同业计入锚点（${anchor.tickers.join("、")}）`
    : "同业数据不足（同阶段可比 <2 家），未生成同业锚点，沿用原估值方法";
  return { stage, peers, anchor, providerStatus: peers.length ? "ok" : "missing", detail };
}
