import { and, asc, desc, eq } from "drizzle-orm";
import { companies } from "../schema/core.js";
import { companyProfiles, profileEvents } from "../schema/research.js";
import { normalizeTicker, numberOrNull, numeric, withTenant } from "./context.js";

export const PROFILE_EVENT_KIND_LABEL: Record<string, string> = {
  created: "建档",
  thesis_change: "判断变化",
  falsifier_change: "证伪线更新",
  earnings_report: "财报公布",
  note: "记录"
};

function valuation(row: typeof companyProfiles.$inferSelect) {
  if (row.valuationMethod == null && row.valuationBear == null && row.valuationBase == null
    && row.valuationBull == null && row.valuationCurrentPrice == null) return null;
  return {
    method: row.valuationMethod,
    bear: numberOrNull(row.valuationBear),
    base: numberOrNull(row.valuationBase),
    bull: numberOrNull(row.valuationBull),
    currentPrice: numberOrNull(row.valuationCurrentPrice)
  };
}

function eventView(row: typeof profileEvents.$inferSelect) {
  return {
    date: row.date,
    kind: row.kind,
    summary: row.summary,
    rationale: row.rationale || "",
    evidence: Array.isArray(row.evidenceJson) ? row.evidenceJson : [],
    sessionId: row.sessionId || null
  };
}

async function listEventsTx(tx: any, ticker: string, limit: number, userId: string) {
  const rows = await tx.select().from(profileEvents)
    .where(and(eq(profileEvents.userId, userId), eq(profileEvents.ticker, ticker)))
    .orderBy(desc(profileEvents.id)).limit(limit);
  return rows.reverse().map(eventView);
}

async function hydrate(tx: any, row: typeof companyProfiles.$inferSelect | undefined, userId: string) {
  if (!row) return null;
  return {
    ticker: row.ticker,
    companyName: row.companyName || row.ticker,
    thesis: row.thesis || "",
    researchStatus: row.researchStatus || "",
    confidence: row.confidence || "",
    bull: row.bull || [],
    bear: row.bear || [],
    monitors: row.monitors || [],
    falsifiers: row.falsifiers || [],
    valuation: valuation(row),
    events: await listEventsTx(tx, row.ticker, 200, userId),
    profileMd: row.profileMd || "",
    turnCount: row.turnCount || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function appendEventTx(tx: any, ticker: string, event: any, userId: string) {
  if (!event?.summary) return;
  await tx.insert(profileEvents).values({
    userId,
    ticker,
    date: event.date || "",
    kind: event.kind || "note",
    summary: String(event.summary).slice(0, 300),
    rationale: event.rationale ? String(event.rationale).slice(0, 600) : null,
    evidenceJson: Array.isArray(event.evidence) && event.evidence.length ? event.evidence.slice(0, 4) : null,
    sessionId: event.sessionId || null
  });
}

export async function appendProfileEvent(ticker: string, event: any = {}, userId = "local") {
  const normalized = normalizeTicker(ticker);
  await withTenant(userId, (tx) => appendEventTx(tx, normalized, event, userId));
}

export async function listProfileEvents(ticker: string, limit = 200, userId = "local") {
  const normalized = normalizeTicker(ticker);
  return withTenant(userId, (tx) => listEventsTx(tx, normalized, limit, userId));
}

export async function getCompanyProfile(ticker: string, userId = "local") {
  const normalized = normalizeTicker(ticker);
  return withTenant(userId, async (tx) => hydrate(tx, (await tx.select().from(companyProfiles)
    .where(and(eq(companyProfiles.userId, userId), eq(companyProfiles.ticker, normalized))).limit(1))[0], userId));
}

export async function listCompanyProfiles(limit = 50, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.select().from(companyProfiles)
    .where(eq(companyProfiles.userId, userId)).orderBy(desc(companyProfiles.updatedAt), asc(companyProfiles.ticker)).limit(limit))
    .map((row) => ({
      ticker: row.ticker,
      companyName: row.companyName || row.ticker,
      thesis: row.thesis || "",
      researchStatus: row.researchStatus || "",
      confidence: row.confidence || "",
      turnCount: row.turnCount || 0,
      updatedAt: row.updatedAt.toISOString()
    })));
}

