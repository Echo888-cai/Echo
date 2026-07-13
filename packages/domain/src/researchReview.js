/**
 * researchReview — R7 研究记分卡/自动复盘（Phase B）：纯函数，把 `research_snapshots`
 * 的历史快照跟"现在的价格"做对比，回答"当时说了什么 vs 后来实际发生了什么"。
 *
 * 刻意不做的事（跟本项目一贯的 fail-safe 哲学一致）：
 * - 不产出"看多/看空对不对"这种主观评级判断——只算客观几何关系（价格相对当时估值带
 *   的位置、有没有向估值中枢靠拢、有没有触到当时的证伪线）。
 * - 样本不足或太年轻时，诚实说"暂不能算"，不硬凑百分比。真实验证过：本项目当前最老
 *   的画像快照只有 1-2 天，任何"准确率"都是噪音，必须被这套阈值挡住，不能强行展示。
 *
 * 唯一的已知局限（如实记录，不隐藏）：`priceNow` 只是"此刻"的价格，不是完整历史路径——
 * 一条证伪线可能在快照和现在之间被触发过又被"救回来"，这套计算看不到，只能回答
 * "以现在的价格看，当时的证伪线是否处于已越线状态"。
 */

import { evaluateRule, parseFalsifierRule } from "./falsifyRules.js";

// "成熟"快照的判定阈值：太年轻的判断拿来算命中率没有意义。
export const MIN_MATURE_DAYS = 14;
// 至少要有这么多条成熟快照，才展示统计口径（宁可不算，不可硬凑）。
export const MIN_MATURE_SAMPLES = 3;

