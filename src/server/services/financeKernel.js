import { surprisePercentDecimal } from "@echo/finance-native";

/**
 * Node 生产侧唯一金融内核入口。跨语言边界只传十进制字符串；Number 只在现有供应商
 * 输入和旧 API 展示边界出现，Rust 返回结果后再做兼容期的展示转换。
 */
export function computeSurprisePctExact(actual, estimate) {
  if (actual == null || estimate == null) return null;
  const value = surprisePercentDecimal(String(actual), String(estimate));
  return value == null ? null : Number(value);
}
