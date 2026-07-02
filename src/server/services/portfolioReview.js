/**
 * portfolioReview — 组合体检（P3）：从"单笔持仓"上升到"组合"视角的确定性检查。
 *
 * 输入是 routes/portfolio.js enrichPosition 之后的持仓（已带现价/市值/盈亏/距离止损线），
 * 本模块是纯函数：不打网络、不读库，好测。
 *
 * 检查项（投资纪律视角，最严重的排最前）：
 *   1. 触线未处理：现价已破止损/达止盈
 *   2. 深回撤：相对成本 ≤ -20%
 *   3. 集中度：单一持仓权重 >45% 红 / >30% 黄（跨币种按近似汇率折算，展示级标注）
 *   4. 纪律漏洞：有成本却没设止损的持仓（点名）
 *   5. 逼近止损：距止损 <8%
 *   6. 单一市场满仓：100% 港股或 100% 美股（提示，不算错）
 *
 * 刻意不做：相关性矩阵/波动率/VaR——个人研究工具阶段，可解释性 >> 学术完备。
 */

// 展示级近似汇率（体检权重用，非交易口径；界面标注"≈"）。
const FX_TO_USD = { USD: 1, HKD: 1 / 7.8 };

const pct = (x) => Math.round(x * 1000) / 10; // 0.3456 → 34.6

export function computePortfolioReview(enriched = []) {
  const positions = enriched.filter((p) => p && p.ticker);
  if (!positions.length) {
    return { positionCount: 0, totals: [], weights: [], marketExposure: {}, checks: [], verdict: "还没有持仓记录。" };
  }

  // 分币种总额
  const byCurrency = new Map();
  for (const p of positions) {
    if (p.marketValue == null) continue;
    const cur = p.currency || "USD";
    const acc = byCurrency.get(cur) || { currency: cur, marketValue: 0, costValue: 0, pnl: 0 };
    acc.marketValue += p.marketValue;
    acc.costValue += p.costValue || 0;
    acc.pnl += p.unrealizedPnl || 0;
    byCurrency.set(cur, acc);
  }
  const totals = [...byCurrency.values()].map((t) => ({
    ...t,
    marketValue: Math.round(t.marketValue),
    costValue: Math.round(t.costValue),
    pnl: Math.round(t.pnl),
    pnlPct: t.costValue ? pct(t.pnl / t.costValue) : null
  }));

  // 权重（跨币种折 USD 近似）
  const usdValue = (p) => (p.marketValue != null ? p.marketValue * (FX_TO_USD[p.currency] || 1) : null);
  const priced = positions.filter((p) => usdValue(p) != null);
  const totalUsd = priced.reduce((s, p) => s + usdValue(p), 0);
  const weights = priced
    .map((p) => ({ ticker: p.ticker, name: p.companyName || p.ticker, weightPct: totalUsd ? pct(usdValue(p) / totalUsd) : null, returnPct: p.returnPct ?? null }))
    .sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));

  // 市场暴露
  const isHk = (t) => /\.HK$/i.test(t) || /^\d{4,5}$/.test(t);
  const hkUsd = priced.filter((p) => isHk(p.ticker)).reduce((s, p) => s + usdValue(p), 0);
  const marketExposure = totalUsd
    ? { HK: pct(hkUsd / totalUsd), US: pct((totalUsd - hkUsd) / totalUsd) }
    : {};

  // 纪律检查
  const checks = [];
  for (const p of positions) {
    if (p.currentPrice != null && p.stopLoss != null && p.currentPrice <= p.stopLoss) {
      checks.push({ level: "bad", ticker: p.ticker, text: `${p.companyName || p.ticker} 已破止损线 ${p.stopLoss}（现价 ${p.currentPrice}）——纪律要求先执行再复盘` });
    } else if (p.currentPrice != null && p.takeProfit != null && p.currentPrice >= p.takeProfit) {
      checks.push({ level: "warn", ticker: p.ticker, text: `${p.companyName || p.ticker} 已达止盈线 ${p.takeProfit}（现价 ${p.currentPrice}），按计划复核是否兑现` });
    }
  }
  for (const p of positions) {
    if (typeof p.returnPct === "number" && p.returnPct <= -0.2) {
      checks.push({ level: "bad", ticker: p.ticker, text: `${p.companyName || p.ticker} 相对成本回撤 ${pct(p.returnPct)}%——复核投资逻辑是否仍成立` });
    }
  }
  const top = weights[0];
  if (top?.weightPct > 45) {
    checks.push({ level: "bad", ticker: top.ticker, text: `单一持仓 ${top.name} 占组合 ≈${top.weightPct}%（跨币种按 7.8 折算）——高集中度意味着一次判断错误就伤及全局` });
  } else if (top?.weightPct > 30) {
    checks.push({ level: "warn", ticker: top.ticker, text: `最大持仓 ${top.name} 占组合 ≈${top.weightPct}%，注意集中度` });
  }
  const noStop = positions.filter((p) => p.avgCost != null && p.stopLoss == null);
  if (noStop.length) {
    checks.push({ level: "warn", text: `${noStop.map((p) => p.companyName || p.ticker).join("、")} 没有设止损线——等于没有"我错了就走"的预案` });
  }
  for (const p of positions) {
    if (typeof p.toStopPct === "number" && p.toStopPct > 0 && p.toStopPct < 0.08) {
      checks.push({ level: "warn", ticker: p.ticker, text: `${p.companyName || p.ticker} 距止损仅 ${pct(p.toStopPct)}%，提前想好触发后的动作` });
    }
  }
  if (positions.length >= 2 && (marketExposure.HK === 100 || marketExposure.US === 100)) {
    checks.push({ level: "info", text: `组合 100% 集中在${marketExposure.HK === 100 ? "港股" : "美股"}单一市场（提示，不是错误）` });
  }

  // 一句话结论：最严重的问题定调
  const bad = checks.filter((c) => c.level === "bad");
  const warn = checks.filter((c) => c.level === "warn");
  const verdict = bad.length
    ? `${bad.length} 项纪律红线待处理：${bad[0].text.split("——")[0]}${bad.length > 1 ? " 等" : ""}。`
    : warn.length
      ? `无红线，但有 ${warn.length} 项值得注意：${warn[0].text.split("——")[0]}${warn.length > 1 ? " 等" : ""}。`
      : "组合纪律检查全部通过：无触线、无深回撤、集中度可控、止损线齐备。";

  return { positionCount: positions.length, totals, weights: weights.slice(0, 8), marketExposure, checks, verdict };
}
