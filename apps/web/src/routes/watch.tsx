// React port of src/ui/watch.js's renderWatchPage() — no ticker → desk list,
// ticker present → per-stock detail. Two-stage desk refresh (fast quote-only
// pass, then a full pass with events) is collapsed into a single react-query
// fetch here: TanStack Query's cache + refetch already gives "show stale data
// immediately, update when fresh data lands" for free, so the fast/full split
// (a hand-rolled version of the same idea) isn't needed on this stack.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { watchApi } from "../lib/api";
import { Shell } from "../components/Shell";
import { WatchListBody } from "../components/WatchList";
import { StockDetail } from "../components/StockDetail";

import "../../../../src/styles/06-watch.css";

export function WatchListPage() {
  const deskQuery = useQuery({
    queryKey: ["watch", "desk"],
    queryFn: () => watchApi.desk()
  });

  return (
    <Shell>
      <div className="page-wide">
        <WatchListBody desk={deskQuery.data?.desk ?? null} loaded={!deskQuery.isLoading} onRefetch={() => deskQuery.refetch()} />
      </div>
    </Shell>
  );
}

export function StockDetailPage({ ticker }: { ticker: string }) {
  const stockQuery = useQuery({
    queryKey: ["watch", "stock", ticker],
    queryFn: () => watchApi.stock(ticker)
  });

  let body;
  if (stockQuery.isLoading) {
    body = (
      <div className="stock-page">
        <Link className="back-link" to="/watch">
          ← 看盘
        </Link>
        <div className="wd-loading">正在加载 {ticker}…</div>
      </div>
    );
  } else if (!stockQuery.data?.stock) {
    body = (
      <div className="stock-page">
        <Link className="back-link" to="/watch">
          ← 看盘
        </Link>
        <div className="wd-loading">暂时无法加载 {ticker} 的数据。</div>
      </div>
    );
  } else {
    body = <StockDetail stock={stockQuery.data.stock} key={ticker} />;
  }

  return (
    <Shell>
      <div className="page-wide">{body}</div>
    </Shell>
  );
}
