// B-1 测试：置信度事实锚定护栏（reconcileConfidence + buildDecisionPanel 集成）。
// 目标：模型自称的置信度不能超过真实数据接地程度支持的上限——这是把"事实锚定"从
// 提示词承诺变成代码执行的护栏，之前 modelPanel.confidence 会被 pickModelOverrides
// 原样透传，模型说"高"就是"高"，不管证据薄不薄。
import "./setupTestDb.mjs";
import { reconcileConfidence, buildDecisionPanel } from "../src/server/services/decisionPanel.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] reconcileConfidence：纯函数护栏逻辑");
{
  const r1 = reconcileConfidence("高", "低");
  check("模型说高、接地只到低 → 下调到低", r1.confidence === "低", r1.confidence);
  check("下调时给出 confidenceNote 说明原因", typeof r1.confidenceNote === "string" && r1.confidenceNote.length > 0);

  const r2 = reconcileConfidence("中", "高");
  check("模型说中、接地支持高 → 尊重模型的中（不强行拉高）", r2.confidence === "中", r2.confidence);
  check("不下调时 confidenceNote 为 null", r2.confidenceNote === null);

  const r3 = reconcileConfidence("高", "高");
  check("模型和接地一致 → 原样返回、无提示", r3.confidence === "高" && r3.confidenceNote === null);

  const r4 = reconcileConfidence(undefined, "中");
  check("模型未给置信度 → 直接用接地值", r4.confidence === "中" && r4.confidenceNote === null);

  const r5 = reconcileConfidence("乱写的值", "低");
  check("模型给了非法枚举值 → 视同未给，退回接地值", r5.confidence === "低" && r5.confidenceNote === null);
}

console.log("[2] buildDecisionPanel 集成：modelPanel.confidence 不能越过 pickModelOverrides 白名单原样透传");
{
  // 数据全部缺失（grounded 必为"低"），但模型硬说"高" → 面板最终必须是"低"，且带说明。
  const panel = buildDecisionPanel({
    question: "分析",
    company: { ticker: "TEST.HK", nameZh: "测试公司", currency: "HKD", risks: [] },
    marketSnapshot: { providerStatus: "missing" },
    newsSnapshot: { providerStatus: "missing", articles: [] },
    financialsData: { providerStatus: "missing" },
    filingsData: { providerStatus: "missing", filings: [] },
    estimatesData: { providerStatus: "missing" },
    modelPanel: { confidence: "高", researchStatus: "watch", oneLineView: "测试" }
  });
  check("证据薄弱时模型自称的高置信度被下调为低", panel.confidence === "低", panel.confidence);
  check("面板带上了下调说明", typeof panel.confidenceNote === "string" && panel.confidenceNote.includes("高"));

  // 数据全部 ok（grounded 可达"高"），模型给"中" → 尊重模型判断，不强行拉高。
  const panel2 = buildDecisionPanel({
    question: "分析",
    company: { ticker: "TEST2.HK", nameZh: "测试公司2", currency: "HKD", risks: [] },
    marketSnapshot: { providerStatus: "ok", source: "Test", price: 100, currency: "HKD", asOf: new Date().toISOString() },
    newsSnapshot: { providerStatus: "ok", source: "Test", asOf: new Date().toISOString(), articles: [{ title: "x", url: "u" }] },
    financialsData: { providerStatus: "ok", source: "Test", asOf: new Date().toISOString(), revenueGrowth: 10, grossMargin: 50 },
    filingsData: { providerStatus: "ok", filings: [{ title: "x" }], source: "Test", asOf: new Date().toISOString() },
    estimatesData: { providerStatus: "ok" },
    modelPanel: { confidence: "中", researchStatus: "watch", oneLineView: "测试" }
  });
  check("数据充分时模型给的偏保守置信度被尊重，不强行拉高", panel2.confidence === "中", panel2.confidence);
  check("不下调时面板 confidenceNote 为 null", panel2.confidenceNote === null);

  // 无 modelPanel（本地兜底路径）→ 行为等价于旧逻辑，直接用 grounded confidence。
  const panel3 = buildDecisionPanel({
    question: "分析",
    company: { ticker: "TEST3.HK", nameZh: "测试公司3", currency: "HKD", risks: [] },
    marketSnapshot: { providerStatus: "missing" },
    newsSnapshot: { providerStatus: "missing", articles: [] },
    financialsData: { providerStatus: "missing" },
    filingsData: { providerStatus: "missing", filings: [] },
    estimatesData: { providerStatus: "missing" }
  });
  check("本地兜底路径（无 modelPanel）confidence 仍然正常产出", panel3.confidence === "低");
  check("本地兜底路径 confidenceNote 为 null（没有模型可核对）", panel3.confidenceNote === null);
}

console.log(`\nB-1: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
