/**
 * localContent — deterministic, source-aware Markdown summary used when no
 * model key is configured OR when the model output fails validation after
 * one repair attempt. Never fabricates facts; missing fields are written as
 * "缺失 —— [原因]".
 */

import { compactNumberServer, fmtPercent, quoteStatusFor } from "../utils/format.js";

function quoteStatus(snapshot) {
  return quoteStatusFor(snapshot);
}

function quoteLine(article, index) {
  return `${index + 1}. ${article.source || "News"}｜${article.publishedAt || "时间缺失"}｜${article.title}${article.url ? `｜${article.url}` : ""}`;
}

export function buildLocalContent({ question, company, filings = [], marketSnapshot = null, newsSnapshot = null, documents: _documents = [], memory: _memory = {}, financialsData = null, filingsData = null, estimatesData = null, userContext = null }) {
  const profile = company || { ticker: "unknown.HK", nameZh: "研究对象" };
  const summary = profile.summary || [];
  const risks = profile.risks || [];
  const hasPrice = marketSnapshot?.providerStatus === "ok";
  const articles = newsSnapshot?.providerStatus === "ok" ? newsSnapshot.articles || [] : [];
  const hasFinancials = financialsData?.providerStatus === "ok";
  const hasFilings = (filingsData?.providerStatus === "ok" && (filingsData.filings || []).length > 0) || filings.length > 0;
  const hasEstimates = estimatesData?.providerStatus === "ok";
  const quoteMode = quoteStatus(marketSnapshot);
  const currentPrice = hasPrice ? `${marketSnapshot.price} ${marketSnapshot.currency}` : "暂不可用";
  const hasAnomaly = userContext && (Number(userContext.cost || 0) <= 1 || Number(userContext.shares || 0) === 0);

  const userLine = userContext && (userContext.cost || userContext.shares || userContext.horizon)
    ? `用户持仓：成本 ${userContext.cost || "未提供"}，持股 ${userContext.shares || "未提供"} 股，周期 ${userContext.horizon || "未提供"}。`
    : "未录入持仓。添加成本价和仓位后，可生成分批和止错计划。";

  const priceSummary = hasPrice
    ? `当前价格 ${currentPrice}（${quoteMode}），日内 ${marketSnapshot.changePercent !== null ? fmtPercent(marketSnapshot.changePercent) : "待确认"}。`
    : "行情数据暂不可用。";

  const newsSummary = articles.length
    ? `近期有 ${articles.length} 条相关新闻/舆论信号。`
    : "新闻源暂未接入或者当前未返回数据。";

  const financialSummary = hasFinancials
    ? `收入增速 ${fmtPercent(financialsData.revenueGrowth)}，毛利率 ${fmtPercent(financialsData.grossMargin)}，${financialsData.freeCashFlow ? "FCF " + compactNumberServer(financialsData.freeCashFlow) : "FCF 待确认"}。`
    : "财务明细暂不可用。";

  const sourceLines = [
    hasPrice ? `实时行情来源：${marketSnapshot.source}（${quoteMode}）` : "实时行情：缺失 —— 行情源未接入",
    hasFinancials ? `财报来源：${financialsData.source}（${financialsData.period || "期间未知"}）` : "财报来源：缺失 —— 财报数据未接入",
    hasFilings ? `公告来源：HKEX 披露易（${(filingsData?.filings || filings).length} 条）` : "公告来源：缺失 —— HKEX 公告未接入",
    newsSnapshot?.providerStatus === "ok" ? `新闻来源：${newsSnapshot.source}` : "新闻来源：缺失 —— 新闻源 timeout 或无返回"
  ];

  const newsHeadlines = articles.length
    ? articles.slice(0, 6).map(quoteLine).join("\n")
    : "- 暂无可用新闻";

  return `## ${profile.nameZh}（${profile.ticker}）研究报告摘要

**研究状态**：本地模板 | **信心**：${hasPrice && hasFinancials ? "中" : "低"}

### 公司概况
${(summary.length ? summary.slice(0, 2).join("；") : profile.nameZh) + "。"}

### 价格走势
${priceSummary}

### 舆论信号
${newsSummary}

### 财务概览
${financialSummary}

### 主要风险
${risks.slice(0, 3).map((r) => `- ${r}`).join("\n") || "- 暂无明确风险条目。"}

### 持仓上下文
${userLine}
${hasAnomaly ? "持仓数据需确认 —— 检测到异常值，已自动隐藏。" : ""}

### 展望
- 短期：持续关注价格变化和相关新闻信号。
- 中期：等待更多财务数据和公告披露。
- 长期：${summary.length > 2 ? summary[0] : "需持续跟踪业务基本面和行业趋势。"}

### 下一步
${hasFinancials && hasEstimates ? "结合估值和赔率做判断" : hasFinancials ? "等待分析师评级数据" : "等待财务数据接入后再判断"}
${question ? `用户问题：${question}` : ""}

### 来源审计
${sourceLines.join("\n")}
新闻标题（最多 6 条）：
${newsHeadlines}

> 模式：本地模板。不编造未验证事实。`;
}
