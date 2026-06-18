/**
 * FinancialsTool - 获取财务数据
 */
import { Tool } from "../tool.js";
import { getFinancials, getAnalystEstimates, financialsToMarkdown, analystEstimatesToMarkdown } from "../../financialData.js";

export class FinancialsTool extends Tool {
  name() { return "get_financial_data"; }
  description() { return "获取港股公司的财务数据，包括收入增速、毛利率、利润率、FCF、回购、Forward PE、分析师预期等。"; }
  parameters() {
    return [
      { name: "ticker", type: "string", description: "港股代码，如 0700.HK", required: true }
    ];
  }

  async execute(args) {
    const [financials, estimates] = await Promise.all([
      getFinancials(args.ticker).catch(() => ({ providerStatus: "missing", errors: ["获取失败"] })),
      getAnalystEstimates(args.ticker).catch(() => ({ providerStatus: "missing", errors: ["获取失败"] }))
    ]);

    const hasFinancials = financials?.providerStatus === "ok";
    const hasEstimates = estimates?.providerStatus === "ok";

    return {
      ticker: args.ticker,
      hasFinancials,
      hasEstimates,
      revenueGrowth: financials?.revenueGrowth ?? null,
      profitGrowth: financials?.profitGrowth ?? null,
      grossMargin: financials?.grossMargin ?? null,
      operatingMargin: financials?.operatingMargin ?? null,
      freeCashFlow: financials?.freeCashFlow ?? null,
      netDebt: financials?.netDebt ?? null,
      repurchaseOfStock: financials?.repurchaseOfStock ?? null,
      forwardPE: hasFinancials ? financials?.forwardPE ?? null : null,
      analystCount: estimates?.analystCount ?? null,
      markdown: [
        hasFinancials ? financialsToMarkdown(financials) : "财务数据不可用",
        hasEstimates ? analystEstimatesToMarkdown(estimates) : "分析师评级不可用"
      ].filter(Boolean).join("\n\n")
    };
  }
}
