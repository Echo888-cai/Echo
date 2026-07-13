/**
 * `npm run hk-coverage` — 港股一手 filing 覆盖率增量扫描（G-1/E3）。
 *
 * 654 支港股逐一跑 HKEX 搜索 + PDF 下载 + pdfminer 解析成本不低，一次性全跑会打爆
 * HKEX 也没必要——大部分标的研究时的后台补摄取（refreshHkFinancialsInBackground）
 * 早晚会覆盖到。这个脚本只做增量：每次跑 `--limit`（默认 20）支"还没检查过"的港股，
 * 结果通过 ingestHkFinancials 内部的留痕逻辑写进 hk_filing_ingest_log，重复跑
 * 几次就能把 654 支扫完，且可随时中断、不重复浪费已检查过的。
 *
 * --rescan 会忽略"已检查过"跳过逻辑，用于想刷新失败原因（比如怀疑 HKEX 侧已修复）。
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { getDb } = await import("../src/db/index.js");
const { ingestHkFinancials } = await import("../apps/worker/src/pipelines/hkFilingsPipeline.js");

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
const rescan = args.includes("--rescan");

const db = getDb();
const pending = db.prepare(`
  SELECT c.ticker, c.name_zh FROM companies c
  WHERE c.ticker LIKE '%.HK'
  ${rescan ? "" : "AND c.ticker NOT IN (SELECT ticker FROM hk_filing_ingest_log)"}
  ORDER BY c.ticker
  LIMIT ?
`).all(limit);

if (!pending.length) {
  console.log("\n没有待检查的港股（全部已检查过；加 --rescan 重新核对失败原因）。\n");
  process.exit(0);
}

console.log(`\nHK filing coverage sweep — 本次 ${pending.length} 支${rescan ? "（--rescan）" : ""}\n`);

let ok = 0;
let missing = 0;
for (const { ticker, name_zh: nameZh } of pending) {
  try {
    const result = await ingestHkFinancials(ticker, { limit: 2, force: rescan });
    const success = result.ingested.length > 0 || result.skipped.length > 0;
    if (success) ok += 1; else missing += 1;
    console.log(`  ${success ? "✓" : "△"} ${ticker} ${nameZh || ""}${success ? "" : ` — ${result.errors[0] || "无业绩公告"}`}`);
  } catch (error) {
    missing += 1;
    console.log(`  ✗ ${ticker} ${nameZh || ""} — ${error.message}`);
  }
}

const withFirstParty = db.prepare(`SELECT COUNT(DISTINCT ticker) n FROM hk_financials`).get().n;
const totalHk = db.prepare(`SELECT COUNT(*) n FROM companies WHERE ticker LIKE '%.HK'`).get().n;
const checked = db.prepare(`SELECT COUNT(*) n FROM hk_filing_ingest_log`).get().n;
console.log(`\n本次：${ok} 有数据，${missing} 无/失败。`);
console.log(`累计：${checked}/${totalHk} 支已检查，${withFirstParty}/${totalHk} 支有一手数据（详情见设置页数据健康面板）。\n`);
