import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import type { Market } from "../market.js";
import type { FundamentalsPort } from "../ports.js";

export const postgresFundamentalsAdapter: FundamentalsPort = {
  id: "postgres-first-party-financials",
  authorization: { licenseTier: "first_party", commercialUseAllowed: true, notes: "Structured from HKEX first-party filing pipeline." },
  qualityRank: 1,
  supports(market: Market) { return market === "HK"; },
  async fetchFundamentals(ticker: string) {
    const rows = await getHkFinancials(ticker);
    return { providerStatus: rows.length ? "ok" as const : "missing" as const, source: "HKEX", rows };
  }
};
