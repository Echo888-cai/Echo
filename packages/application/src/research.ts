import { randomUUID } from "node:crypto";
import { getCompanyByTickerComplete, searchCompanies } from "@echo/db/repositories/companyRepository.js";
import { ensureFreshMarketSnapshot } from "./marketData.js";
import { getCompanyProfile, upsertCompanyProfile } from "@echo/db/repositories/companyProfilesRepository.js";
import { saveResearchSession } from "@echo/db/repositories/researchSessionsRepository.js";
import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import { getCnFinancials } from "@echo/db/repositories/cnFinancialsRepository.js";
import { insertLlmAudit } from "@echo/db/repositories/llmAuditRepository.js";

type ResearchInput = {
  question: string;
  company?: { ticker: string; nameZh?: string };
  kind?: "company" | "screener" | "macro";
  history?: unknown[];
  sessionId?: string;
  conversationId?: string;
  [key: string]: unknown;
};

function providerConfig() {
  if (process.env.DEEPSEEK_API_KEY) return { id: "deepseek", key: process.env.DEEPSEEK_API_KEY, base: "https://api.deepseek.com", model: process.env.DEEPSEEK_MODEL || "deepseek-chat" };
  if (process.env.OPENAI_API_KEY) return { id: "openai", key: process.env.OPENAI_API_KEY, base: "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-5-mini" };
  if (process.env.MODEL_API_KEY && process.env.MODEL_BASE_URL) return { id: "generic", key: process.env.MODEL_API_KEY, base: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME || "default" };
  return null;
}

