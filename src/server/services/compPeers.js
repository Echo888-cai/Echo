/**
 * compPeers — G-3 自动可比公司发现 + 同业倍数锚点。
 *
 * 同业发现：Finnhub `/stock/peers?symbol=` 对美股 symbol 免费档可直查（已实测 AAPL 返回
 * 同 GICS 细分行业公司）；港股直查会被拒（402/403），复用 G-2 验证过的 ADR 技巧——查
 * 港股对应的美股 ADR（见 market.js 的 HK_ADR_MAP），Finnhub 会把同一家公司的港股主体也
 * 混在同业清单里返回（如查 TCEHY 会带出 700.HK 自身，需要排除）。没有 ADR 映射的港股，
 * 诚实返回"无法识别同业"，不猜、不用模型判断。
 *
 * 倍数口径按阶段分桶（复用 valuationEngine 已验证的 classifyAssetStage，不重新发明判断
 * 逻辑）：profitable → PE；loss / loss_growth → EV/Sales。桶不同的 peer 仍然列出，但不计入
 * 锚点（避免用亏损股的 EV/Sales 和盈利股的 PE 硬凑在一起平均）。
 *
 * 同阶段可比 < 2 家时不生成锚点，保留原有估值方法——不为了"有同业"而硬凑。
 *
 * 缓存：comp_peers 表，24h TTL 读穿透 + stale-if-error 兜底，与 earningsCalendar.js 同款；
 * 每个 peer 的行情/财务拉取各自加超时（不用 Promise.allSettled 是因为 withTimeout 本身
 * 保证 resolve、不 reject，一个慢 peer 不会拖垮整批，也不会让调用方需要处理 rejection）。
 */
import { getMarketSnapshot } from "../../marketData.js";
import { getFinancials } from "../../financialData.js";
import { adrOrBareSymbol, isUS, bareSymbol, hkCode, detectMarket } from "../../market.js";
import { classifyAssetStage } from "@echo/domain";
import { withTimeout } from "../utils/async.js";
import { fetchJson as requestJson } from "../utils/http.js";
import { getCompPeersRow, upsertCompPeers } from "../repositories/compPeersRepository.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PEERS = 5;
const PEER_TIMEOUT_MS = 4500;

function env(name) {
  return process.env[name] || "";
}

