import { getLatestMarketSnapshot, saveMarketSnapshot } from "@echo/db/repositories/companyRepository.js";
import { fetchLiveQuote } from "@echo/data-plane";

export type MarketSnapshot = NonNullable<Awaited<ReturnType<typeof getLatestMarketSnapshot>>>;

// 快照新鲜度按 knowledge time（我们上次核对的时间）判断，而不是 valid time：
// 收盘后行情本身不再更新，但 15 分钟内核对过一次就不必重复打外部源。
const FRESH_WINDOW_MS = 15 * 60_000;

const inflight = new Map<string, Promise<MarketSnapshot | null>>();

/** 强制从外部行情源取一次报价并写入 market_snapshots（双时态追加）。 */
export async function refreshMarketSnapshot(ticker: string): Promise<MarketSnapshot | null> {
  const { result } = await fetchLiveQuote(ticker);
  if (result.price == null) return null;
  await saveMarketSnapshot(result);
  return getLatestMarketSnapshot(ticker);
}

/**
 * 持仓/关注/研究读取行情的唯一入口：缓存新鲜直接用；过期或缺失则实时拉取。
 * 外部源失败时退回旧快照（as_of 如实展示旧口径），核不到就是 null，不编数。
 */
export async function ensureFreshMarketSnapshot(ticker: string): Promise<MarketSnapshot | null> {
  const cached = await getLatestMarketSnapshot(ticker);
  if (cached && Date.now() - Date.parse(cached.created_at) < FRESH_WINDOW_MS) return cached;
  const key = ticker.trim().toUpperCase();
  let pending = inflight.get(key);
  if (!pending) {
    pending = refreshMarketSnapshot(ticker)
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return (await pending) || cached;
}
