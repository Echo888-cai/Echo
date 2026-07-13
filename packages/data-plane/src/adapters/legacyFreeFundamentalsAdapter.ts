/**
 * Wraps src/financialData.js's getFinancials() — same "thin pass-through, not
 * a reimplementation" reasoning as legacyFreeQuoteAdapter.ts. FMP (multi-key
 * pooled) primary, Finnhub/Yahoo/Tencent secondary; see fmpClient.js for the
 * key-rotation/cooldown logic this adapter inherits by delegation.
 */
import { getFinancials } from "../../../../src/financialData.js";
import type { Market } from "../market.js";
import type { FundamentalsPort, ProviderEnvelope } from "../ports.js";
import type { AdapterAuthorization } from "../authorization.js";

const authorization: AdapterAuthorization = {
  licenseTier: "unlicensed_free_tier",
  commercialUseAllowed: false,
  notes: "FMP free-tier (multi-key pooled) primary, Finnhub/Yahoo/Tencent secondary (src/financialData.js). No commercial-use agreement."
};

export const legacyFreeFundamentalsAdapter: FundamentalsPort = {
  id: "legacy-free-tier",
  authorization,
  qualityRank: 1,
  supports(_market: Market): boolean {
    return true;
  },
  async fetchFundamentals(ticker: string): Promise<ProviderEnvelope> {
    return (await getFinancials(ticker)) as ProviderEnvelope;
  }
};