async function modelAnswer(system: string, user: string, userId: string) {
  const provider = providerConfig();
  if (!provider) return null;
  const started = Date.now();
  try {
    const response = await fetch(`${provider.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${provider.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: provider.model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new Error(`model ${response.status}`);
    const body: any = await response.json();
    const content = String(body.choices?.[0]?.message?.content || "").trim();
    await insertLlmAudit({ provider: provider.id, model: provider.model, kind: "chat", status: "ok", latencyMs: Date.now() - started,
      inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens, userId });
    return content ? { content, provider: provider.id, model: provider.model } : null;
  } catch (error) {
    await insertLlmAudit({ provider: provider.id, model: provider.model, kind: "chat", status: "error", latencyMs: Date.now() - started,
      errorDetail: error instanceof Error ? error.message : String(error), userId });
    return null;
  }
}

function financialSummary(rows: any[]) {
  const row = rows[0];
  if (!row) return "最新完整三表当前未核到，以下判断降低置信度。";
  const values = [
    row.period_label || row.periodEnd,
    row.revenue != null ? `收入 ${row.revenue} ${row.currency || ""}` : null,
    row.net_income != null ? `净利润 ${row.net_income} ${row.currency || ""}` : null,
    row.operating_cash_flow != null ? `经营现金流 ${row.operating_cash_flow} ${row.currency || ""}` : null
  ].filter(Boolean);
  return values.join("；");
}

function deterministicAnswer(company: any, profile: any, market: any, financials: any[], question: string) {
  const name = company?.nameZh || company?.nameEn || company?.ticker || "该公司";
  const price = market?.price != null ? `${market.price} ${company?.currency || ""}` : "当前未核到";
  const thesis = profile?.thesis || company?.summary?.[0] || "需要继续从赚钱机制、竞争壁垒和现金流兑现三条线验证";
  const bull = profile?.bull?.length ? profile.bull : company?.bull || [];
  const bear = profile?.bear?.length ? profile.bear : company?.bear || company?.risks || [];
  const monitors = profile?.monitors?.length ? profile.monitors : company?.monitors || [];
  return [
    `## 核心判断`,
    `${name} 当前更适合按“持续验证”处理：${thesis}。本轮问题是“${question}”；现价口径为 ${price}，价格只表示市场状态，不等于内在价值。`,
    `## 财务质量`,
    financialSummary(financials),
    `## Bull case`,
    ...(bull.length ? bull.slice(0, 5).map((item: string) => `- ${item}`) : ["- 主业增长、利润率与经营现金流若能同步改善，判断才会增强。"]),
    `## 风险与证伪条件`,
    ...(bear.length ? bear.slice(0, 5).map((item: string) => `- ${item}`) : ["- 若增长只靠投入、现金流不兑现或竞争压低利润率，当前逻辑会被削弱。"]),
    `## 关键监控`,
    ...(monitors.length ? monitors.slice(0, 6).map((item: string) => `- ${item}`) : ["- 收入质量、利润率、经营现金流、资本开支与股东回报"]),
    `## 来源`,
    `- PostgreSQL 研究档案与已摄取的一手公告`,
    market?.source ? `- 行情来源：${market.source}（${market.as_of || "时间未标注"}）` : "- 行情：本轮未核到可用快照",
    "",
    "> 仅供研究学习，不构成投资建议。"
  ].join("\n\n");
}

function decisionPanel(company: any, profile: any, market: any) {
  return {
    ticker: company.ticker,
    companyName: company.nameZh || company.nameEn || company.ticker,
    researchStatus: profile?.researchStatus || "watch",
    confidence: profile?.confidence || "中",
    oneLineView: profile?.thesis || company.summary?.[0] || "当前判断需要财务与现金流继续验证",
    price: { value: market?.price ?? "暂不可用", source: market?.source || "未核到", asOf: market?.as_of || null },
    bullCase: profile?.bull || company.bull || [],
    bearCase: profile?.bear || company.bear || company.risks || [],
    monitors: profile?.monitors || company.monitors || [],
    sources: market?.source ? [{ label: market.source, timestamp: market.as_of }] : [],
    missingData: market ? [] : ["实时行情"]
  };
}

async function resolveInputCompany(input: ResearchInput) {
  if (input.company?.ticker) return getCompanyByTickerComplete(input.company.ticker);
  const match = (await searchCompanies(input.question, { limit: 1 }))[0];
  return match ? getCompanyByTickerComplete(match.ticker) : null;
}

export async function runResearch(input: ResearchInput, userId: string) {
  const company = await resolveInputCompany(input);
  if (!company) return {
    mode: "chat_local", provider: null, model: null, sessionId: null, content: "我还没识别出要研究的公司。请补充股票代码或完整公司名称。",
    decisionPanel: null, dataSources: {}, marketSnapshot: null, newsSnapshot: null, valuation: null, portrait: null
  };
  const [profile, market, financials] = await Promise.all([
    getCompanyProfile(company.ticker, userId),
    ensureFreshMarketSnapshot(company.ticker),
    company.ticker.endsWith(".HK") ? getHkFinancials(company.ticker) : /\.(SS|SZ)$/.test(company.ticker) ? getCnFinancials(company.ticker) : Promise.resolve([])
  ]);
  const fallback = deterministicAnswer(company, profile, market, financials, input.question);
  const facts = `公司：${company.nameZh}（${company.ticker}）\n现价：${market?.price ?? "未核到"}\n财务：${financialSummary(financials)}\n既有主线：${profile?.thesis || company.summary?.join("；") || "未沉淀"}`;
  const generated = await modelAnswer(
    "你是审慎的买方研究员。只使用给出的事实，不编数字；取不到就写未核到；不给买卖指令。输出中文 Markdown，包含核心判断、赚钱机制、财务质量、估值与赔率、风险证伪、下一步、来源。",
    `${facts}\n\n用户问题：${input.question}`,
    userId
  );
  const panel = decisionPanel(company, profile, market);
  const id = input.sessionId || `s_${randomUUID()}`;
  const content = generated?.content || fallback;
  await saveResearchSession({ id, ticker: company.ticker, companyName: company.nameZh, title: input.question, question: input.question,
    conversationId: input.conversationId || id, status: "completed", decisionPanel: panel, fullResearch: content,
    reportMarkdown: content, dataSources: { market: market ? { status: "ok", source: market.source, asOf: market.as_of } : { status: "missing" }, financials: financials.length ? { status: "ok" } : { status: "missing" } },
    thread: input.history }, userId);
  const savedProfile = await upsertCompanyProfile(company.ticker, {
    companyName: company.nameZh, thesis: panel.oneLineView, researchStatus: panel.researchStatus, confidence: panel.confidence,
    bull: panel.bullCase, bear: panel.bearCase, monitors: panel.monitors, bumpTurn: true
  }, userId);
  return {
    mode: generated ? "chat_model" : "chat_local",
    provider: generated?.provider || null,
    model: generated?.model || null,
    sessionId: id,
    content,
    decisionPanel: panel,
    dataSources: { market: market ? { status: "ok", source: market.source, asOf: market.as_of } : { status: "missing" }, financials: financials.length ? { status: "ok" } : { status: "missing" } },
    marketSnapshot: market,
    newsSnapshot: null,
    valuation: savedProfile?.valuation || null,
    portrait: { ticker: company.ticker, created: !profile, changed: !profile || profile.thesis !== panel.oneLineView, turnCount: savedProfile?.turnCount || 0 }
  };
}

export async function runAsk(input: ResearchInput, userId: string) {
  if (!input.company?.ticker && (input.kind === "macro" || input.kind === "screener")) {
    if (input.kind === "screener") {
      const rows = await searchCompanies(input.question, { limit: 30 });
      return { kind: "screener", filters: { query: input.question }, rows, notes: rows.length ? [] : ["当前筛选条件未匹配到公司。"] };
    }
    return { kind: "macro", content: "宏观研究需要可核验的当期数据。本轮没有绑定授权宏观数据源，因此不编造指数和结论。", mode: "local_fallback", indices: [], evidence: [], gaps: ["当期宏观数据"] };
  }
  return runResearch(input, userId);
}

export async function runReport(input: ResearchInput, userId: string) {
  const result: any = await runResearch(input, userId);
  return {
    mode: result.mode === "chat_model" ? "report_model" : "report_local",
    provider: result.provider,
    model: result.model,
    sessionId: result.sessionId,
    decisionPanel: result.decisionPanel,
    markdown: result.content,
    dataSources: result.dataSources,
    marketSnapshot: result.marketSnapshot,
    newsSnapshot: result.newsSnapshot,
    factGuard: null,
    portrait: result.portrait
  };
}