function numOrNull(value) {
  if (value === null || value === undefined) return null; // Number(null) === 0（有限），会把"缺失"误判成"零"
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const fetchJson = (url, timeoutMs = 6000) => requestJson(url, {
  timeoutMs,
  userAgent: "EchoResearch/1.0 comp peers"
});

/** 阶段 → 倍数桶：只有同桶的 peer 才能拿来互相对照。 */
function bucketOf(stage) {
  if (stage === "profitable") return "pe";
  if (stage === "loss" || stage === "loss_growth") return "ev_sales";
  return "unknown";
}

const STAGE_LABEL = { profitable: "盈利", loss: "亏损", loss_growth: "亏损高成长", unknown: "未知阶段" };

/** Finnhub 同业清单 → 过滤成本管道能定价的 symbol（美股 bare ticker / 港股 NNNN.HK），排除自身。 */
async function fetchPeerSymbols(ticker) {
  const symbol = adrOrBareSymbol(ticker);
  if (!symbol) {
    const marketName = detectMarket(ticker) === "CN" ? "A 股" : "港股";
    return { symbols: [], detail: `${marketName}无美股 ADR 映射，Finnhub 免费档无法核到同业` };
  }
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");

  const data = await fetchJson(`https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
  if (!Array.isArray(data)) throw new Error("Finnhub peers 返回格式异常");

  const selfHk = !isUS(ticker) ? hkCode(ticker) : null;
  const selfBare = bareSymbol(ticker);
  const seen = new Set();
  const symbols = [];
  for (const raw of data) {
    const s = String(raw || "").toUpperCase();
    if (!s || s === symbol.toUpperCase()) continue; // 排除查询用的 ADR/self symbol 本身
    let normalized;
    if (/^\d{1,5}\.HK$/.test(s)) {
      const code = hkCode(s);
      if (code === selfHk) continue; // 排除 ADR 查询带出的自身港股主体
      normalized = `${code}.HK`;
    } else if (/^[A-Z]{1,5}$/.test(s)) {
      if (s === selfBare) continue;
      normalized = s;
    } else {
      continue; // A 股（.SZ/.SS）等本管道不支持定价的交易所，跳过
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    symbols.push(normalized);
    if (symbols.length >= MAX_PEERS) break;
  }
  return { symbols, detail: symbols.length ? null : "Finnhub 同业清单里没有本管道能定价的标的（多为 A 股/其它交易所）" };
}

function timeoutPeer(sym) {
  return { ticker: sym, stage: null, multiple: null, multipleType: null, providerStatus: "timeout", matched: false, reason: "拉取超时" };
}

/** 单个 peer 的阶段 + 倍数（PE 或 EV/Sales，视其自身阶段而定）；matched 表示是否与主体同桶。 */
async function fetchPeerMultiple(sym, subjectBucket) {
  try {
    const [snap, fin] = await Promise.all([
      getMarketSnapshot(sym).catch(() => null),
      getFinancials(sym).catch(() => ({ providerStatus: "missing" }))
    ]);
    if (!snap || snap.providerStatus !== "ok" || snap.price == null) {
      return { ticker: sym, stage: null, multiple: null, multipleType: null, providerStatus: "unavailable", matched: false, reason: "行情不可用" };
    }
    const stage = classifyAssetStage(fin);
    const bucket = bucketOf(stage);
    let multiple = null;
    let multipleType = null;
    if (bucket === "pe") {
      const pe = numOrNull(snap.pe) ?? (fin?.providerStatus === "ok" && numOrNull(fin.eps) ? snap.price / fin.eps : null);
      if (pe && pe > 0) { multiple = pe; multipleType = "PE"; }
    } else if (bucket === "ev_sales" && fin?.providerStatus === "ok") {
      const revenue = numOrNull(fin.revenue);
      const shares = numOrNull(fin.sharesOutstanding);
      const marketCap = numOrNull(snap.marketCap) ?? (shares ? snap.price * shares : null);
      const netCash = numOrNull(fin.netCash) ?? ((numOrNull(fin.cashAndEquivalents) || 0) - (numOrNull(fin.totalDebt) || 0));
      if (revenue && revenue > 0 && marketCap) {
        const ev = marketCap - netCash;
        if (ev > 0) { multiple = ev / revenue; multipleType = "EV/Sales"; }
      }
    }
    if (multiple == null) {
      return { ticker: sym, stage, multiple: null, multipleType: null, providerStatus: "unavailable", matched: false, reason: bucket === "unknown" ? "阶段未知（财务数据不足）" : "缺算倍数所需字段" };
    }
    const matched = bucket === subjectBucket;
    return { ticker: sym, stage, multiple, multipleType, providerStatus: "ok", matched, reason: matched ? null : `阶段不同（${STAGE_LABEL[stage] || stage}），未计入锚点` };
  } catch (error) {
    return { ticker: sym, stage: null, multiple: null, multipleType: null, providerStatus: "error", matched: false, reason: error?.message || "拉取失败" };
  }
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

/**
 * @returns {Promise<{stage: string, peers: Array, anchor: Object|null, providerStatus: "ok"|"missing", detail: string|null, partial: boolean}>}
 */
async function computeFresh(ticker) {
  const subjectFin = await withTimeout(getFinancials(ticker), PEER_TIMEOUT_MS, { providerStatus: "missing" });
  const subjectStage = classifyAssetStage(subjectFin);
  const subjectBucket = bucketOf(subjectStage);

  const { symbols, detail: peerListDetail } = await fetchPeerSymbols(ticker);

  if (subjectBucket === "unknown") {
    return { stage: subjectStage, peers: [], anchor: null, providerStatus: "missing", detail: "本标的财务数据不足，无法判断估值阶段，暂不建同业锚点", partial: false };
  }
  if (!symbols.length) {
    return { stage: subjectStage, peers: [], anchor: null, providerStatus: "missing", detail: peerListDetail || "Finnhub 未返回可用同业", partial: false };
  }

  const peers = await Promise.all(
    symbols.map((sym) => withTimeout(fetchPeerMultiple(sym, subjectBucket), PEER_TIMEOUT_MS, timeoutPeer(sym)))
  );

  const partial = peers.some((p) => p.providerStatus !== "ok");
  const matchedPeers = peers.filter((p) => p.matched);
  const matchedMultiples = matchedPeers.map((p) => p.multiple).sort((a, b) => a - b);

  let anchor = null;
  if (matchedMultiples.length >= 2) {
    anchor = {
      multipleType: subjectBucket === "pe" ? "PE" : "EV/Sales",
      p25: percentile(matchedMultiples, 0.25),
      median: percentile(matchedMultiples, 0.5),
      p75: percentile(matchedMultiples, 0.75),
      n: matchedMultiples.length,
      tickers: matchedPeers.map((p) => p.ticker)
    };
  }
  const detail = anchor
    ? `${anchor.n} 家同业计入锚点（${anchor.tickers.join("、")}）`
    : "同业数据不足（同阶段可比 <2 家），未生成同业锚点，沿用原估值方法";
  return { stage: subjectStage, peers, anchor, providerStatus: "ok", detail, partial };
}

function safeParseJson(json, fallback) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function rowToResult(row, { stale = false } = {}) {
  return {
    ticker: row.ticker,
    stage: row.stage,
    peers: safeParseJson(row.peers_json, []),
    anchor: safeParseJson(row.anchor_json, null),
    providerStatus: row.provider_status,
    detail: row.detail,
    partial: !!row.partial,
    stale
  };
}

function rowAgeMs(row) {
  // sqlite datetime('now') 落的是 UTC "YYYY-MM-DD HH:MM:SS"（无时区后缀）。
  const fetchedAt = Date.parse(`${row.fetched_at}Z`);
  return Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Infinity;
}

/**
 * 该 ticker 的自动可比公司清单 + 同业倍数锚点，24h TTL 读穿透缓存，stale-if-error 兜底。
 * @returns {Promise<{ticker, stage, peers: Array, anchor: Object|null, providerStatus: "ok"|"missing"|"error", detail, partial, stale}>}
 */
export async function getComparableCompanies(ticker) {
  const t = String(ticker || "").toUpperCase();
  const row = getCompPeersRow(t);
  if (row && rowAgeMs(row) < TTL_MS) return rowToResult(row);

  try {
    const fresh = await computeFresh(t);
    upsertCompPeers({ ticker: t, ...fresh });
    return { ticker: t, stale: false, ...fresh };
  } catch (error) {
    if (row) return rowToResult(row, { stale: true }); // 兜底：旧数据总比什么都没有强
    const detail = error?.message || "同业数据请求失败";
    upsertCompPeers({ ticker: t, stage: null, peers: [], anchor: null, providerStatus: "error", detail, partial: false });
    return { ticker: t, stage: null, peers: [], anchor: null, providerStatus: "error", detail, partial: false, stale: false };
  }
}
