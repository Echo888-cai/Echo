export interface CompanyAlias {
  pattern: RegExp;
  ticker: string;
}

export interface UsCompanyAlias extends CompanyAlias {
  name: string;
}

export type HkUsLinkKind = "dual_primary" | "adr_otc";

export interface HkUsLink {
  nameZh: string;
  hk: string;
  /** 可交易的美股代码；adr_otc 条目为 null（美股侧只是 OTC 替身）。 */
  us: string | null;
  /** Finnhub 可查询的美股符号（dual_primary 时与 us 相同）。 */
  adr: string;
  kind: HkUsLinkKind;
  /** 中英文名点名匹配（dualListingByName 用）；显式代码命中不经过它。 */
  pattern?: RegExp;
}

export declare const HK_COMPANY_ALIASES: CompanyAlias[];
export declare const US_COMPANY_ALIASES: UsCompanyAlias[];
export declare const HK_US_LINKS: HkUsLink[];

export declare function dualListings(): HkUsLink[];
export declare function dualListingByTicker(ticker: string): HkUsLink | null;
export declare function dualListingByName(text?: string): HkUsLink | null;
export declare function adrForHk(ticker: string): string | null;
