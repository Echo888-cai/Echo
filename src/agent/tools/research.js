/**
 * ResearchTool - 结构化研究结论输出
 *
 * 作为 Agent 的最后一步调用，收集结构化的决策面板数据。
 * 内容报告由 LLM 直接在最终回复中生成，工具只收集关键结构信息。
 */
import { Tool } from "../tool.js";

export class ResearchTool extends Tool {
  name() { return "summarize_research"; }
  description() { return "输出最终研究结论的核心判断。在获取了行情、财务、新闻和公司档案之后，调用此工具来提交你的最终分析结论。"; }
  parameters() {
    return [
      { name: "rating", type: "string", enum: ["买入", "持有", "观察", "回避"], description: "投资评级", required: true },
      { name: "confidence", type: "string", enum: ["高", "中", "低"], description: "判断信心", required: true },
      { name: "oneLineView", type: "string", description: "一句话判断（不超过50字）", required: true },
      { name: "action", type: "string", description: "下一步建议（不超过30字）", required: true },
      { name: "dataCompleteness", type: "number", description: "数据完整度百分比 0-100", required: true }
    ];
  }

  async execute(args) {
    return {
      rating: args.rating,
      confidence: args.confidence,
      dataCompleteness: Number(args.dataCompleteness) || 0,
      oneLineView: args.oneLineView || "",
      action: args.action || "",
      keyDrivers: [
        { name: "价格信号", status: "neutral", summary: args.oneLineView?.slice(0, 30) || "" },
        { name: "基本面", status: args.confidence === "高" ? "good" : args.confidence === "低" ? "warn" : "neutral", summary: args.rating },
        { name: "估值", status: "neutral", summary: args.rating },
        { name: "股东回报", status: "neutral", summary: args.action?.slice(0, 20) || "" },
        { name: "风险信号", status: args.rating === "回避" ? "bad" : args.rating === "买入" ? "good" : "neutral", summary: args.rating }
      ]
    };
  }
}
