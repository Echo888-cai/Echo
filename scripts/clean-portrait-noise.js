/**
 * 一次性精准清库：把"数据可用性诊断文案"从画像与时间线里清出去。
 *
 * 背景：decisionPanel 曾把 composeOneLineView 的诊断句（"XX 已有财务数据，缺一致预期…"）
 * 当作 oneLineView 的回落值，被 distillView 写进 company_profiles.thesis，并随数据源
 * 波动反复生成假 thesis_change 事件、污染建档事件与 profile_md。生成侧已修复
 * （dataReadiness 与 oneLineView 分离），本脚本只清历史存量：
 *   1. 删掉诊断文案产生的假 thesis_change 事件（整条都是噪声）；
 *   2. 建档事件是真实里程碑，只洗 summary（rationale 里的触发问题保留）；
 *   3. 被占用的 thesis 置空，等下一轮研究写入真实主线；
 *   4. 受影响公司的 profile_md 用清洗后的状态重渲染。
 * 幂等，可重复运行。用法：npm run clean:portraits
 */
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/server/utils/env.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFile(root);

const { getDb } = await import("../src/db/index.js");
const { upsertCompanyProfile } = await import("../src/server/repositories/companyProfiles.js");

const DIAG = ["%已有财务数据%", "%行情和财务数据均不可用%", "%行情已接入，但缺财务解析%"];
const hit = (col) => `(${DIAG.map(() => `${col} LIKE ?`).join(" OR ")})`;

const db = getDb();

// 清洗前先收集受影响的公司（事件或 thesis 任一命中），之后统一重渲染 profile_md。
const affected = new Set([
  ...db.prepare(`SELECT DISTINCT ticker FROM profile_events WHERE ${hit("summary")}`).all(...DIAG).map((r) => r.ticker),
  ...db.prepare(`SELECT ticker FROM company_profiles WHERE ${hit("thesis")}`).all(...DIAG).map((r) => r.ticker)
]);
const dirtyThesis = new Set(
  db.prepare(`SELECT ticker FROM company_profiles WHERE ${hit("thesis")}`).all(...DIAG).map((r) => r.ticker)
);

const clean = db.transaction(() => {
  const delChanges = db.prepare(`DELETE FROM profile_events WHERE kind = 'thesis_change' AND ${hit("summary")}`).run(...DIAG);
  const fixCreated = db.prepare(`UPDATE profile_events SET summary = '建立画像（首轮研究）' WHERE kind = 'created' AND ${hit("summary")}`).run(...DIAG);
  const fixThesis = db.prepare(`UPDATE company_profiles SET thesis = '' WHERE ${hit("thesis")}`).run(...DIAG);
  return { delChanges: delChanges.changes, fixCreated: fixCreated.changes, fixThesis: fixThesis.changes };
});

const r = clean();
console.log(`[clean-portrait-noise] 假"判断变化"事件删除：${r.delChanges} 条`);
console.log(`[clean-portrait-noise] 建档事件 summary 洗净：${r.fixCreated} 条`);
console.log(`[clean-portrait-noise] 画像 thesis 置空：${r.fixThesis} 条`);

// 重渲染 profile_md：空补丁即"按当前（已清洗）状态重建主档案"。dirty thesis 的公司
// 显式传 thesis:""，其余传 {}（thesis 本来就干净，只是时间线变了）。
let rerendered = 0;
for (const ticker of affected) {
  try {
    upsertCompanyProfile(ticker, dirtyThesis.has(ticker) ? { thesis: "" } : {});
    rerendered += 1;
  } catch (err) {
    console.warn(`[clean-portrait-noise] ${ticker} profile_md 重渲染失败：`, err?.message || err);
  }
}
console.log(`[clean-portrait-noise] profile_md 重渲染：${rerendered} 家`);

const leftEvents = db.prepare(`SELECT COUNT(*) AS n FROM profile_events WHERE ${hit("summary")}`).get(...DIAG);
const leftThesis = db.prepare(`SELECT COUNT(*) AS n FROM company_profiles WHERE ${hit("thesis")}`).get(...DIAG);
const leftMd = db.prepare(`SELECT COUNT(*) AS n FROM company_profiles WHERE ${hit("profile_md")}`).get(...DIAG);
console.log(`[clean-portrait-noise] 残留命中 events=${leftEvents.n} thesis=${leftThesis.n} profile_md=${leftMd.n}（应全为 0）`);
