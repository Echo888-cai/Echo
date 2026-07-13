export declare function equityValueFromMultipleDecimal(metric: string, multiple: string, netCash: string, currencyCode: string): NativeMoney

export interface NativeMoney {
  amount: string
  currency: string
}

export declare function perShareDecimal(equityValue: string, dilutedShares: string, decimalPlaces: number, currencyCode: string): NativeMoney

export declare function surprisePercentDecimal(actual: string, estimate: string): string | null
