import { getResearchSession, listConversations } from "@echo/db/repositories/researchSessionsRepository.js";
import { getCompanyProfile } from "@echo/db/repositories/companyProfilesRepository.js";

export interface ExportOptions {
  sessionId?: string;
  ticker?: string;
  conversationId?: string;
  format: "markdown";
  includeEvidence?: boolean;
  includeTimeline?: boolean;
  includeDisclaimer?: boolean;
}

export async function exportResearchMarkdown(opts: ExportOptions, userId: string): Promise<string> {
  const sections: string[] = [];

  const now = new Date().toISOString();
  sections.push(`# Echo Research 导出\n`);
  sections.push(`> 导出时间：${now.slice(0, 19).replace("T", " ")} UTC`);
  sections.push(`> 本报告由 Echo Research 生成，仅供参考，不构成投资建议。\n`);

  let ticker = opts.ticker;

  if (opts.sessionId) {
    const session = await getResearchSession(opts.sessionId, userId);
    if (session) {
      ticker = ticker || session.ticker || undefined;
      sections.push(`## 研究问题\n`);
      sections.push(session.question || "（无）");
      sections.push("");

      if (session.reportMarkdown) {
        sections.push(`## 研究报告\n`);
        sections.push(session.reportMarkdown);
        sections.push("");
      }

      if (session.fullResearch) {
        sections.push(`## 完整研究\n`);
        sections.push(session.fullResearch);
        sections.push("");
      }

      if (session.dataSources) {
        sections.push(`## 数据来源\n`);
        const ds = session.dataSources as Record<string, Record<string, string>>;
        if (ds.market) sections.push(`- 行情：${ds.market.source || "未知"} (${ds.market.status})`);
        if (ds.financials) sections.push(`- 财务：${ds.financials.source || "未知"} (${ds.financials.status})`);
        if (ds.valuation) sections.push(`- 估值：${ds.valuation.method || "未知"} (${ds.valuation.status})`);
        sections.push("");
      }

      if (session.decisionPanel) {
        const dp = session.decisionPanel as Record<string, string>;
        sections.push(`## 决策面板\n`);
        if (dp.rating) sections.push(`- 评级：${dp.rating}`);
        if (dp.confidence) sections.push(`- 置信度：${dp.confidence}`);
        if (dp.thesis) sections.push(`- 论点：${dp.thesis}`);
        sections.push("");
      }
    }
  }

  if (opts.conversationId) {
    const conversations = await listConversations({ limit: 200, userId });
    const conversation = conversations.find(c => c.conversationId === opts.conversationId);
    if (conversation && conversation.sessions.length > 1) {
      sections.push(`## 对话历史（${conversation.sessions.length} 轮）\n`);
      for (const s of conversation.sessions) {
        sections.push(`### ${s.title || "无题"} (${(s.createdAt || "").slice(0, 10)})`);
        const full = await getResearchSession(s.id, userId);
        if (full?.reportMarkdown) sections.push(full.reportMarkdown);
        sections.push("");
      }
    }
  }

  if (ticker && opts.includeTimeline !== false) {
    const profile = await getCompanyProfile(ticker, userId);
    if (profile) {
      sections.push(`## 公司画像：${profile.companyName || ticker}\n`);
      if (profile.thesis) sections.push(`**投资主线**：${profile.thesis}\n`);
      if (profile.bull?.length) sections.push(`**看多理由**：\n${profile.bull.map((b: string) => `- ${b}`).join("\n")}\n`);
      if (profile.bear?.length) sections.push(`**风险因素**：\n${profile.bear.map((b: string) => `- ${b}`).join("\n")}\n`);
      if (profile.falsifiers?.length) sections.push(`**证伪条件**：\n${profile.falsifiers.map((f: string) => `- ${f}`).join("\n")}\n`);

      if (profile.events?.length) {
        sections.push(`## 判断变化时间线\n`);
        for (const event of profile.events) {
          sections.push(`- **${event.date || "—"}** · ${event.kind || "记录"}：${event.summary}`);
          if (event.rationale) sections.push(`  - 理由：${event.rationale}`);
          const evidence = Array.isArray(event.evidence) ? event.evidence : [];
          for (const ev of evidence) {
            if ((ev as Record<string, string>)?.url) sections.push(`  - 证据：[${(ev as Record<string, string>).title || (ev as Record<string, string>).url}](${(ev as Record<string, string>).url})`);
          }
        }
        sections.push("");
      }
    }
  }

  if (opts.includeDisclaimer !== false) {
    sections.push(`---\n`);
    sections.push(`**免责声明**：本报告由 AI 辅助生成，所有数据来源已标注。报告中的估值区间、风险判断和证伪条件仅反映截至导出时点的信息，不构成任何投资建议。使用者应独立验证数据并做出自己的投资决策。`);
    sections.push(`\n导出自 Echo Research · ${now.slice(0, 10)}`);
  }

  return sections.join("\n");
}
