/**
 * 一次性精准清库：R12（M-3）——把"数据碎片"从画像 thesis 字段里清出去。
 *
 * 背景：真实审计发现 6 只关注股里 5 只的"投资主线"存的是"收入增速 -1.10%，毛利率
 * 55.71%"这类数据碎片，不是一句判断——根因是旧版 distillView 把 keyDrivers 里
 * "基本面"驱动因素的数据摘要当 oneLineView 的回落值。生成侧已修复（companyPortrait.js
 * 的 distillView 不再走这条回落路径，并加了 isDataFragmentThesis 防御性过滤器）；
 * 本脚本只清历史存量：thesis 命中碎片特征的置空，等下一轮研究自然写入真实主线
 * （不硬迁/不编造）。幂等，可重复运行。用法：npm run clean:thesis-fragments
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { listCompanyProfiles, upsertCompanyProfile } = await import("../src/server/repositories/companyProfiles.js");
const { isDataFragmentThesis } = await import("../src/server/services/companyPortrait.js");

let scanned = 0;
let cleaned = 0;
for (const brief of listCompanyProfiles(1000)) {
  scanned += 1;
  if (!isDataFragmentThesis(brief.thesis)) continue;
  console.log(`[clean-thesis-fragments] ${brief.ticker} 置空：「${brief.thesis}」`);
  upsertCompanyProfile(brief.ticker, { thesis: "" });
  cleaned += 1;
}
console.log(`[clean-thesis-fragments] 扫描 ${scanned} 家画像，清洗 ${cleaned} 家。`);

const left = listCompanyProfiles(1000).filter((p) => isDataFragmentThesis(p.thesis));
console.log(`[clean-thesis-fragments] 残留命中：${left.length}（应为 0）`);
