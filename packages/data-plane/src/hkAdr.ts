import { detectMarket } from "./market.js";
import { adrForHk as domainAdrForHk } from "@echo/domain/company-aliases";

/**
 * HK ticker -> US ADR/ADS symbol that Finnhub can actually serve data for.
 *
 * 底账在 packages/domain/src/companyAliases.js（HK_US_LINKS）——别名、双重上市与
 * ADR 映射的唯一一份，本文件只是 data-plane 侧的薄出口。准入纪律见那边的注释：
 * 每条映射都必须经真实 Finnhub 调用人工核实（错配=自信地给错日期，比"未核到"更糟）。
 *
 * Shared by hkAdrCalendarAdapter and finnhubPeersAdapter: both need "which US
 * symbol stands in for this HK company on Finnhub's free tier".
 */
export function adrForHk(ticker: string): string | null {
  return domainAdrForHk(ticker);
}

/**
 * The symbol to ask Finnhub about: US tickers as-is, HK via its verified ADR,
 * A-shares never (no ADR pipeline, and Finnhub's free tier has no CN coverage
 * at all — proven repeatedly across quotes/financials/calendar).
 */
export function adrOrBareSymbol(ticker: string): string | null {
  const market = detectMarket(ticker);
  if (market === "US") return String(ticker || "").trim().toUpperCase();
  if (market === "HK") return adrForHk(ticker);
  return null;
}