export async function upsertCompanyProfile(ticker: string, patch: any = {}, userId = "local") {
  const normalized = normalizeTicker(ticker);
  return withTenant(userId, async (tx) => {
    const isUs = !normalized.endsWith(".HK") && !/\.(SS|SZ)$/.test(normalized);
    await tx.insert(companies).values({
      ticker: normalized,
      nameZh: patch.companyName || normalized,
      nameEn: isUs ? patch.companyName || normalized : null,
      exchange: isUs ? "US" : normalized.endsWith(".HK") ? "HKEX" : "CN",
      currency: isUs ? "USD" : normalized.endsWith(".HK") ? "HKD" : "CNY"
    }).onConflictDoNothing();
    const [currentRow] = await tx.select().from(companyProfiles)
      .where(and(eq(companyProfiles.userId, userId), eq(companyProfiles.ticker, normalized))).limit(1);
    const existing = await hydrate(tx, currentRow, userId);
    const newEvents = [...(Array.isArray(patch.events) ? patch.events : []), ...(patch.event ? [patch.event] : [])];
    for (const event of newEvents) await appendEventTx(tx, normalized, event, userId);
    const events = await listEventsTx(tx, normalized, 200, userId);
    const merged = {
      companyName: patch.companyName || existing?.companyName || normalized,
      thesis: patch.thesis ?? existing?.thesis ?? "",
      researchStatus: patch.researchStatus ?? existing?.researchStatus ?? "",
      confidence: patch.confidence ?? existing?.confidence ?? "",
      bull: patch.bull ?? existing?.bull ?? [],
      bear: patch.bear ?? existing?.bear ?? [],
      monitors: patch.monitors ?? existing?.monitors ?? [],
      falsifiers: patch.falsifiers ?? existing?.falsifiers ?? [],
      valuation: patch.valuation ?? existing?.valuation ?? null,
      turnCount: (existing?.turnCount || 0) + (patch.bumpTurn ? 1 : 0)
    };
    const profileMd = patch.profileMd || renderProfileMarkdown(normalized, merged, events);
    const values = {
      userId,
      ticker: normalized,
      companyName: merged.companyName,
      thesis: merged.thesis,
      researchStatus: merged.researchStatus,
      confidence: merged.confidence,
      bull: merged.bull,
      bear: merged.bear,
      monitors: merged.monitors,
      falsifiers: merged.falsifiers,
      valuationMethod: merged.valuation?.method ?? null,
      valuationBear: numeric(merged.valuation?.bear),
      valuationBase: numeric(merged.valuation?.base),
      valuationBull: numeric(merged.valuation?.bull),
      valuationCurrentPrice: numeric(merged.valuation?.currentPrice),
      profileMd,
      turnCount: merged.turnCount,
      updatedAt: new Date()
    };
    const [saved] = await tx.insert(companyProfiles).values(values).onConflictDoUpdate({
      target: [companyProfiles.userId, companyProfiles.ticker],
      set: { ...values, userId: undefined, ticker: undefined }
    }).returning();
    return hydrate(tx, saved, userId);
  });
}

export async function deleteCompanyProfile(ticker: string, userId = "local") {
  const normalized = normalizeTicker(ticker);
  return withTenant(userId, async (tx) => {
    await tx.delete(profileEvents).where(and(eq(profileEvents.userId, userId), eq(profileEvents.ticker, normalized)));
    return (await tx.delete(companyProfiles).where(and(eq(companyProfiles.userId, userId), eq(companyProfiles.ticker, normalized)))
      .returning({ ticker: companyProfiles.ticker })).length > 0;
  });
}

export function renderProfileMarkdown(ticker: string, view: any = {}, events: any[] = []) {
  const lines = ["---", `ticker: ${ticker}`, "---", "", `# ${view.companyName || ticker}（${ticker}）`, "", "## 投资主线", view.thesis || "（待沉淀）", ""];
  if (view.researchStatus || view.confidence) lines.push(`研究状态：${view.researchStatus || "—"} · 置信度：${view.confidence || "—"}`, "");
  const metrics: string[] = [];
  const value = view.valuation;
  if (value && (value.base != null || value.bear != null || value.bull != null)) {
    const band = [`悲观 ${value.bear ?? "—"}`, `中性 ${value.base ?? "—"}`, `乐观 ${value.bull ?? "—"}`].join(" / ");
    metrics.push(`- 估值带（${value.method || "—"}）：${band}${value.currentPrice != null ? `（现价 ${value.currentPrice}）` : ""}`);
  }
  if (Array.isArray(view.monitors) && view.monitors.length) metrics.push(`- 关键观察变量：${view.monitors.join("、")}`);
  if (metrics.length) lines.push("## 关键指标", ...metrics, "");
  if (Array.isArray(view.bull) && view.bull.length) lines.push("## Bull case", ...view.bull.map((item: string) => `- ${item}`), "");
  if (Array.isArray(view.bear) && view.bear.length) lines.push("## 风险台账（Bear case）", ...view.bear.map((item: string) => `- ${item}`), "");
  if (Array.isArray(view.falsifiers) && view.falsifiers.length) lines.push("## 证伪条件（当前生效）", ...view.falsifiers.map((item: string) => `- ${item}`), "");
  if (events.length) {
    lines.push("## 判断变化时间线");
    for (const event of events.slice(-20).reverse()) {
      lines.push("", `### ${event.date || "—"} · ${PROFILE_EVENT_KIND_LABEL[event.kind] || event.kind || "记录"}`, event.summary || "");
      if (event.rationale) lines.push(`- 理由：${event.rationale}`);
      for (const evidence of Array.isArray(event.evidence) ? event.evidence : []) {
        if (evidence?.url) lines.push(`- 证据：[${evidence.title || evidence.url}](${evidence.url})`);
      }
    }
    lines.push("");
  }
  lines.push("---", "> 由 Echo Research 生成的长期研究画像，仅供研究学习，不构成投资建议。");
  return lines.join("\n");
}