function daysBetween(fromISO, toISO) {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * F-2：这条快照之后有没有新财报到货——只有"最近一次已报告"日期晚于快照日期，才算是
 * "这条判断做出之后才发生的新事实"，否则那份财报在判断当时就已经是已知信息。
 * @param {object} snapshot
 * @param {object|null} earningsRow - `earningsCalendarRepository.getEarningsCalendarRow` 的原始
 *   行（snake_case，故意不重新包一层——只有这一个消费点，多包一层反而增加维护面）
 */
function computePostEarnings(snapshot, earningsRow) {
  if (!earningsRow?.last_date) return null;
  if (!(earningsRow.last_date > snapshot.snapshotDate)) return null;
  return {
    date: earningsRow.last_date,
    epsSurprisePct: earningsRow.last_eps_surprise_pct ?? null,
    revenueSurprisePct: earningsRow.last_revenue_surprise_pct ?? null
  };
}

/**
 * 单条快照 vs 现价的复盘计算。
 * @param {object} snapshot - researchSnapshotsRepository 的 hydrate 结果
 * @param {{price: number|null, asOf?: string}} current - 现价（null 表示行情源不可用）
 * @param {string} [asOfDate] - 复盘计算发生的日期（默认今天，纯函数需要传入避免测试不稳定）
 * @param {object|null} [earningsRow] - F-2：该 ticker 的财报日历原始行，用于判定快照之后
 *   有没有新财报到货（beat/miss）；不传或没有数据时 `postEarnings` 诚实为 null
 */
export function computeSnapshotReview(snapshot, current, asOfDate = new Date().toISOString().slice(0, 10), earningsRow = null) {
  const daysElapsed = daysBetween(snapshot.snapshotDate, asOfDate);
  const priceThen = snapshot.priceAtSnapshot;
  const priceNow = current?.price ?? null;
  const isMature = daysElapsed != null && daysElapsed >= MIN_MATURE_DAYS;

  let pctChange = null;
  if (priceThen != null && priceThen !== 0 && priceNow != null) {
    pctChange = Math.round(((priceNow - priceThen) / priceThen) * 1000) / 10;
  }

  // 价格是否落在当时的估值带 [bear, bull] 内——客观事实，不是评级。
  let withinBand = null;
  if (priceNow != null && snapshot.valuationBear != null && snapshot.valuationBull != null) {
    withinBand = priceNow >= snapshot.valuationBear && priceNow <= snapshot.valuationBull;
  }

  // 是否朝着当时的估值中枢（base）靠拢——"below_base 且现价比当时更接近/超过 base"算靠拢。
  let towardBase = null;
  if (priceNow != null && priceThen != null && snapshot.valuationBase != null && snapshot.valuationPosition) {
    if (snapshot.valuationPosition === "below_base") towardBase = priceNow > priceThen;
    else if (snapshot.valuationPosition === "above_base") towardBase = priceNow < priceThen;
    // "at_base" 没有方向可言，towardBase 保持 null
  }

  // 当时的证伪线，用现价核对是否处于"已越线"状态（不代表期间从未越线过又恢复——见模块顶部局限说明）。
  const falsifierStatus = (snapshot.falsifiers || [])
    .map((text) => {
      const rule = parseFalsifierRule(text);
      if (!rule || priceNow == null) return { label: text, evaluable: false, breached: null };
      const { sane, triggered } = evaluateRule(rule, priceNow);
      return { label: text, evaluable: sane, breached: sane ? triggered : null };
    });

  return {
    ticker: snapshot.ticker,
    snapshotDate: snapshot.snapshotDate,
    thesis: snapshot.thesis,
    daysElapsed,
    isMature,
    priceThen,
    priceNow,
    priceCurrency: snapshot.valuationCurrency,
    pctChange,
    valuationPosition: snapshot.valuationPosition,
    withinBand,
    towardBase,
    falsifierStatus,
    postEarnings: computePostEarnings(snapshot, earningsRow),
    sessionId: snapshot.sessionId
  };
}

/**
 * F-2：EPS beat 率——只在能算出惊喜幅度的样本里算（预期缺失的报告没法判断 beat/miss，
 * 不计入分母）。样本为 0 时诚实返回 null，不是 0%（0% 意味着"全 miss"，跟"没数据"是
 * 两回事，混为一谈会误导）。
 */
function summarizePostEarnings(reviews) {
  const withCheck = reviews.filter((r) => r.postEarnings?.epsSurprisePct != null);
  if (!withCheck.length) return { postEarningsSampleSize: 0, epsBeatRate: null };
  const beats = withCheck.filter((r) => r.postEarnings.epsSurprisePct > 0).length;
  return { postEarningsSampleSize: withCheck.length, epsBeatRate: Math.round((beats / withCheck.length) * 100) };
}

/**
 * 一只票的记分卡：聚合该 ticker 全部快照的复盘结果。样本不足时诚实降级，不算百分比。
 * @param {object[]} snapshots - listSnapshots(ticker) 的结果，按时间正序
 * @param {{price: number|null}} current
 * @param {string} [asOfDate]
 * @param {object|null} [earningsRow] - F-2：见 computeSnapshotReview 的同名参数
 */
export function computeTickerScorecard(snapshots = [], current, asOfDate, earningsRow = null) {
  const reviews = snapshots.map((s) => computeSnapshotReview(s, current, asOfDate, earningsRow));
  const mature = reviews.filter((r) => r.isMature && r.withinBand != null);
  const matureSampleSize = mature.length;
  const insufficientSample = matureSampleSize < MIN_MATURE_SAMPLES;

  const base = { totalSnapshots: reviews.length, matureSampleSize, insufficientSample, reviews };
  if (insufficientSample) {
    return {
      ...base,
      message: `有效快照 ${matureSampleSize} 条（需要满 ${MIN_MATURE_DAYS} 天且 ≥${MIN_MATURE_SAMPLES} 条才有统计意义）——样本不足，暂不显示准确率。`
    };
  }
  const withinBandRate = Math.round((mature.filter((r) => r.withinBand).length / matureSampleSize) * 100);
  const towardBaseSamples = mature.filter((r) => r.towardBase != null);
  const towardBaseRate = towardBaseSamples.length
    ? Math.round((towardBaseSamples.filter((r) => r.towardBase).length / towardBaseSamples.length) * 100)
    : null;
  const falsifierBreaches = mature.reduce((n, r) => n + r.falsifierStatus.filter((f) => f.breached).length, 0);
  const { postEarningsSampleSize, epsBeatRate } = summarizePostEarnings(mature);
  return { ...base, withinBandRate, towardBaseRate, falsifierBreaches, postEarningsSampleSize, epsBeatRate };
}

/**
 * 跨全部 ticker 的全局记分卡（设置页"研究记分卡"卡片用）。同样的样本量门槛，
 * 不因为"多只票加起来样本多了"就放松单只票的成熟度要求——直接汇总各票的成熟样本。
 * @param {Array<{ticker: string, scorecard: ReturnType<typeof computeTickerScorecard>}>} perTicker
 */
export function computeGlobalScorecard(perTicker = []) {
  const allMature = perTicker.flatMap((t) => t.scorecard.reviews.filter((r) => r.isMature && r.withinBand != null));
  const matureSampleSize = allMature.length;
  const insufficientSample = matureSampleSize < MIN_MATURE_SAMPLES;
  const tickerCount = perTicker.length;
  if (insufficientSample) {
    return {
      tickerCount,
      matureSampleSize,
      insufficientSample,
      message: `${tickerCount} 只票共 ${matureSampleSize} 条成熟快照（需要满 ${MIN_MATURE_DAYS} 天且全局 ≥${MIN_MATURE_SAMPLES} 条）——样本不足，暂不显示整体准确率。`
    };
  }
  const withinBandRate = Math.round((allMature.filter((r) => r.withinBand).length / matureSampleSize) * 100);
  const towardBaseSamples = allMature.filter((r) => r.towardBase != null);
  const towardBaseRate = towardBaseSamples.length
    ? Math.round((towardBaseSamples.filter((r) => r.towardBase).length / towardBaseSamples.length) * 100)
    : null;
  const { postEarningsSampleSize, epsBeatRate } = summarizePostEarnings(allMature);
  return { tickerCount, matureSampleSize, insufficientSample, withinBandRate, towardBaseRate, postEarningsSampleSize, epsBeatRate };
}
