export function extractHkTicker(text?: string): string;
export function extractUsTickerToken(text?: string, additionalStopwords?: Iterable<string>): string;
/** 实体抽取前的输入归一化（全角→半角、去零宽字符）。所有抽取入口都必须先过它。 */
export function normalizeQuestionText(text?: string): string;
/** 不能当美股代码看的常见缩写——唯一一份，前端不要再抄副本。 */
export function commonNonTickers(): Set<string>;
