-- 017_users_auth（U-1 / E12）：多用户 beta 的鉴权底座——用户、邀请码、登录会话。
-- 编号说明：016 预留给 M-4（PR #22，llm_audit token 落库）可能占用的迁移号；
-- 迁移器按 parseInt 排序跑，编号有空洞无碍。
--
-- 设计要点：
--   · users.id 用 'local' 作为 owner 的固定 id——既有私有数据（user_id DEFAULT 'local'
--     的表 + U-2 将迁移的表）自动归属 owner，不需要一次数据搬家。
--   · 登录会话落库存 token 的 sha256（不存原文），可随时撤销；不用纯签名 cookie。
--   · 邀请码一次性：used_by/used_at 落库，谁邀请了谁可审计。

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,             -- 格式 s1$saltHex$hashHex（scrypt N=16384,r=8,p=1）
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT PRIMARY KEY,
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_by    TEXT,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash   TEXT PRIMARY KEY,           -- sha256(token) hex，原文只活在用户 cookie 里
  user_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
