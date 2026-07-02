/**
 * 一次性回填：把既有公司画像里的证伪条件（falsifiers）解析成 watch_rules 监控规则。
 * 新研究会在画像更新时自动同步（companyPortrait.js），这个脚本只服务存量画像。
 * 用法：node scripts/backfill-watch-rules.js
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { listCompanyProfiles, getCompanyProfile } = await import("../src/server/repositories/companyProfiles.js");
const { parseFalsifierRules } = await import("../src/server/services/falsifyRules.js");
const { replaceFalsifierRules, listRules } = await import("../src/server/repositories/watchRules.js");

let total = 0;
for (const p of listCompanyProfiles(100)) {
  const profile = getCompanyProfile(p.ticker);
  const falsifiers = Array.isArray(profile?.falsifiers) ? profile.falsifiers : [];
  if (!falsifiers.length) continue;
  const rules = parseFalsifierRules(falsifiers);
  replaceFalsifierRules(p.ticker, rules);
  total += rules.length;
  console.log(`${p.ticker}（${profile.companyName}）：${falsifiers.length} 条证伪条件 → ${rules.length} 条价格监控规则${rules.length ? "：" + rules.map((r) => `${r.kind === "price_below" ? "跌破" : "涨破"}${r.threshold}`).join("、") : ""}`);
}
console.log(`\n完成：共 ${total} 条监控规则。验证：任选 ticker 查 listRules —— 例如 ${listCompanyProfiles(1)[0]?.ticker || "(无画像)"} 有 ${listRules(listCompanyProfiles(1)[0]?.ticker || "").length} 条。`);
