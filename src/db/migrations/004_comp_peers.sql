-- 004_comp_peers: G-3 同业可比清单读穿透缓存（24h TTL，见 compPeers.js）。
-- 一行 = 一只 ticker 最新已知的同业清单 + 按倍数分桶的锚点，整块存 JSON——同业列表
-- 本身就是一份需要整体替换的快照，不需要拆列查询。

CREATE TABLE IF NOT EXISTS comp_peers (
  ticker            TEXT PRIMARY KEY,
  stage             TEXT,
  peers_json        TEXT,
  anchor_json       TEXT,
  provider_status   TEXT NOT NULL DEFAULT 'missing',
  detail            TEXT,
  partial           INTEGER NOT NULL DEFAULT 0,
  fetched_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
