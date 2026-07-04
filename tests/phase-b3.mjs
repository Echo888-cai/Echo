// B-3 测试：公司对比升级——judgeComparison() 把并排数据表升级成"谁更值得"的判断。
// 只用两个可比维度（利润质量分/回报风险赔率）下结论，两个维度指向同一边才敢说赢家；
// 指向不同方向、或数据不够时诚实说清楚，不硬编赢家（B-1 事实锚定护栏在对比场景的延伸）。
import "./setupTestDb.mjs";
import { judgeComparison } from "../src/server/routes/chat.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] 两个维度一致占优 → 明确赢家");
{
  const left = { name: "腾讯", qualityScore: 78, odds: 2.5 };
  const right = { name: "阿里巴巴", qualityScore: 60, odds: 1.2 };
  const v = judgeComparison(left, right);
  check("质量分和赔率都是 left 更高 → winner=left", v.winner === "left", v.winner);
  check("reason 里点出具体数字", v.reason.includes("78") && v.reason.includes("2.5"));
}

console.log("[2] 两个维度指向不同方向 → mixed，不硬选边");
{
  const left = { name: "A公司", qualityScore: 85, odds: 0.8 };
  const right = { name: "B公司", qualityScore: 55, odds: 3.0 };
  const v = judgeComparison(left, right);
  check("质量分/赔率矛盾时返回 mixed", v.winner === "mixed", v.winner);
  check("reason 同时点出两边各自的优势维度", v.reason.includes("A公司") && v.reason.includes("B公司"));
}

console.log("[3] 数值接近 → tie，不假装分出高下");
{
  const left = { name: "A", qualityScore: 70, odds: 1.5 };
  const right = { name: "B", qualityScore: 70, odds: 1.5 };
  const v = judgeComparison(left, right);
  check("完全相等时返回 tie", v.winner === "tie", v.winner);
}

console.log("[3b] 回归测试：一个维度打平、另一个维度决定性——不能把打平误说成更好");
{
  // 实测踩过的坑：英伟达 qualityScore 100 vs AMD 72（质量分 left 更高），
  // 但赔率两边都是 1.3（真打平）——旧逻辑把 oddsWinner 算成"tie"后误当成"right"，
  // 说成"AMD 赔率更好（1.3:1 vs 1.3:1）"，数字明明相等却宣称"更好"。
  const left = { name: "英伟达", qualityScore: 100, odds: 1.3 };
  const right = { name: "AMD", qualityScore: 72, odds: 1.3 };
  const v = judgeComparison(left, right);
  check("赔率打平时不冒充某一边赔率更好", !v.reason.includes("AMD 回报风险赔率更好"), v.reason);
  check("质量分决定性占优、赔率打平 → winner=left（质量分那边）", v.winner === "left", v.winner);
  check("reason 如实说赔率接近而不是分出胜负", v.reason.includes("赔率两者接近") || v.reason.includes("接近"), v.reason);

  // 反过来：质量分打平，赔率决定性占优。
  const left2 = { name: "C", qualityScore: 65, odds: 2.0 };
  const right2 = { name: "D", qualityScore: 65, odds: 1.0 };
  const v2 = judgeComparison(left2, right2);
  check("质量分打平时不冒充某一边质量分更高", !v2.reason.includes("D 利润质量分更高"), v2.reason);
  check("赔率决定性占优、质量分打平 → winner=left（赔率那边）", v2.winner === "left", v2.winner);
}

console.log("[4] 只有一个维度有数据 → 用它判断，但诚实说明另一维度缺失");
{
  const left = { name: "A", qualityScore: 80, odds: null };
  const right = { name: "B", qualityScore: 50, odds: null };
  const v = judgeComparison(left, right);
  check("只有质量分数据时仍能判断", v.winner === "left", v.winner);
  check("reason 诚实说明赔率数据缺失，不假装两个维度都验证过", v.reason.includes("赔率"));

  const left2 = { name: "A", qualityScore: null, odds: 2.0 };
  const right2 = { name: "B", qualityScore: null, odds: 1.0 };
  const v2 = judgeComparison(left2, right2);
  check("只有赔率数据时仍能判断", v2.winner === "left", v2.winner);
  check("reason 诚实说明质量分缺失", v2.reason.includes("质量"));
}

console.log("[5] 两个维度都缺 → insufficient，不编造赢家");
{
  const v = judgeComparison({ name: "A", qualityScore: null, odds: null }, { name: "B", qualityScore: null, odds: null });
  check("两个维度都缺失时返回 insufficient", v.winner === "insufficient", v.winner);
  check("reason 说明是数据不足，不是打平", v.reason.includes("缺数据"));
}

console.log(`\nB-3: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
