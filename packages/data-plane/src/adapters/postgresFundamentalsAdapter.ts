import { getCnFinancials } from "@echo/db/repositories/cnFinancialsRepository.js";
import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import type { Market } from "../market.js";
import type { FundamentalsPort } from "../ports.js";

export const postgresFundamentalsAdapter: FundamentalsPort = {
  id: "postgres-first-party-financials",
  authorization: { licenseTier: "first_party", commercialUseAllowed: true, notes: "Structured from CNINFO/HKEX first-party filing pipelines." },
  qualityRank: 1,
  supports(market: Market) { return market === "HK" || market === "CN"; },
  async fetchFundamentals(ticker: string) {
    const rows = ticker.endsWith(".HK") ? await getHkFinancials(ticker) : await getCnFinancials(ticker);
    return { providerStatus: rows.length ? "ok" as const : "missing" as const, source: ticker.endsWith(".HK") ? "HKEX" : "CNINFO", rows };
  }
};
