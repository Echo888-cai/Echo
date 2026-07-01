/**
 * watchlist repository — 看盘的手动关注偏好。
 *
 * 看盘的基础自选是自动算的 = 研究过的公司（画像）∪ 持仓。这张表在其上叠加**手动增删**：
 *   mode='add'  手动加入（哪怕没研究过、没持仓，也想盯着）
 *   mode='hide' 手动移除（哪怕研究过 / 持有，也不想在看盘里看到）
 * 最终自选 = (自动 ∪ add) − hide。add / hide 互斥，同一 ticker 只留最后一次意图。
 */

import { getDb } from "../../db/index.js";
import { normalizeTicker } from "../../data.js";

let ensured = false;
function ensureTable() {
  if (ensured) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS watchlist_prefs (
      ticker       TEXT PRIMARY KEY,
      company_name TEXT,
      mode         TEXT NOT NULL DEFAULT 'add',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

/** 手动加入的 [{ ticker, nameZh }]（最近加的在前）。 */
export function listWatchAdds() {
  ensureTable();
  return getDb()
    .prepare("SELECT ticker, company_name FROM watchlist_prefs WHERE mode = 'add' ORDER BY created_at DESC")
    .all()
    .map((r) => ({ ticker: r.ticker, nameZh: r.company_name || r.ticker }));
}

/** 被手动隐藏的 ticker 集合。 */
export function getHiddenTickers() {
  ensureTable();
  return new Set(getDb().prepare("SELECT ticker FROM watchlist_prefs WHERE mode = 'hide'").all().map((r) => r.ticker));
}

/** 加入关注：写 add（覆盖可能存在的 hide）。 */
export function addToWatch(ticker, name) {
  ensureTable();
  const t = normalizeTicker(ticker);
  if (!t) return false;
  getDb()
    .prepare(`
      INSERT INTO watchlist_prefs (ticker, company_name, mode, created_at)
      VALUES (?, ?, 'add', datetime('now'))
      ON CONFLICT(ticker) DO UPDATE SET
        mode = 'add',
        company_name = COALESCE(excluded.company_name, watchlist_prefs.company_name),
        created_at = datetime('now')
    `)
    .run(t, name || null);
  return true;
}

/** 移出关注：写 hide（连"自动来源"也一起挡掉，覆盖可能存在的 add）。 */
export function removeFromWatch(ticker) {
  ensureTable();
  const t = normalizeTicker(ticker);
  if (!t) return false;
  getDb()
    .prepare(`
      INSERT INTO watchlist_prefs (ticker, company_name, mode, created_at)
      VALUES (?, NULL, 'hide', datetime('now'))
      ON CONFLICT(ticker) DO UPDATE SET mode = 'hide', created_at = datetime('now')
    `)
    .run(t);
  return true;
}
