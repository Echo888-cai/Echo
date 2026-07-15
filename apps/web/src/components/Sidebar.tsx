// Global research snapshot, watch context and grouped session history.
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { watchApi } from "../lib/api";
import {
  useResearchStore,
  setHistoryOpen,
  running,
  type RecentSession
} from "../lib/researchStore";
import { refreshSessions, deleteSession, clearAllSessions, loadSession, clearResearch } from "../lib/researchActions";
import { marketLabelOf, isNum, fmtSigned, dirClass, fmtPct, pnlDir } from "../lib/format";

function SnapshotCard({ company, panel, thread }: { company: any; panel: any; thread: any[] }) {
  const name = panel?.companyName || company?.nameZh || "未选择公司";
  const ticker = company?.ticker || panel?.ticker || "";
  const marketLabel = marketLabelOf(ticker);
  const confLevel = panel?.confidence === "高" ? "high" : panel?.confidence === "低" ? "low" : "mid";

  const focusOthers = (() => {
    if (!Array.isArray(thread)) return [];
    for (let i = thread.length - 1; i >= 0; i--) {
      const m = thread[i];
      if (m?.role === "assistant" && Array.isArray(m.meta?.otherHoldings) && m.meta.otherHoldings.length) return m.meta.otherHoldings;
    }
    return [];
  })();
  const focusLabel = focusOthers.length ? "本轮聚焦" : "研究公司";

  const priceRaw = panel?.price?.value && panel.price.value !== "暂不可用" ? String(panel.price.value) : "";
  const [priceNum, ...ccyParts] = priceRaw.split(" ");
  const ccy = ccyParts.join(" ");
  const changeRaw = panel?.price?.change && panel.price.change !== "暂不可用" ? String(panel.price.change) : "";
  const chgNum = parseFloat(changeRaw);
  const chgDir = !changeRaw || Number.isNaN(chgNum) ? "is-flat" : chgNum > 0 ? "is-up" : chgNum < 0 ? "is-down" : "is-flat";
  const chgText = changeRaw ? (chgNum > 0 && !changeRaw.startsWith("+") ? `+${changeRaw}` : changeRaw) : "";

  const metricValue = (metricName: string) => {
    const found = (panel?.metrics || []).find((item: any) => item.name === metricName);
    const value = found?.value;
    return value && value !== "暂不可用" ? String(value) : "";
  };
  const pe = metricValue("PE");
  const cap = metricValue("市值");
  const ranges = panel?.price?.ranges || null;
  const pctChip = (label: string, pct: number | null | undefined) => {
    if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
    const n = Number(pct);
    const dir = n > 0 ? "is-up" : n < 0 ? "is-down" : "is-flat";
    return (
      <div className="snapshot-metric" key={label}>
        <span>{label}</span>
        <strong className={`rng ${dir}`}>
          {n > 0 ? "+" : ""}
          {n}%
        </strong>
      </div>
    );
  };

  const dual = company?.dualListing;
  const askedHk = !!(dual && dual.asked && /\.HK$/i.test(dual.asked));

  return (
    <section className="research-snapshot">
      <div className="snapshot-head">
        <div className="snapshot-id">
          <p>{focusLabel}</p>
          <h2>{name}</h2>
          <span>{ticker ? `${ticker}${marketLabel ? ` · ${marketLabel}` : ""}` : "输入公司名、港股或美股代码"}</span>
        </div>
        {panel?.confidence ? (
          <span className={`conf conf-${confLevel}`} title={panel.confidenceNote || undefined}>
            置信度 {panel.confidence}
            {panel.confidenceNote ? " ⓘ" : ""}
          </span>
        ) : null}
      </div>
      {focusOthers.length ? (
        <div className="focus-mini">
          <span className="fm-chip fm-main">{ticker || name}</span>
          {focusOthers.map((h: any, i: number) => (
            <span className="fm-chip" key={i}>
              {h.ticker || h.name}
              {isNum(h.pnlPct) ? <em className={dirClass(h.pnlPct)}> {fmtSigned(h.pnlPct)}</em> : null}
            </span>
          ))}
        </div>
      ) : null}
      {dual ? (
        <div
          className="snapshot-dual"
          title={`同一家公司在港股和美股双重上市；FMP 免费档只覆盖美股 ADR，所以基本面与估值统一按美股口径。${askedHk ? "你问的是港股，盈亏请按港股价 + HKD 成本算。" : "行情两地可分别查。"}`}
        >
          <span className="dual-badge">双重上市</span>
          <span className="dual-text">
            港股 {dual.hk}｜美股 {dual.us} · 基本面按美股 ADR 口径{askedHk ? "；你问港股 → 盈亏按港股口径" : ""}
          </span>
        </div>
      ) : null}
      {priceNum ? (
        <div className="snapshot-quote">
          <span className="price">{priceNum}</span>
          {ccy ? <span className="ccy">{ccy}</span> : null}
          {chgText ? <span className={`chg ${chgDir}`}>{chgText}</span> : null}
        </div>
      ) : null}
      {pe || cap || ranges ? (
        <div className="snapshot-metrics">
          {pe ? (
            <div className="snapshot-metric">
              <span>TTM PE</span>
              <strong>{pe}</strong>
            </div>
          ) : null}
          {cap ? (
            <div className="snapshot-metric">
              <span>市值</span>
              <strong>{cap}</strong>
            </div>
          ) : null}
          {ranges ? pctChip("近1月", ranges.oneMonthPct) : null}
          {ranges ? pctChip("年初至今", ranges.ytdPct) : null}
        </div>
      ) : null}
    </section>
  );
}

