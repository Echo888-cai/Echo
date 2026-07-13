/**
 * `npm run cn-coverage` — A 股一手 filing 覆盖率增量扫描，完全对标 hk-coverage.js。
 *
 * seed universe（src/data/cnStocks.js）逐一跑巨潮资讯网搜索 + PDF 下载 + pdfminer
 * 解析，成本不低，一次性全跑没必要——大部分标的研究时的后台补摄取
 * （refreshCnFinancialsInBackground）早晚会覆盖到。这个脚本只做增量：每次跑
 * `--limit`（默认 20）支"还没检查过"的 A 股，结果通过 ingestCnFinancials 内部的
 * 留痕逻辑写进 cn_filing_ingest_log，重复跑几次就能把 seed universe 扫完，
 * 且可随时中断、不重复浪费已检查过的。
 *
 * --rescan 会忽略"已检查过"跳过逻辑，用于想刷新失败原因（比如怀疑巨潮资讯网侧已修复）。
 *
 * 实测：连续 9 支不停顿之后，巨潮资讯网的 hisAnnouncement/query 开始对同一 IP
 * 直接掉连接（fetch 抛 "fetch failed"，不是 HTTP 4xx/5xx，是连接层面被拒）——
 * 免费未文档化接口的典型限流表现。
 * 逐支之间加个固定间隔，礼貌一点，也让扫描本身更稳定。
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { getDb } = await import("../src/db/index.js");
const { ingestCnFinancials } = await import("../apps/worker/src/pipelines/cnFilingsPipeline.js");

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
const rescan = args.includes("--rescan");

const db = getDb();
const pending = db.prepare(`
  SELECT c.ticker, c.name_zh FROM companies c
  WHERE c.ticker LIKE '%.SS' OR c.ticker LIKE '%.SZ'
  ${rescan ? "" : "AND c.ticker NOT IN (SELECT ticker FROM cn_filing_ingest_log)"}
  ORDER BY c.ticker
  LIMIT ?
`).all(limit);

if (!pending.length) {
  console.log("\n没有待检查的 A 股（seed universe 全部已检查过；加 --rescan 重新核对失败原因）。\n");
  process.exit(0);
}

console.log(`\nCN filing coverage sweep — 本次 ${pending.length} 支${rescan ? "（--rescan）" : ""}\n`);

let ok = 0;
let missing = 0;
let first = true;
for (const { ticker, name_zh: nameZh } of pending) {
  if (!first) await sleep(1500); // 巨潮资讯网限流间隔，见上方注释
  first = false;
  try {
    const result = await ingestCnFinancials(ticker, { limit: 2, force: rescan });
    const success = result.ingested.length > 0 || result.skipped.length > 0;
    if (success) ok += 1; else missing += 1;
    console.log(`  ${success ? "✓" : "△"} ${ticker} ${nameZh || ""}${success ? "" : ` — ${result.errors[0] || "无定期报告"}`}`);
  } catch (error) {
    missing += 1;
    console.log(`  ✗ ${ticker} ${nameZh || ""} — ${error.message}`);
  }
}

const withFirstParty = db.prepare(`SELECT COUNT(DISTINCT ticker) n FROM cn_financials`).get().n;
const totalCn = db.prepare(`SELECT COUNT(*) n FROM companies WHERE ticker LIKE '%.SS' OR ticker LIKE '%.SZ'`).get().n;
const checked = db.prepare(`SELECT COUNT(*) n FROM cn_filing_ingest_log`).get().n;
console.log(`\n本次：${ok} 有数据，${missing} 无/失败。`);
console.log(`累计：${checked}/${totalCn} 支已检查，${withFirstParty}/${totalCn} 支有一手数据（详情见设置页数据健康面板）。\n`);
