// Provenance and data-source metadata for structured answers.
// dataSourceGrounding — pure data-shaping helpers that turn a decisionPanel
// into the evidence-card/grounding-bar props AnswerCard renders. Split out
// from AnswerCard.tsx because researchActions.ts (answerMetaFromResult) also
// needs them, and that file has no JSX.
import { hostFromUrl } from "./format";

const TYPE_CRED_DEFAULT: Record<string, number> = {
  official: 0.9,
  industry_research: 0.82,
  financial_media: 0.72,
  cn_financial_media: 0.6,
  market: 0.7,
  news: 0.55,
  web: 0.45
};

export interface EvidenceItem {
  title: string;
  url: string;
  source: string;
  type: string;
  cred: number | null;
  date: string;
}

/** Builds clickable provenance cards from the decision panel's sources (official + web). */
export function provenanceFromPanel(panel: any): EvidenceItem[] {
  const sources: any[] = Array.isArray(panel?.sources) ? panel.sources : [];
  return sources
    .filter((s) => s.url)
    .slice(0, 6)
    .map((s) => ({
      title: s.label || hostFromUrl(s.url) || "来源",
      url: s.url,
      source: hostFromUrl(s.url) || s.type || "web",
      type: s.type || (s.origin === "web_evidence" ? "web" : "official"),
      cred: typeof s.credibility === "number" ? s.credibility : TYPE_CRED_DEFAULT[s.type] ?? null,
      date: s.timestamp || ""
    }));
}

export function dataSourceLabels(dataSources: Record<string, any> = {}): string[] {
  const map: Record<string, string> = { market: "行情", financials: "财报", filings: "公告", news: "新闻", estimates: "预期" };
  return Object.entries(map)
    .filter(([key]) => dataSources?.[key]?.status === "ok")
    .map(([, label]) => label);
}

// Per-slot check/cross for the grounding bar: 4 fixed core slots
// (market/financials/news/estimates); filings only appended when present, so
// US-market answers (which never have filings) don't show a permanent ✗ noise.
export function dataSourceGrounding(dataSources: Record<string, any> = {}): { label: string; ok: boolean }[] {
  const core: [string, string][] = [
    ["market", "行情"],
    ["financials", "财报"],
    ["news", "新闻"],
    ["estimates", "预期"]
  ];
  const slots = core.map(([key, label]) => ({ label, ok: dataSources?.[key]?.status === "ok" }));
  if (dataSources?.filings?.status === "ok") slots.push({ label: "公告", ok: true });
  return slots;
}
