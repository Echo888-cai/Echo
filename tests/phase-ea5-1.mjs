// EA-5.1 测试：会话分组（research_sessions.conversation_id + listConversations）。
// [1] saveResearchSession：不传 conversationId 时自成一组（= 自身 id），传了就沿用同一组，
//     且分组一旦落定不会被后续更新悄悄改写（COALESCE 保底）。
// [2] listConversations：同一 conversationId 下的多次研究（换公司）被收进同一组，组内按
//     研究顺序排列；不同 conversationId 各自成组；分组按最近更新时间倒序。
import "./setupTestDb.mjs";
import { saveResearchSession, getResearchSession, listConversations } from "../src/server/repositories/researchSessions.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[1] saveResearchSession：conversation_id 落地规则");
{
  const s1 = saveResearchSession({ id: "s_solo1", ticker: "0700.HK", question: "腾讯怎么样" });
  const solo = getResearchSession(s1.id);
  check("不传 conversationId 时自成一组（= 自身 id）", solo.conversationId === "s_solo1", solo.conversationId);

  const conv = "conv_abc";
  const s2 = saveResearchSession({ id: "s_a", ticker: "0700.HK", question: "腾讯怎么样", conversationId: conv });
  const s3 = saveResearchSession({ id: "s_b", ticker: "9988.HK", question: "阿里怎么样", conversationId: conv });
  check("同一 conversationId 下两条各自的会话都记到同一组", getResearchSession(s2.id).conversationId === conv);
  check("第二条也在同一组", getResearchSession(s3.id).conversationId === conv);

  // 分组落定后，再次 upsert 同一 id 且不带 conversationId：不应被清空/改写。
  saveResearchSession({ id: "s_a", ticker: "0700.HK", question: "腾讯怎么样（追问）" });
  check("已落定的分组不会被后续无 conversationId 的更新覆盖", getResearchSession("s_a").conversationId === conv);
}

console.log("[2] listConversations：按对话分组 + 组内顺序 + 最近优先");
{
  const conv = `conv_${Date.now()}`;
  saveResearchSession({ id: `solo_${Date.now()}`, ticker: "AAPL", title: "苹果研究", question: "苹果怎么样" });
  saveResearchSession({ id: `${conv}_1`, ticker: "0700.HK", title: "腾讯和阿里对比", question: "腾讯怎么样", conversationId: conv });
  saveResearchSession({ id: `${conv}_2`, ticker: "9988.HK", question: "阿里怎么样", conversationId: conv });

  const conversations = listConversations({ limit: 50 });
  const group = conversations.find((g) => g.conversationId === conv);
  check("分组存在", Boolean(group));
  check("组内有 2 家公司", group?.companies?.length === 2, JSON.stringify(group?.companies));
  check("组内公司按研究顺序（腾讯先、阿里后）", group?.companies?.[0]?.ticker === "0700.HK" && group?.companies?.[1]?.ticker === "9988.HK");
  check("组标题取自这次对话最早的问题", group?.title === "腾讯和阿里对比", group?.title);
  check("单公司会话独立成组（未被误并入其他组）", conversations.some((g) => g.companies?.length === 1 && g.companies[0].ticker === "AAPL"));
  check("最近更新的分组排在最前面", conversations[0].conversationId === conv, conversations[0].conversationId);
}

console.log(`\nEA-5.1: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
