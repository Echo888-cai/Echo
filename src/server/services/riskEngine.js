/**
 * riskEngine — produces structured risk radar from profile + news + financial data.
 *
 * Every risk has:
 *   - severity: 高/中/低
 *   - trigger: a falsifiable condition (e.g. "毛利率连续两个季度低于 X%")
 *   - evidence: real evidence entries (source/asOf/quote/status/confidence/missingReason) —
 *     B-4：这里以前是一串没有实际指向的占位字符串（'fin_de_high' 之类），审计明确点出
 *     这是"事实锚定"的一个缺口。改成和 decisionPanel.js 的 evidence() 同形状的真实条目，
 *     每条都能看出这句话是从哪个数据源、哪个数字来的。
 *
 * When no data is available, returns a single "数据不足" risk entry with
 * a clear explanation instead of an empty array.
 */

/** 和 decisionPanel.js 的 evidence() 同形状，故意不跨模块 import——两个模块各自独立可测。 */
function evidence({ source, asOf = null, quote = null, status = null, confidence = "中", missingReason = "无" }) {
  return { source, asOf, quote, status, confidence, missingReason };
}

/**
 * Build a risk radar for the given company.
 *
 * @param {object} company — from companyRepository (with risks, monitors, sector, etc.)
 * @param {{marketSnapshot?: import("../types.js").MarketSnapshot, financialsData?: import("../types.js").FinancialsData, newsSnapshot?: import("../types.js").NewsSnapshot, filingsData?: import("../types.js").FilingsData}} [ctx]
 * @returns {{ risks: object[], sourceHealth: object, totalIdentified?: number, highSeverity?: number, mediumSeverity?: number }}
 */
