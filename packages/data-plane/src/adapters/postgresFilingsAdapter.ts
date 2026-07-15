import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import type { Market } from "../market.js";
import type { FilingsPort } from "../ports.js";

export const postgresFilingsAdapter: FilingsPort = {
  id: "postgres-first-party-filings",
  authorization: { licenseTier: "first_party", commercialUseAllowed: true, notes: "Only official filing URLs ingested by Echo workflows." },
  qualityRank: 1,
  supports(market: Market) { return market === "HK"; },
  async fetchFilings(ticker: string) {
    const rows = await getHkFinancials(ticker, 20);
    return { providerStatus: rows.length ? "ok" as const : "missing" as const, source: "HKEX",
      filings: rows.map((row: any) => ({ title: row.source_title, url: row.source_url, publishedAt: row.published_at, period: row.period_label })) };
  }
};
