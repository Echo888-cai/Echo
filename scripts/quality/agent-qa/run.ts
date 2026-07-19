/**
 * 智能分析回归跑批——静态路由层 + 可选 live 全链路。
 *
 *   npx tsx scripts/quality/agent-qa/run.ts            静态层（秒级，无外部依赖）
 *   npx tsx scripts/quality/agent-qa/run.ts --live     追加真实 /api/ask 抽样（要 API + DB + 模型密钥）
 *   npx tsx scripts/quality/agent-qa/run.ts --json out.json
 *
 * 静态层跑的是真实的生产函数（domain 的意图分类与代码抽取、web 的解析路由），
 * 不是它们的副本——副本会在源函数改了之后继续绿着骗人。
 *
 * 退出码：0 = 全绿；1 = 有用例失败。失败即"期望与实现有分歧"，需要人裁决是哪边错，
 * 不要靠改期望来消警报。
 */
import { classifyResearchIntent, extractHkTicker, extractUsTickerToken } from "@echo/domain";
import {
  discoveryKindOf,
  isComparisonQuestion,
  isMultiHoldingQuestion,
  mentionsNewCompanyStrong,
  extractAliasTicker,
  resolveUsTicker
} from "../../../apps/web/src/lib/resolve.ts";
import { CORPUS, type Case } from "./corpus.ts";

type Failure = { id: string; scenario: string; q: string; field: string; expected: unknown; actual: unknown; why?: string };

const US_STOPWORDS = new Set([
  "PE", "PB", "PS", "ROE", "ROI", "ROA", "ROC", "AI", "IPO", "GDP", "CEO",
  "CFO", "COO", "CTO", "CMO", "US", "HK", "EPS", "FCF", "DCF", "ETF",
  "Q1", "Q2", "Q3", "Q4", "YOY", "QOQ", "MOM", "TTM", "LTM", "MRQ",
  "CPI", "PPI", "PMI", "GNP", "EV", "NAV", "AUM", "BPS", "DPS", "NIM",
  "NYSE", "SEC", "SFC", "MSCI", "FTSE", "SPX", "SPY", "ESG", "SPAC"
]);

/** 港股代码：别名表命中优先于裸数字抽取——用户写"腾讯"时不该要求他也写代码。 */
function hkTickerOf(q: string): string {
  const alias = extractAliasTicker(q);
  if (alias.endsWith(".HK")) return alias;
  return extractHkTicker(q);
}

/** 美股代码：走前端真实用的那条（别名表 → 裸 token），而不是只调 domain 的底层函数。 */
function usTickerOf(q: string): string {
  return resolveUsTicker(q)?.ticker || "";
}

function runStatic(): { failures: Failure[]; checks: number } {
  const failures: Failure[] = [];
  let checks = 0;

  const check = (c: Case, field: string, expected: unknown, actual: unknown) => {
    checks += 1;
    if (expected === actual) return;
    failures.push({ id: c.id, scenario: c.scenario, q: c.q, field, expected, actual, why: c.why });
  };

  for (const c of CORPUS) {
    const e = c.expect;
    // 每个断言单独 try：一条用例把某个函数跑崩了，不能让整批停摆——崩溃本身就是发现。
    const guard = <T>(field: string, fn: () => T, expected: T) => {
      if (expected === undefined) return;
      try {
        check(c, field, expected, fn());
      } catch (error) {
        checks += 1;
        failures.push({ id: c.id, scenario: c.scenario, q: c.q, field,
          expected, actual: `THREW: ${error instanceof Error ? error.message : String(error)}`, why: c.why });
      }
    };
    guard("intent", () => classifyResearchIntent(c.q), e.intent);
    guard("hk", () => hkTickerOf(c.q), e.hk);
    guard("us", () => usTickerOf(c.q), e.us);
    guard("discovery", () => discoveryKindOf(c.q), e.discovery);
    guard("multiHolding", () => isMultiHoldingQuestion(c.q), e.multiHolding);
    guard("strongCompany", () => mentionsNewCompanyStrong(c.q), e.strongCompany);
    guard("comparison", () => isComparisonQuestion(c.q), e.comparison);
  }
  return { failures, checks };
}

/** 未被 expect 覆盖但值得盯的一致性不变量——跨用例的横向体检。 */
function runInvariants(): Failure[] {
  const out: Failure[] = [];
  const push = (id: string, q: string, field: string, expected: unknown, actual: unknown, why: string) =>
    out.push({ id, scenario: "invariant", q, field, expected, actual, why });

  // 不变量 1：domain 的裸抽取不该把停用词当代码（前端传停用词表，后端不传——两边必须一致）。
  for (const word of ["PE", "ROE", "DCF", "SPY", "CEO"]) {
    const bare = extractUsTickerToken(word);
    if (bare) push(`INV-STOP-${word}`, word, "extractUsTickerToken", "", bare,
      "domain 默认停用词表与前端 US_STOPWORDS 不一致：同一个词在两层得到不同结论");
  }
  // 不变量 2：前端停用词表是 domain COMMON_NON_TICKERS 的子集拷贝，漂移即代码分叉。
  for (const word of US_STOPWORDS) {
    if (extractUsTickerToken(word)) {
      push(`INV-DRIFT-${word}`, word, "stopword-parity", "", word,
        "前端停用词表里有、domain 里没有——两份名单已经漂移");
    }
  }
  return out;
}

function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) || []), item]);
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const { failures, checks } = runStatic();
  const invariantFailures = runInvariants();
  const all = [...failures, ...invariantFailures];

  console.log(`\n智能分析回归 · 静态路由层`);
  console.log(`语料 ${CORPUS.length} 条 · 断言 ${checks + invariantFailures.length} 次 · 失败 ${all.length} 次\n`);

  const byScenario = group(all, (f) => f.scenario);
  for (const [scenario, items] of [...byScenario].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ✗ ${scenario}  (${items.length})`);
    for (const f of items) {
      console.log(`      ${f.id}  「${f.q.length > 40 ? `${f.q.slice(0, 40)}…` : f.q}」`);
      console.log(`         ${f.field}: 期望 ${JSON.stringify(f.expected)} · 实际 ${JSON.stringify(f.actual)}`);
      if (f.why) console.log(`         理由：${f.why}`);
    }
    console.log("");
  }

  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0 && args[jsonIndex + 1]) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args[jsonIndex + 1], JSON.stringify({ total: CORPUS.length, checks, failures: all }, null, 2));
    console.log(`已写出 ${args[jsonIndex + 1]}\n`);
  }

  if (args.includes("--live")) {
    const { runLive } = await import("./live.ts");
    await runLive();
  }

  process.exit(all.length ? 1 : 0);
}

void main();