export function buildRiskRadar(company, { marketSnapshot, financialsData, newsSnapshot, filingsData } = {}) {
  if (!company) {
    return {
      risks: [{ label: "无法评估风险", severity: "中", trigger: "缺少公司信息", evidence: [evidence({ source: "公司档案", confidence: "低", missingReason: "未拿到公司对象" })] }],
      sourceHealth: { market: "missing", financials: "missing", news: "missing", filings: "missing", documents: "missing" }
    };
  }

  const profileRisks = company.risks || [];
  const monitors = company.monitors || [];
  const hasFinancials = financialsData?.providerStatus === "ok";
  const hasNews = newsSnapshot?.providerStatus === "ok" && (newsSnapshot.articles || []).length > 0;
  const hasPrice = marketSnapshot?.providerStatus === "ok" && marketSnapshot?.price;
  const hasFilings = filingsData?.providerStatus === "ok" && (filingsData.filings || []).length > 0;

  const sourceHealth = {
    market: hasPrice ? "ok" : (marketSnapshot?.providerStatus === "missing" ? "missing" : "ok"),
    financials: hasFinancials ? "ok" : "missing",
    news: hasNews ? "ok" : "missing",
    filings: hasFilings ? "ok" : "missing",
    documents: "missing"
  };

  const risks = [];

  // 1. Sector-level risk（来自公司档案，仍是待公告核验的定性风险，不是硬数据）
  if (profileRisks.length > 0) {
    for (const risk of profileRisks.slice(0, 5)) {
      const monitor = monitors.find(m => risk.includes(m) || risk.includes(m.replace(" ", "")));
      risks.push({
        label: risk,
        severity: inferSeverity(risk),
        trigger: monitor ? `监控指标 "${monitor}" 触发警戒值` : `公司公告或财报中出现 ${risk} 信号时触发`,
        evidence: [evidence({ source: "公司档案", confidence: "低", missingReason: "定性风险来自 seed profile，未核到具体公告数字，待验证" })]
      });
    }
  }

  // 2. Financial risk —— 每条都带真实来源 + 具体数字，不再是空占位符
  if (hasFinancials) {
    const finEv = (quote) => evidence({ source: financialsData.source, asOf: financialsData.asOf || null, quote, confidence: "高", missingReason: "无" });

    if (financialsData.debtToEquity !== null && financialsData.debtToEquity > 200) {
      risks.push({
        label: "高负债率",
        severity: "高",
        trigger: `负债率 ${financialsData.debtToEquity}%，超过 200% 警戒线`,
        evidence: [finEv(`负债率 ${financialsData.debtToEquity}%`)]
      });
    }
    if (financialsData.freeCashFlow !== null && financialsData.freeCashFlow < 0) {
      risks.push({
        label: "自由现金流为负",
        severity: "中",
        trigger: `FCF ${financialsData.freeCashFlow}，连续两期为负需关注`,
        evidence: [finEv(`自由现金流 ${financialsData.freeCashFlow}`)]
      });
    }
    // B-4：优先用 B-2 的多期趋势判断——"连续放缓"或"由正转负拐点"比单期同比更早预警，
    // 也比"收入增速 < -10%"这种单点阈值更接近专业分析师看财报的方式。趋势数据缺失
    // （只拿到 1-2 期）时退回原来的单期阈值检查，不强求。
    if (financialsData.revenueTrend && (financialsData.revenueTrend.direction === "decelerating" || financialsData.revenueTrend.direction === "inflection_down")) {
      risks.push({
        label: financialsData.revenueTrend.direction === "inflection_down" ? "收入增速转负（拐点）" : "收入增速连续放缓",
        severity: financialsData.revenueTrend.direction === "inflection_down" ? "高" : "中",
        trigger: financialsData.revenueTrend.label,
        evidence: [finEv(financialsData.revenueTrend.label)]
      });
    } else if (financialsData.revenueGrowth !== null && financialsData.revenueGrowth < -10) {
      risks.push({
        label: "收入快速下滑",
        severity: "高",
        trigger: `收入增速 ${financialsData.revenueGrowth}%，低于 -10%`,
        evidence: [finEv(`收入增速 ${financialsData.revenueGrowth}%`)]
      });
    }
    // B-4：利润趋势独立于收入趋势判断——利润连续放缓/转负往往比收入更早暴露费用失控
    // 或毛利率被侵蚀，即使收入还在增长。
    if (financialsData.profitTrend && (financialsData.profitTrend.direction === "decelerating" || financialsData.profitTrend.direction === "inflection_down")) {
      risks.push({
        label: financialsData.profitTrend.direction === "inflection_down" ? "利润增速转负（拐点）" : "利润增速连续放缓",
        severity: financialsData.profitTrend.direction === "inflection_down" ? "高" : "中",
        trigger: financialsData.profitTrend.label,
        evidence: [finEv(financialsData.profitTrend.label)]
      });
    }
    if (financialsData.grossMargin !== null && financialsData.grossMargin < 15) {
      risks.push({
        label: "毛利率偏低",
        severity: "中",
        trigger: `毛利率 ${financialsData.grossMargin}%，低于 15% 的可持续水平`,
        evidence: [finEv(`毛利率 ${financialsData.grossMargin}%`)]
      });
    }
  }

  // 3. Market risk
  if (hasPrice) {
    const changePct = Math.abs(marketSnapshot.changePercent || 0);
    if (changePct > 8) {
      risks.push({
        label: "近期股价剧烈波动",
        severity: "中",
        trigger: `日内涨跌幅 ${changePct.toFixed(1)}%，超过 8%`,
        evidence: [evidence({ source: marketSnapshot.source, asOf: marketSnapshot.asOf || null, quote: `涨跌幅 ${changePct.toFixed(1)}%`, confidence: "高", missingReason: "无" })]
      });
    }
  }

  // 4. News risk
  if (hasNews) {
    const negative = newsSnapshot.sentiment?.negativeCount || 0;
    if (negative >= 3) {
      risks.push({
        label: "近期负面新闻较多",
        severity: "中",
        trigger: `负面报道 ${negative} 条，需验证事实影响`,
        evidence: [evidence({ source: newsSnapshot.source || "新闻源", asOf: newsSnapshot.asOf || null, quote: `负面报道 ${negative} 条`, confidence: "中", missingReason: "情绪计数为粗筛，事实影响仍需逐条核验" })]
      });
    }
  }

  // 5. "No news" gap risk
  if (!hasNews) {
    risks.push({
      label: "新闻源缺失，无法评估舆情风险",
      severity: "低",
      trigger: "新闻接口 timeout —— 配置 Finnhub 或新闻 API 后可补全",
      evidence: [evidence({ source: "新闻源", confidence: "低", missingReason: "新闻接口 timeout 或无返回" })]
    });
  }

  // B-4 修的一个真实发现：一直以来"没触发任何风险"和"数据不够、评估不了"共用同一句
  // "缺乏足够数据"，浏览器实测 AAPL（行情/财报/新闻/公告/预期全部 ok，只是财务健康、
  // 没有踩线）就被误判成"数据不足"——明明数据很全，只是没有风险信号。两种情况该说
  // 不同的话：数据真的缺 → 老实说数据不足；数据够但没踩线 → 应该是个积极信号，不是缺口。
  if (risks.length === 0) {
    const dataSufficient = hasFinancials && hasPrice;
    risks.push(dataSufficient
      ? {
          label: "未识别到需要警惕的风险信号",
          severity: "低",
          trigger: "行情/财报/新闻数据均已接入，负债率/现金流/毛利率/增速趋势均未触发阈值",
          evidence: [evidence({ source: financialsData?.source || "综合", asOf: financialsData?.asOf || null, confidence: "中", missingReason: "无——这是数据充分下的正常结果，不是数据缺口" })]
        }
      : {
          label: "缺乏足够数据构造风险雷达，安全起见视为中等不确定性",
          severity: "中",
          trigger: "数据不足状态 —— 当市场/财务/新闻数据齐全后可给出更具体风险",
          evidence: [evidence({ source: "综合", confidence: "低", missingReason: "行情/财务/新闻均未接地" })]
        });
  }

  return {
    risks: risks.slice(0, 8),
    sourceHealth,
    totalIdentified: risks.length,
    highSeverity: risks.filter(r => r.severity === "高").length,
    mediumSeverity: risks.filter(r => r.severity === "中").length
  };
}

function inferSeverity(riskText) {
  const high = /监管|诉讼|罚|破产|退市|流动性危机|违约|集采|调查|亏损/i;
  const medium = /竞争|波动|周期|依赖|集中|合规|下降|压价|原材料/i;
  if (high.test(riskText)) return "高";
  if (medium.test(riskText)) return "中";
  return "低";
}
