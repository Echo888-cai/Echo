// Watch page: no ticker → desk list,
// ticker present → per-stock detail. Two-stage desk refresh (fast quote-only
// pass, then a full pass with events) is collapsed into a single react-query
// fetch here: TanStack Query's cache + refetch already gives "show stale data
// immediately, update when fresh data lands" for free, so the fast/full split
// (a hand-rolled version of the same idea) isn't needed on this stack.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { watchApi } from "../lib/api";
import { WatchListBody } from "../components/WatchList";
import { StockDetail } from "../components/StockDetail";
import { PageErrorState, PageSkeleton } from "../components/PageState";

import "@echo/ui/styles/06-watch.css";

export function WatchListPage() {
  const deskQuery = useQuery({
    queryKey: ["watch", "desk"],
    queryFn: () => watchApi.desk()
  });

  if (deskQuery.isLoading) {
    return <div className="page-wide"><PageSkeleton label="正在同步看盘信号" cards={6} /></div>;
  }

  if (deskQuery.isError) {
    return <div className="page-wide"><PageErrorState title="看盘数据暂时没有响应" description="你的关注列表没有丢失。请检查服务连接后重新读取。" onRetry={() => void deskQuery.refetch()} /></div>;
  }

  return (
    <div className="page-wide">
      <WatchListBody desk={deskQuery.data?.desk ?? null} loaded={!deskQuery.isLoading} onRefetch={() => deskQuery.refetch()} />
    </div>
  );
}

export function StockDetailPage({ ticker }: { ticker: string }) {
  const stockQuery = useQuery({
    queryKey: ["watch", "stock", ticker],
    queryFn: () => watchApi.stock(ticker)
  });

  let body;
  if (stockQuery.isLoading) {
    body = <PageSkeleton label={`正在读取 ${ticker} 的证据与行情`} cards={4} />;
  } else if (stockQuery.isError) {
    body = <PageErrorState title={`暂时无法读取 ${ticker}`} description="行情与研究资料仍保留在服务端，重新连接不会改变任何看盘状态。" onRetry={() => void stockQuery.refetch()} />;
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

  return <div className="page-wide">{body}</div>;
}
