/**
 * `npm run factguard-sample` — R3 影子模式真实样本（真实模型 + 真实数据管道）。
 *
 * 对一批真实问题（覆盖估值/同业/持仓/财报日历/基本面）跑一遍完整的 runChat 链路，
 * 打印每条回答里 factGuard 抽到的数字、判定结果（pass/soft/hard），供人工核对误报率、
 * 调正则关键词窗口与容差阈值——这是 R3 方案要求的"必须用真实模型输出调阈值"的落地工具。
 *
 * 不进 CI（同 npm run canary 的原则）：会真的调用模型 API、烧配额，属于本机手动跑的工具。
 * 不受 FACT_GUARD_MODE 影响真实用户看到的内容——这里只是观察 chatOrchestrator 内部已经
 * 在跑的校验（默认 shadow 只打日志，这个脚本只是把同一份日志更完整地摆出来看）。
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { runChat } = await import("../src/server/services/chatOrchestrator.js");
const { getComparableCompanies } = await import("../src/server/services/compPeers.js");
const { getNextEarnings } = await import("../src/server/services/earningsCalendar.js");
const { upsertPosition } = await import("../src/server/repositories/portfolio.js");

// 覆盖 R3 方案要求的样本范围：美股 + 港股、估值/同业/持仓/财报日历/基本面几类问法。
const SAMPLES = [
  { ticker: "AAPL", nameZh: "苹果", question: "估值怎么看？给出估值区间和同业对比" },
  { ticker: "NVDA", nameZh: "英伟达", question: "现在贵不贵，同业倍数怎么样" },
  { ticker: "0700.HK", nameZh: "腾讯控股", question: "估值怎么看？给出估值区间和同业对比" },
  { ticker: "9988.HK", nameZh: "阿里巴巴", question: "下一次财报什么时候，业绩节奏怎么看" },
  { ticker: "9868.HK", nameZh: "小鹏汽车", question: "赚不赚钱，财务质量怎么样" },
  { ticker: "0700.HK", nameZh: "腾讯控股", question: "我成本 380，现在浮盈浮亏多少" }
];

function fakeRes() {
  const chunks = [];
  return {
    chunks,
    writeHead() {}, setHeader() {}, headersSent: false,
    write(c) { chunks.push(c); }, end(c) { if (c) chunks.push(c); }
  };
}

function extractFinalPayload(res) {
  const text = res.chunks.join("");
  // 流式响应是 SSE；也兼容非流式的一整段 JSON。
  const m = text.match(/event: final\ndata: (.+)\n\n/);
  if (m) return JSON.parse(m[1]);
  try { return JSON.parse(text); } catch { return null; }
}

console.log(`\nfactGuard 影子模式样本 — FACT_GUARD_MODE=${process.env.FACT_GUARD_MODE || "shadow"}\n`);

// 持仓样本需要真实持仓记录，跑之前先写一条（跟真实用户记账走同一张表）。
upsertPosition("0700.HK", { companyName: "腾讯控股", shares: 100, avgCost: 380 });

for (const sample of SAMPLES) {
  console.log(`\n==== ${sample.ticker} — ${sample.question} ====`);
  // 用同一批真实数据顺手打印一下 comp/earnings 的可用性，帮助解读下面 factGuard 的判定。
  const [comp, earn] = await Promise.all([
    getComparableCompanies(sample.ticker).catch(() => null),
    getNextEarnings(sample.ticker).catch(() => null)
  ]);
  console.log(`  comp: ${comp?.providerStatus || "?"}（${comp?.anchor ? `锚点 ${comp.anchor.n} 家` : "无锚点"}）| earnings: ${earn?.providerStatus || "?"}（${earn?.nextDate || "无"}）`);

  const res = fakeRes();
  try {
    await runChat({ question: sample.question, company: { ticker: sample.ticker, nameZh: sample.nameZh }, stream: true }, res);
  } catch (error) {
    console.log(`  ✗ runChat 抛错：${error?.message || error}`);
    continue;
  }
  const payload = extractFinalPayload(res);
  if (!payload) {
    console.log("  ✗ 没能解析出 final payload");
    continue;
  }
  console.log(`  factGuard: ${JSON.stringify(payload.factGuard)}`);
  if (payload.factGuard?.hardDetails?.length) {
    for (const d of payload.factGuard.hardDetails) console.log(`    hard: "${d.raw}"（${d.dimension}）— ${d.reason}`);
  }
}

console.log("\n完成。逐条核对上面的 hard 命中是否是真实误报（比如没接上的数据类型、正则漏判），再回来调 factGuard.js 的关键词/容差。\n");