const CTX_STATUS: Record<string, { label: string; cls: string }> = {
  falsified: { label: "已触发证伪", cls: "wd-falsified" },
  at_risk: { label: "有风险", cls: "wd-risk" },
  intact: { label: "逻辑还在", cls: "wd-intact" }
};

// EA-5.4: current company's watch-desk status + position P&L, read from the
// already-shared ["watch","desk"] query cache (same key /watch uses) rather
// than firing a dedicated request.
function ContextCard({ company }: { company: any }) {
  const deskQuery = useQuery({ queryKey: ["watch", "desk"], queryFn: () => watchApi.desk() });
  if (!company?.ticker) return null;
  const card = deskQuery.data?.desk?.cards?.find((c) => c.ticker === company.ticker);
  if (!card) return null;
  const st = CTX_STATUS[card.status] || CTX_STATUS.intact;
  return (
    <section className="context-card">
      <div className="context-row">
        <span>看盘状态</span>
        <span className={`wd-status ${st.cls}`}>{st.label}</span>
      </div>
      {card.held && typeof card.returnPct === "number" ? (
        <div className="context-row">
          <span>持仓盈亏</span>
          <b className={pnlDir(card.returnPct)}>{fmtPct(card.returnPct)}</b>
        </div>
      ) : (
        <div className="context-row is-muted">
          <span>持仓</span>
          <b>未持有</b>
        </div>
      )}
    </section>
  );
}

// EA-5.1: sessions sharing a conversationId (companies switched to within one
// continuous conversation) group under a shared header; single-session groups
// render as a flat row.
function groupSessionsForSidebar(sessions: RecentSession[]) {
  const groups = new Map<string, RecentSession[]>();
  for (const session of sessions) {
    const gid = session.conversationId || session.id;
    const list = groups.get(gid) || [];
    list.push(session);
    groups.set(gid, list);
  }
  return [...groups.values()];
}

