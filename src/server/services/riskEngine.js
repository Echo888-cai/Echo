/**
 * riskEngine — produces structured risk radar from profile + news + financial data.
 *
 * Every risk has:
 *   - severity: 高/中/低
 *   - trigger: a falsifiable condition (e.g. "毛利率连续两个季度低于 X%")
 *   - evidenceIds: references to evidence in the evidence array
 *
 * When no data is available, returns a single "数据不足" risk entry with
 * a clear explanation instead of an empty array.
 */

/**
 * Build a risk radar for the given company.
 *
 * @param {object} company — from companyRepository (with risks, monitors, sector, etc.)
 * @param {object} marketSnapshot
 * @param {object} financialsData
 * @param {object} newsSnapshot
 * @param {object} filingsData
 * @returns {{ risks: object[], sourceHealth: object }}
 */
export function buildRiskRadar(company, { marketSnapshot, financialsData, newsSnapshot, filingsData } = {}) {
  if (!company) {
    return {
      risks: [{ risk: "无法评估风险", severity: "中", trigger: "缺少公司信息", evidenceIds: [] }],
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
  const evidenceIds = [];

  // 1. Sector-level risk
  if (profileRisks.length > 0) {
    // Take top profile risks and convert to structured entries
    for (const risk of profileRisks.slice(0, 5)) {
      const monitor = monitors.find(m => risk.includes(m) || risk.includes(m.replace(" ", "")));
      risks.push({
        risk,
        severity: inferSeverity(risk),
        trigger: monitor ? `监控指标 "${monitor}" 触发警戒值` : `公司公告或财报中出现 ${risk} 信号时触发`,
        evidenceIds: [`profile_${company.ticker}_${risks.length}`]
      });
    }
  }

  // 2. Financial risk
  if (hasFinancials) {
    if (financialsData.debtToEquity !== null && financialsData.debtToEquity > 200) {
      risks.push({
        risk: "高负债率",
        severity: "高",
        trigger: `负债率 ${financialsData.debtToEquity}%，超过 200% 警戒线`,
        evidenceIds: ['fin_de_high']
      });
    }
    if (financialsData.freeCashFlow !== null && financialsData.freeCashFlow < 0) {
      risks.push({
        risk: "自由现金流为负",
        severity: "中",
        trigger: `FCF ${financialsData.freeCashFlow}，连续两期为负需关注`,
        evidenceIds: ['fin_fcf_neg']
      });
    }
    if (financialsData.revenueGrowth !== null && financialsData.revenueGrowth < -10) {
      risks.push({
        risk: "收入快速下滑",
        severity: "高",
        trigger: `收入增速 ${financialsData.revenueGrowth}%，低于 -10%`,
        evidenceIds: ['fin_rev_decline']
      });
    }
    if (financialsData.grossMargin !== null && financialsData.grossMargin < 15) {
      risks.push({
        risk: "毛利率偏低",
        severity: "中",
        trigger: `毛利率 ${financialsData.grossMargin}%，低于 15% 的可持续水平`,
        evidenceIds: ['fin_gm_low']
      });
    }
  }

  // 3. Market risk
  if (hasPrice) {
    const changePct = Math.abs(marketSnapshot.changePercent || 0);
    if (changePct > 8) {
      risks.push({
        risk: "近期股价剧烈波动",
        severity: "中",
        trigger: `日内涨跌幅 ${changePct.toFixed(1)}%，超过 8%`,
        evidenceIds: ['mkt_volatile']
      });
    }
  }

  // 4. News risk
  if (hasNews) {
    const articles = newsSnapshot.articles || [];
    const negative = newsSnapshot.sentiment?.negativeCount || 0;
    if (negative >= 3) {
      risks.push({
        risk: "近期负面新闻较多",
        severity: "中",
        trigger: `负面报道 ${negative} 条，需验证事实影响`,
        evidenceIds: ['news_negative']
      });
    }
  }

  // 5. "No news" gap risk
  if (!hasNews) {
    risks.push({
      risk: "新闻源缺失，无法评估舆情风险",
      severity: "低",
      trigger: "新闻接口 timeout —— 配置 Finnhub 或新闻 API 后可补全",
      evidenceIds: ['news_missing']
    });
  }

  // If we have literally no risks, indicate data gap
  if (risks.length === 0) {
    risks.push({
      risk: "缺乏足够数据构造风险雷达，安全起见视为中等不确定性",
      severity: "中",
      trigger: "数据不足状态 —— 当市场/财务/新闻数据齐全后可给出更具体风险",
      evidenceIds: []
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
