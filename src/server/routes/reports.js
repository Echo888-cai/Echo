import { readJsonBody, sendJson } from "../utils/async.js";
import { runAgent } from "../services/agentService.js";
import { composeReport, reportPreview } from "../services/reportComposer.js";

export async function handleReportGenerateApi(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = await runAgent(payload);
    const report = composeReport(result.decisionPanel);
    sendJson(res, 200, {
      mode: result.mode === "model" ? "report_model" : "report_local",
      provider: result.provider,
      model: result.model,
      decisionPanel: result.decisionPanel,
      markdown: report.markdown,
      preview: reportPreview(result.decisionPanel),
      dataSources: result.dataSources,
      marketSnapshot: result.marketSnapshot,
      newsSnapshot: result.newsSnapshot
    });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, { error: error.message || "报告生成失败" });
  }
}
