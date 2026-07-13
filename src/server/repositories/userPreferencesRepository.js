import { getDb } from "../../db/index.js";

const DEFAULTS = {
  onboardingCompleted: false,
  notifyDigest: true,
  notifyPositions: true,
  notifyFalsify: true,
  notifyReview: true,
  notifyEarnings: true
};

function hydrate(row) {
  if (!row) return { ...DEFAULTS };
  return {
    onboardingCompleted: Boolean(row.onboarding_completed),
    notifyDigest: Boolean(row.notify_digest),
    notifyPositions: Boolean(row.notify_positions),
    notifyFalsify: Boolean(row.notify_falsify),
    notifyReview: Boolean(row.notify_review),
    notifyEarnings: Boolean(row.notify_earnings)
  };
}

export function getUserPreferences(userId = "local") {
  return hydrate(getDb().prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(userId));
}

export function updateUserPreferences(userId = "local", patch = {}) {
  const current = getUserPreferences(userId);
  const next = { ...current };
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  getDb().prepare(`
    INSERT INTO user_preferences
      (user_id, onboarding_completed, notify_digest, notify_positions, notify_falsify, notify_review, notify_earnings, updated_at)
    VALUES (@userId, @onboardingCompleted, @notifyDigest, @notifyPositions, @notifyFalsify, @notifyReview, @notifyEarnings, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      onboarding_completed = excluded.onboarding_completed,
      notify_digest = excluded.notify_digest,
      notify_positions = excluded.notify_positions,
      notify_falsify = excluded.notify_falsify,
      notify_review = excluded.notify_review,
      notify_earnings = excluded.notify_earnings,
      updated_at = datetime('now')
  `).run({ userId, ...Object.fromEntries(Object.entries(next).map(([key, value]) => [key, value ? 1 : 0])) });
  return getUserPreferences(userId);
}

const KIND_PREF = {
  digest: "notifyDigest",
  position_alert: "notifyPositions",
  falsify_alert: "notifyFalsify",
  review_reminder: "notifyReview",
  earnings_review: "notifyEarnings"
};

export function notificationEnabled(userId, kind) {
  const key = KIND_PREF[kind];
  return key ? getUserPreferences(userId)[key] : true;
}
