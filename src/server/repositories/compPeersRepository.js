/**
 * compPeersRepository — `comp_peers` 表的读写（G-3）。
 * 一行 = 一只 ticker 当前已知的同业清单快照（peers + 锚点，整块 JSON），
 * 24h TTL 由 compPeers.js 判断，这里只管存取。
 */
import { getDb } from "../../db/index.js";

export function getCompPeersRow(ticker) {
  const db = getDb();
  return db.prepare(`SELECT * FROM comp_peers WHERE ticker = ?`).get(ticker) || null;
}

export function upsertCompPeers({ ticker, stage, peers, anchor, providerStatus, detail, partial }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO comp_peers (ticker, stage, peers_json, anchor_json, provider_status, detail, partial, fetched_at)
    VALUES (@ticker, @stage, @peersJson, @anchorJson, @providerStatus, @detail, @partial, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      stage = excluded.stage,
      peers_json = excluded.peers_json,
      anchor_json = excluded.anchor_json,
      provider_status = excluded.provider_status,
      detail = excluded.detail,
      partial = excluded.partial,
      fetched_at = datetime('now')
  `).run({
    ticker,
    stage: stage ?? null,
    peersJson: JSON.stringify(peers || []),
    anchorJson: anchor ? JSON.stringify(anchor) : null,
    providerStatus,
    detail: detail ?? null,
    partial: partial ? 1 : 0
  });
}
