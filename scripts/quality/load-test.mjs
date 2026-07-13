// Capacity/load smoke test against an already-deployed environment. No new dependency:
// plain concurrent fetch loops, since the point is orientation before a capacity test,
// not full statistical rigor — reach for a dedicated tool once real numbers matter.
//
// Usage:
//   node scripts/quality/load-test.mjs --url https://staging.echo.example \
//     --concurrency 20 --duration 30 --p95-budget-ms 3000 \
//     --path /healthz --path /api/companies/search?q=tencent
import process from "node:process";

function parseArgs(argv) {
  const args = { url: "http://localhost:4180", concurrency: 20, duration: 30, p95BudgetMs: 3000, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") args.url = argv[++i];
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (arg === "--duration") args.duration = Number(argv[++i]);
    else if (arg === "--p95-budget-ms") args.p95BudgetMs = Number(argv[++i]);
    else if (arg === "--path") args.paths.push(argv[++i]);
  }
  if (args.paths.length === 0) args.paths = ["/healthz"];
  return args;
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[index];
}

async function hitOnce(url, headers) {
  const start = performance.now();
  try {
    const response = await fetch(url, { headers });
    await response.arrayBuffer();
    return { ms: performance.now() - start, ok: response.status < 500 };
  } catch {
    return { ms: performance.now() - start, ok: false };
  }
}

async function runWorker(url, headers, deadline, samples) {
  while (Date.now() < deadline) samples.push(await hitOnce(url, headers));
}

async function loadTestPath(baseUrl, path, { concurrency, duration }) {
  const url = new URL(path, baseUrl).toString();
  const headers = { "x-echo-auth": "1" };
  const samples = [];
  const deadline = Date.now() + duration * 1000;
  await Promise.all(Array.from({ length: concurrency }, () => runWorker(url, headers, deadline, samples)));
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok).length;
  return {
    path,
    requests: samples.length,
    errors,
    errorRate: samples.length ? errors / samples.length : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.at(-1) ?? 0
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[load-test] ${args.url} concurrency=${args.concurrency} duration=${args.duration}s paths=${args.paths.join(",")}`);
  let overBudget = false;
  for (const path of args.paths) {
    const result = await loadTestPath(args.url, path, args);
    const status = result.p95 > args.p95BudgetMs || result.errorRate > 0.01 ? "FAIL" : "ok";
    if (status === "FAIL") overBudget = true;
    console.log(
      `[load-test] ${status} ${result.path} requests=${result.requests} errors=${result.errors} ` +
      `p50=${result.p50.toFixed(0)}ms p95=${result.p95.toFixed(0)}ms max=${result.max.toFixed(0)}ms`
    );
  }
  if (overBudget) {
    console.error(`[load-test] p95 budget (${args.p95BudgetMs}ms) or 1% error budget exceeded`);
    process.exitCode = 1;
  }
}

await main();
