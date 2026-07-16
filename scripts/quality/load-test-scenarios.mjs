/**
 * Comprehensive load test — realistic user journeys against the Echo Research API.
 * Usage: node scripts/quality/load-test-scenarios.mjs [--base=http://localhost:3001] [--duration=60] [--concurrency=10] [--token=...] [--p95-budget=5000]
 */
import process from "node:process";

function parseArgs(argv) {
  const args = { base: "http://localhost:3001", duration: 60, concurrency: 10, token: "", p95Budget: 5000 };
  for (const arg of argv) {
    const [key, value] = arg.split("=");
    if (key === "--base") args.base = value;
    else if (key === "--duration") args.duration = Number(value);
    else if (key === "--concurrency") args.concurrency = Number(value);
    else if (key === "--token") args.token = value;
    else if (key === "--p95-budget") args.p95Budget = Number(value);
  }
  if (!args.token) args.token = process.env.ECHO_AUTH_TOKEN || "";
  return args;
}

const scenarios = [
  {
    name: "health-check",
    weight: 40,
    method: "GET",
    path: "/healthz",
    body: null
  },
  {
    name: "watch-desk",
    weight: 25,
    method: "GET",
    path: "/api/status",
    body: null
  },
  {
    name: "stock-detail",
    weight: 20,
    method: "GET",
    path: "/api/companies/search?q=AAPL",
    body: null
  },
  {
    name: "research-ask",
    weight: 10,
    method: "POST",
    path: "/trpc/ask",
    body: JSON.stringify({
      json: { question: "What is the current valuation of AAPL?", company: { ticker: "AAPL" } }
    })
  },
  {
    name: "notifications",
    weight: 5,
    method: "GET",
    path: "/trpc/notifications.unread",
    body: null
  }
];

function pickScenario() {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const s of scenarios) {
    cumulative += s.weight;
    if (roll < cumulative) return s;
  }
  return scenarios[0];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function createTracker() {
  return { requests: 0, successes: 0, errors: 0, latencies: [], bytes: 0 };
}

async function hitOnce(base, scenario, headers) {
  const url = new URL(scenario.path, base).toString();
  const init = {
    method: scenario.method,
    headers: { ...headers, ...(scenario.body ? { "content-type": "application/json" } : {}) },
    body: scenario.body || undefined
  };
  const start = performance.now();
  try {
    const res = await fetch(url, init);
    const buf = await res.arrayBuffer();
    const ms = performance.now() - start;
    return { ms, ok: res.status < 500, bytes: buf.byteLength };
  } catch {
    return { ms: performance.now() - start, ok: false, bytes: 0 };
  }
}

async function runWorker(base, headers, deadline, trackers) {
  while (Date.now() < deadline) {
    const scenario = pickScenario();
    const tracker = trackers.get(scenario.name);
    const result = await hitOnce(base, scenario, headers);
    tracker.requests++;
    tracker.latencies.push(result.ms);
    tracker.bytes += result.bytes;
    if (result.ok) tracker.successes++;
    else tracker.errors++;
  }
}

function formatMs(ms) {
  return ms.toFixed(0).padStart(6);
}

function formatPct(n) {
  return (n * 100).toFixed(1).padStart(5) + "%";
}

function printTable(trackers) {
  const header = "Scenario".padEnd(16) + "Reqs".padStart(8) + "OK".padStart(8) + "Err".padStart(8)
    + "Err%".padStart(8) + "p50ms".padStart(8) + "p95ms".padStart(8) + "p99ms".padStart(8) + "MaxMs".padStart(8)
    + "  KiB".padStart(8);
  console.log("\n" + "─".repeat(header.length));
  console.log(header);
  console.log("─".repeat(header.length));

  let totalReqs = 0, totalOk = 0, totalErr = 0, allLatencies = [], totalBytes = 0;

  for (const [name, t] of trackers) {
    t.latencies.sort((a, b) => a - b);
    const errRate = t.requests > 0 ? t.errors / t.requests : 0;
    const kib = (t.bytes / 1024).toFixed(0);
    console.log(
      name.padEnd(16)
      + String(t.requests).padStart(8)
      + String(t.successes).padStart(8)
      + String(t.errors).padStart(8)
      + formatPct(errRate).padStart(8)
      + formatMs(percentile(t.latencies, 50)).padStart(8)
      + formatMs(percentile(t.latencies, 95)).padStart(8)
      + formatMs(percentile(t.latencies, 99)).padStart(8)
      + formatMs(t.latencies.at(-1) ?? 0).padStart(8)
      + String(kib).padStart(8)
    );
    totalReqs += t.requests;
    totalOk += t.successes;
    totalErr += t.errors;
    allLatencies.push(...t.latencies);
    totalBytes += t.bytes;
  }

  allLatencies.sort((a, b) => a - b);
  const totalErrRate = totalReqs > 0 ? totalErr / totalReqs : 0;
  console.log("─".repeat(header.length));
  console.log(
    "TOTAL".padEnd(16)
    + String(totalReqs).padStart(8)
    + String(totalOk).padStart(8)
    + String(totalErr).padStart(8)
    + formatPct(totalErrRate).padStart(8)
    + formatMs(percentile(allLatencies, 50)).padStart(8)
    + formatMs(percentile(allLatencies, 95)).padStart(8)
    + formatMs(percentile(allLatencies, 99)).padStart(8)
    + formatMs(allLatencies.at(-1) ?? 0).padStart(8)
    + String((totalBytes / 1024).toFixed(0)).padStart(8)
  );
  console.log("─".repeat(header.length));

  return { totalReqs, totalErr, totalErrRate, allLatencies, trackers };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const headers = { "x-echo-auth": "1" };
  if (args.token) headers["authorization"] = `Bearer ${args.token}`;

  console.log(`[load-test-scenarios] base=${args.base} concurrency=${args.concurrency} duration=${args.duration}s p95-budget=${args.p95Budget}ms`);
  console.log(`[load-test-scenarios] scenarios: ${scenarios.map(s => `${s.name}(${s.weight}%)`).join(", ")}`);

  const trackers = new Map();
  for (const s of scenarios) trackers.set(s.name, createTracker());

  const deadline = Date.now() + args.duration * 1000;
  const workers = Array.from({ length: args.concurrency }, () => runWorker(args.base, headers, deadline, trackers));
  await Promise.all(workers);

  const { totalErrRate, allLatencies } = printTable(trackers);

  let failed = false;
  const p95 = percentile(allLatencies, 95);

  if (p95 > args.p95Budget) {
    console.error(`\n✗ FAIL: aggregate p95 (${p95.toFixed(0)}ms) exceeds budget (${args.p95Budget}ms)`);
    failed = true;
  }
  if (totalErrRate > 0.05) {
    console.error(`✗ FAIL: error rate ${(totalErrRate * 100).toFixed(1)}% exceeds 5% threshold`);
    failed = true;
  }
  for (const [name, t] of trackers) {
    if (t.requests > 0 && t.successes === 0) {
      console.error(`✗ FAIL: scenario "${name}" had 100% failures (${t.errors}/${t.requests})`);
      failed = true;
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("\n✓ All checks passed.");
  }
}

await main();
