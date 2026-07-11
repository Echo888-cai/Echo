-- 020_beta_experience（P14）：新用户引导、每用户通知偏好、应用内反馈。

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id                 TEXT PRIMARY KEY,
  onboarding_completed   INTEGER NOT NULL DEFAULT 0,
  notify_digest           INTEGER NOT NULL DEFAULT 1,
  notify_positions        INTEGER NOT NULL DEFAULT 1,
  notify_falsify          INTEGER NOT NULL DEFAULT 1,
  notify_review           INTEGER NOT NULL DEFAULT 1,
  notify_earnings         INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  message      TEXT NOT NULL,
  context_json TEXT,
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_user_time ON feedback(user_id, created_at);
