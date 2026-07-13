/** Incrementally scan first-party filing coverage for one market. */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const market = args.find((arg) => arg.startsWith("--market="))?.split("=")[1]?.toLowerCase();
const limit = Number(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 20);
const rescan = args.includes("--rescan");

const markets = {
  hk: {
    label: "港股",
    condition: "c.ticker LIKE '%.HK'",
    logTable: "hk_filing_ingest_log",
    factsTable: "hk_financials",
    pipeline: "../apps/worker/src/pipelines/hkFilingsPipeline.js",
    ingest: "ingestHkFinancials",
    delayMs: 0,
    missing: "无业绩公告"
  },
  cn: {
    label: "A 股",
    condition: "(c.ticker LIKE '%.SS' OR c.ticker LIKE '%.SZ')",
    logTable: "cn_filing_ingest_log",
    factsTable: "cn_financials",
    pipeline: "../apps/worker/src/pipelines/cnFilingsPipeline.js",
    ingest: "ingestCnFinancials",
    delayMs: 1500,
    missing: "无定期报告"
  }
};

const config = markets[market];
if (!config || !Number.isInteger(limit) || limit <= 0) {
  console.error("用法：node scripts/coverage.js --market=hk|cn [--limit=20] [--rescan]");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { getDb } = await import("../src/db/index.js");
const pipeline = await import(config.pipeline);
const ingest = pipeline[config.ingest];
const db = getDb();
const pending = db.prepare(`
  SELECT c.ticker, c.name_zh FROM companies c
  WHERE ${config.condition}
  ${rescan ? "" : `AND c.ticker NOT IN (SELECT ticker FROM ${config.logTable})`}
  ORDER BY c.ticker
  LIMIT ?
`).all(limit);

if (!pending.length) {
  console.log(`\n没有待检查的${config.label}（全部已检查过；加 --rescan 重新核对失败原因）。\n`);
  process.exit(0);
}

console.log(`\n${market.toUpperCase()} filing coverage sweep — 本次 ${pending.length} 支${rescan ? "（--rescan）" : ""}\n`);

let ok = 0;
let missing = 0;
for (let index = 0; index < pending.length; index += 1) {
  if (index > 0 && config.delayMs) await sleep(config.delayMs);
  const { ticker, name_zh: nameZh } = pending[index];
  try {
    const result = await ingest(ticker, { limit: 2, force: rescan });
    const success = result.ingested.length > 0 || result.skipped.length > 0;
    if (success) ok += 1;
    else missing += 1;
    console.log(`  ${success ? "✓" : "△"} ${ticker} ${nameZh || ""}${success ? "" : ` — ${result.errors[0] || config.missing}`}`);
  } catch (error) {
    missing += 1;
    console.log(`  ✗ ${ticker} ${nameZh || ""} — ${error.message}`);
  }
}

const withFirstParty = db.prepare(`SELECT COUNT(DISTINCT ticker) n FROM ${config.factsTable}`).get().n;
const total = db.prepare(`SELECT COUNT(*) n FROM companies c WHERE ${config.condition}`).get().n;
const checked = db.prepare(`SELECT COUNT(*) n FROM ${config.logTable}`).get().n;
console.log(`\n本次：${ok} 有数据，${missing} 无/失败。`);
console.log(`累计：${checked}/${total} 支已检查，${withFirstParty}/${total} 支有一手数据（详情见设置页数据健康面板）。\n`);
