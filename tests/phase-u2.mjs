// U-2（E13）：私有资产按 user_id 隔离，并通过真实 HTTP API 验证成员看不到 owner 数据。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { createOwner, registerWithInvite } from "../src/server/services/authService.js";
import { createInvite } from "../src/server/repositories/authRepository.js";
import { upsertCompanyProfile, getCompanyProfile } from "../src/server/repositories/companyProfiles.js";
import { upsertPosition, listPositions } from "../src/server/repositories/portfolio.js";
import { addToWatch, listWatchAdds } from "../src/server/repositories/watchlist.js";
import { saveResearchSession, listResearchSessions } from "../src/server/repositories/researchSessions.js";
import { addDocument, getDocuments } from "../src/server/repositories/documentRepository.js";
import { insertNotification, listNotifications } from "../src/server/repositories/notifications.js";
import { replaceFalsifierRules, listRules } from "../src/server/repositories/watchRules.js";
import { insertResearchSnapshot, listSnapshots } from "../src/server/repositories/researchSnapshotsRepository.js";
import { handleSessionList } from "../src/server/routes/research.js";
import { handleProfileList } from "../src/server/routes/portraits.js";
import { handlePortfolioList } from "../src/server/routes/portfolio.js";
import { handleDocumentList } from "../src/server/routes/documents.js";
import { handleNotificationsList } from "../src/server/routes/notifications.js";
import { handleWatchDesk } from "../src/server/routes/watch.js";

const OWNER = "local";
createOwner({ username: "owner_u2", password: "owner-pass-123" });
createInvite("echo-u2-member", { createdBy: OWNER });
const member = registerWithInvite({ invite: "echo-u2-member", username: "member_u2", password: "member-pass-123" }).user;

upsertCompanyProfile("AAPL", { companyName: "Apple", thesis: "owner thesis" }, OWNER);
upsertPosition("AAPL", { companyName: "Apple", shares: 10, avgCost: 100 }, OWNER);
addToWatch("AAPL", "Apple", OWNER);
saveResearchSession({ id: "owner-session", ticker: "AAPL", question: "owner question" }, OWNER);
addDocument({ ticker: "AAPL", name: "owner.txt", text: "private", userId: OWNER });
insertNotification({ kind: "system", title: "owner only", userId: OWNER });
replaceFalsifierRules("AAPL", [{ kind: "price_below", threshold: 90, label: "owner rule" }], { userId: OWNER });
insertResearchSnapshot({ ticker: "AAPL", snapshotDate: "2026-07-10", thesis: "owner thesis", userId: OWNER });

assert.ok(getCompanyProfile("AAPL", OWNER));
assert.equal(getCompanyProfile("AAPL", member.id), null);
assert.equal(listPositions(OWNER).length, 1);
assert.equal(listPositions(member.id).length, 0);
assert.equal(listWatchAdds(OWNER).length, 1);
assert.equal(listWatchAdds(member.id).length, 0);
assert.equal(listResearchSessions({ userId: OWNER }).length, 1);
assert.equal(listResearchSessions({ userId: member.id }).length, 0);
assert.equal(getDocuments({ userId: OWNER }).length, 1);
assert.equal(getDocuments({ userId: member.id }).length, 0);
assert.equal(listNotifications(20, OWNER).length, 1);
assert.equal(listNotifications(20, member.id).length, 0);
assert.equal(listRules("AAPL", OWNER).length, 1);
assert.equal(listRules("AAPL", member.id).length, 0);
assert.equal(listSnapshots("AAPL", OWNER).length, 1);
assert.equal(listSnapshots("AAPL", member.id).length, 0);

async function callRoute(handler, url) {
  let status = 0;
  let raw = "";
  const req = { url, headers: { host: "127.0.0.1" }, echoUser: member };
  const res = {
    writeHead(code) { status = code; },
    end(body = "") { raw += body; }
  };
  await handler(req, res);
  assert.equal(status, 200, `${url} status`);
  return JSON.parse(raw).data;
}

const checks = await Promise.all([
  callRoute(handleSessionList, "/api/research/sessions"),
  callRoute(handleProfileList, "/api/company/profiles"),
  callRoute(handlePortfolioList, "/api/portfolio"),
  callRoute(handleDocumentList, "/api/documents"),
  callRoute(handleNotificationsList, "/api/notifications"),
  callRoute(handleWatchDesk, "/api/watch/desk")
]);
assert.equal(checks[0].sessions.length, 0, "研究会话不可跨用户读取");
assert.equal(checks[1].profiles.length, 0, "公司画像不可跨用户读取");
assert.equal(checks[2].positions.length, 0, "持仓不可跨用户读取");
assert.equal(checks[3].documents.length, 0, "文档不可跨用户读取");
assert.equal(checks[4].notifications.length, 0, "通知不可跨用户读取");
assert.equal(checks[5].desk.cards.length, 0, "关注列表不可跨用户读取");

console.log("phase-u2 ✓ 私有表 repository + HTTP API 跨用户隔离");
