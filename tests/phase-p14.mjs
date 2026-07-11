// P14：onboarding 偏好、通知开关、反馈落库与用户隔离。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { getUserPreferences, updateUserPreferences, notificationEnabled } from "../src/server/repositories/userPreferences.js";
import { insertFeedback, listFeedback } from "../src/server/repositories/feedbackRepository.js";
import { notify } from "../src/server/services/notifier.js";
import { listNotifications } from "../src/server/repositories/notifications.js";

const initial = getUserPreferences("u-a");
assert.equal(initial.onboardingCompleted, false);
assert.equal(initial.notifyDigest, true);

const updated = updateUserPreferences("u-a", { onboardingCompleted: true, notifyDigest: false, notifyFalsify: false });
assert.equal(updated.onboardingCompleted, true);
assert.equal(notificationEnabled("u-a", "digest"), false);
assert.equal(notificationEnabled("u-a", "position_alert"), true);

const skipped = await notify({ kind: "digest", title: "disabled", userId: "u-a" });
assert.equal(skipped.preference, "disabled");
assert.equal(listNotifications(20, "u-a").length, 0);
await notify({ kind: "position_alert", title: "enabled", userId: "u-a" });
assert.equal(listNotifications(20, "u-a").length, 1);

insertFeedback("u-a", "希望空状态更清楚", { route: "/watch" });
assert.equal(listFeedback("u-a").length, 1);
assert.equal(listFeedback("u-b").length, 0);

console.log("phase-p14 ✓ onboarding / 通知偏好 / 反馈隔离");