function SessionItem({ session, activeSessionId, nested, isRunning, onLoad, onDelete }: { session: RecentSession; activeSessionId: string | null; nested: boolean; isRunning: boolean; onLoad: () => void; onDelete: () => void }) {
  const active = session.id === activeSessionId;
  const title = session.title || session.question || session.companyName || session.ticker || "未命名研究";
  const company = session.companyName || session.ticker || "研究对象";
  return (
    <div className={`session-item ${nested ? "is-nested" : ""} ${active ? "is-active" : ""} ${isRunning ? "is-running" : ""}`}>
      <button className="session-open" type="button" onClick={onLoad}>
        <strong>{nested ? company : title}</strong>
        <span>
          {isRunning ? (
            <>
              <i className="session-spin" aria-hidden="true" />
              正在生成…
            </>
          ) : nested ? (
            session.ticker || ""
          ) : (
            company
          )}
        </span>
      </button>
      {isRunning ? null : (
        <button className="session-delete" type="button" aria-label="删除历史研究" onClick={onDelete}>
          ×
        </button>
      )}
    </div>
  );
}

function SessionHistory() {
  const store = useResearchStore();
  const navigate = useNavigate();
  const activeSessionId = store.sessionId;
  const count = store.recentSessions.length;

  useEffect(() => {
    void refreshSessions();
    // Runs once per Shell mount (route navigation), not once-per-app-boot like
    // Keep sidebar history current after
    // e.g. deleting/loading a session on another tab.
  }, []);

  const toggle = (
    <button className={`history-toggle ${store.historyOpen ? "is-open" : ""}`} type="button" aria-expanded={store.historyOpen} onClick={() => setHistoryOpen(!store.historyOpen)}>
      <span>历史研究{count ? ` · ${count}` : ""}</span>
      <i>{store.historyOpen ? "收起" : "展开"}</i>
    </button>
  );

  if (!store.historyOpen) {
    return <section className="history-panel collapsed">{toggle}</section>;
  }

  const groups = groupSessionsForSidebar(store.recentSessions);
  const goto = (id: string) => void loadSession(id, () => navigate({ to: "/" }));

  return (
    <section className="history-panel">
      {toggle}
      {count ? (
        <div className="history-actions">
          <button type="button" onClick={() => void clearAllSessions()}>
            清空全部
          </button>
        </div>
      ) : null}
      {!store.sessionsLoaded ? (
        <div className="history-empty">正在读取历史...</div>
      ) : count ? (
        <div className="session-list">
          {groups.map((sessions) => {
            if (sessions.length <= 1) {
              const s = sessions[0];
              return <SessionItem key={s.id} session={s} activeSessionId={activeSessionId} nested={false} isRunning={running.has(s.id)} onLoad={() => goto(s.id)} onDelete={() => void deleteSession(s.id)} />;
            }
            const first = sessions[0];
            const groupTitle = first.title || first.question || first.companyName || "新研究";
            const activeInGroup = sessions.some((s) => s.id === activeSessionId);
            return (
              <div className={`conv-group ${activeInGroup ? "is-active-group" : ""}`} key={first.conversationId || first.id}>
                <div className="conv-group-head">
                  <strong>{groupTitle}</strong>
                  <span className="conv-count">{sessions.length} 家公司</span>
                </div>
                <div className="conv-companies">
                  {sessions.map((s) => (
                    <SessionItem key={s.id} session={s} activeSessionId={activeSessionId} nested isRunning={running.has(s.id)} onLoad={() => goto(s.id)} onDelete={() => void deleteSession(s.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="history-empty">还没有历史研究。完成第一轮回答后会自动保存。</div>
      )}
    </section>
  );
}

export function Sidebar() {
  const store = useResearchStore();
  const navigate = useNavigate();
  return (
    <aside className="sidebar">
      <button className="primary wide" type="button" onClick={() => clearResearch(() => navigate({ to: "/" }))}>
        新建研究
      </button>
      <SnapshotCard company={store.company} panel={store.panel} thread={store.thread} />
      <ContextCard company={store.company} />
      <SessionHistory />
      <div className="sidebar-tagline">
        <b>Seek signal. Ignore noise.</b>
        喧声之外，见真知。研究参考，非投资建议。
      </div>
    </aside>
  );
}
