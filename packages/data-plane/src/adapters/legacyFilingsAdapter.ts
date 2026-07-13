/**
 * Wraps src/filingData.js's getRecentFilings() — routes by market to SEC
 * EDGAR (US), CNINFO 巨潮资讯网 (CN), or HKEX 披露易 (HK). Unlike the quote/
 * fundamentals composites, each market has exactly one source here (no
 * fallback chain to race/tier), so this adapter is really three adapters
 * wearing one id — that's fine for the router (it only ever asks "does this
 * adapter support market X", never "how many sub-sources does it use").
 */
import { getRecentFilings } from "../../../../src/filingData.js";
import type { Market } from "../market.js";
import type { FilingsPort, ProviderEnvelope } from "../ports.js";
import type { AdapterAuthorization } from "../authorization.js";

// SEC EDGAR and the two exchanges' own disclosure sites are public regulatory
// filing databases, not commercial data vendors — no license to negotiate,
// but also not "first_party" (Echo doesn't own the data, just reads the
// exchange's own public disclosure feed). Treated as free-tier: usable for
// research, not a substitute for a licensed commercial distributor if one is
// contracted later for redistribution/SLA reasons.
const authorization: AdapterAuthorization = {
  licenseTier: "unlicensed_free_tier",
  commercialUseAllowed: false,
  notes: "SEC EDGAR (US) / CNINFO 巨潮资讯网 (CN) / HKEX 披露易 (HK) — public regulatory disclosure sites, one per market, no fallback chain."
};

export const legacyFilingsAdapter: FilingsPort = {
  id: "legacy-regulatory-disclosure",
  authorization,
  qualityRank: 1,
  supports(_market: Market): boolean {
    return true;
  },
  async fetchFilings(ticker: string): Promise<ProviderEnvelope> {
    return (await getRecentFilings(ticker)) as ProviderEnvelope;
  }
};
