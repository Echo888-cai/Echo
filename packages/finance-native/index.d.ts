export declare function equityValueFromMultipleDecimal(metric: string, multiple: string, netCash: string, currencyCode: string): NativeMoney

export declare function multiplyDecimal(value: string, factor: string, currencyCode: string): NativeMoney

export interface NativeMoney {
  amount: string
  currency: string
}

export declare function perShareDecimal(equityValue: string, dilutedShares: string, decimalPlaces: number, currencyCode: string): NativeMoney

export declare function ratioDecimal(numerator: string, denominator: string, currencyCode: string): string | null

export declare function subtractDecimal(a: string, b: string, currencyCode: string): NativeMoney

export declare function surprisePercentDecimal(actual: string, estimate: string): string | null
