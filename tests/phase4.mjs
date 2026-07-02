/**
 * P4 公司画像文档化 —— profile_events 时间线 + markdown 主档案。
 * 验收锚点（MASTER_PLAN §4 P4）：同一公司三轮不同结论的研究后，
 * 时间线出现 ≥2 条变化记录且各带理由；导出的 Markdown 可读。
 */
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { getDb } from "../src/db/index.js";

// ── 遗留迁移测试的前置：在仓库模块第一次 ensureTable 之前，先手工造一张
//    旧结构的 company_profiles（事件挤在 events_json 里），验证首跑自动搬进 profile_events。
const db = getDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS company_profiles (
    ticker          TEXT PRIMARY KEY,
    company_name    TEXT,
    thesis          TEXT,
    research_status TEXT,
    confidence      TEXT,
    bull_json       TEXT,
    bear_json       TEXT,
    monitors_json   TEXT,
    falsifiers_json TEXT,
    valuation_json  TEXT,
    events_json     TEXT,
    profile_md      TEXT,
    turn_count      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.prepare("INSERT INTO company_profiles (ticker, company_name, thesis, events_json) VALUES (?, ?, ?, ?)").run(
  "LEGA",
  "遗留公司",
  "老主线",
  JSON.stringify([
    { date: "2026-06-01", kind: "created", summary: "建立画像：老主线" },
    { date: "2026-06-15", kind: "thesis_change", summary: "判断转谨慎" }
  ])
);

const { getCompanyProfile, listProfileEvents, appendProfileEvent, renderProfileMarkdown } = await import(
  "../src/server/repositories/companyProfiles.js"
);
const { updatePortraitFromPanel } = await import("../src/server/services/companyPortrait.js");

let pass = 0;
let fail = 0;

function check(description, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

console.log("\n[7] 画像文档化（P4：profile_events 时间线 + markdown 主档案）");

check("遗留 events_json 首跑自动迁入 profile_events", () => {
  const events = listProfileEvents("LEGA");
  assert.equal(events.length, 2);
  assert.equal(events[0].summary, "建立画像：老主线");
  assert.equal(events[1].kind, "thesis_change");
});

const panelRound1 = {
  companyName: "测试科技",
  oneLineView: "广告复苏驱动利润率修复，主线成立",
  researchStatus: "初步覆盖",
  confidence: "中",
  riskTriggers: ["股价跌破 90 美元证伪"],
  sources: [
    { label: "2025 年报", url: "https://example.com/annual" },
    { label: "行业研究", url: "https://example.com/industry" }
  ]
};

check("首轮研究建档：created 事件带理由/证据/会话链接", () => {
  const r1 = updatePortraitFromPanel({ ticker: "ZZZT", panel: panelRound1, question: "测试科技怎么样？", sessionId: "sess-1" });
  assert.equal(r1.created, true);
  assert.equal(r1.changed, false);
  const events = r1.profile.events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "created");
  assert.ok(events[0].rationale.includes("首轮研究"));
  assert.equal(events[0].evidence[0].url, "https://example.com/annual");
  assert.equal(events[0].sessionId, "sess-1");
});

check("第二轮判断变化：thesis_change 带 from→to 理由；证伪线变化另记一条", () => {
  const r2 = updatePortraitFromPanel({
    ticker: "ZZZT",
    panel: {
      ...panelRound1,
      oneLineView: "广告复苏证据走弱，主线降级为观察",
      researchStatus: "持续跟踪",
      confidence: "低",
      riskTriggers: ["股价跌破 80 美元证伪"]
    },
    question: "最新财报后还成立吗？",
    sessionId: "sess-2"
  });
  assert.equal(r2.changed, true);
  const events = r2.profile.events;
  const change = events.find((e) => e.kind === "thesis_change");
  assert.ok(change, "应有 thesis_change 事件");
  assert.ok(change.rationale.includes("置信度 中→低"));
  assert.ok(change.rationale.includes("最新财报后还成立吗"));
  assert.equal(change.sessionId, "sess-2");
  const fals = events.find((e) => e.kind === "falsifier_change");
  assert.ok(fals, "证伪线 90→80 应记 falsifier_change");
  assert.ok(fals.summary.includes("80"));
});

check("第三轮判断未变：不写流水账，只累计轮次", () => {
  const before = listProfileEvents("ZZZT").length;
  const r3 = updatePortraitFromPanel({
    ticker: "ZZZT",
    panel: {
      ...panelRound1,
      oneLineView: "广告复苏证据走弱，主线降级为观察",
      researchStatus: "持续跟踪",
      confidence: "低",
      riskTriggers: ["股价跌破 80 美元证伪"]
    },
    question: "再确认一下",
    sessionId: "sess-3"
  });
  assert.equal(r3.changed, false);
  assert.equal(listProfileEvents("ZZZT").length, before);
  assert.equal(r3.profile.turnCount, 3);
});

check("验收：三轮不同结论后时间线 ≥2 条变化记录且各带理由", () => {
  const r4 = updatePortraitFromPanel({
    ticker: "ZZZT",
    panel: {
      ...panelRound1,
      oneLineView: "回购加码扭转预期，重新转多",
      researchStatus: "重点跟踪",
      confidence: "高",
      riskTriggers: ["股价跌破 80 美元证伪"]
    },
    question: "回购公告怎么看？",
    sessionId: "sess-4"
  });
  assert.equal(r4.changed, true);
  const changes = r4.profile.events.filter((e) => e.kind === "thesis_change" || e.kind === "falsifier_change");
  assert.ok(changes.length >= 2, `变化记录 ${changes.length} 条，应 ≥2`);
  for (const e of changes) assert.ok(e.rationale, `${e.kind} 事件应带理由`);
});

check("markdown 主档案：结构完整、时间线带理由与证据链接", () => {
  const profile = getCompanyProfile("ZZZT");
  const md = profile.profileMd;
  assert.ok(md.includes("## 投资主线"));
  assert.ok(md.includes("回购加码扭转预期"));
  assert.ok(md.includes("## 证伪条件（当前生效）"));
  assert.ok(md.includes("## 判断变化时间线"));
  assert.ok(md.includes("- 理由："));
  assert.ok(md.includes("](https://example.com/annual)"));
  assert.ok(md.includes("不构成投资建议"));
});

check("renderProfileMarkdown：估值带进关键指标", () => {
  const md = renderProfileMarkdown("ZZZT", {
    companyName: "测试科技",
    thesis: "主线",
    monitors: ["收入增速"],
    valuation: { method: "PE 带", bear: 70, base: 95, bull: 120, currentPrice: 88 }
  }, []);
  assert.ok(md.includes("## 关键指标"));
  assert.ok(md.includes("悲观 70 / 中性 95 / 乐观 120"));
  assert.ok(md.includes("现价 88"));
});

check("appendProfileEvent/listProfileEvents：按时间正序、字段完整", () => {
  appendProfileEvent("ZZZT", { date: "2026-07-02", kind: "note", summary: "手工记录", rationale: "测试", evidence: [{ title: "t", url: "https://e.com" }] });
  const events = listProfileEvents("ZZZT");
  const last = events[events.length - 1];
  assert.equal(last.kind, "note");
  assert.equal(last.evidence[0].url, "https://e.com");
});

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
