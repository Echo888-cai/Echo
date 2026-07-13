// Continuous research conversation, session management, reports and export.
import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Shell } from "../components/Shell";
import { AnswerCard } from "../components/AnswerCard";
import { Composer } from "../components/Composer";
import {
  useResearchStore,
  isViewBusy,
  activeRun,
  activeRunKey,
  busyElapsedSeconds,
  waitPhase,
  running,
  appendMessage,
  setResolving,
  type ResearchCompany
} from "../lib/researchStore";
import { sendChat, exportResearch, loadSession } from "../lib/researchActions";
import { markdownToHtml } from "../lib/markdown";
import { marketLabelOf } from "../lib/format";

import "@echo/ui/styles/03-research.css";

const EXPORT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v10" />
    <path d="M8 11l4 4 4-4" />
    <path d="M5 19.5h14" />
  </svg>
);

const PLACEHOLDER_INDUSTRY = new Set(["美股", "港股", "A股", "待补充", "待定", ""]);
function companySubtitle(company: ResearchCompany | null): string {
  if (!company) return "问一句就开始，复杂研究再沉到底层。";
  const mkt = marketLabelOf(company.ticker);
  const ind = company.industry || "";
  const realInd = PLACEHOLDER_INDUSTRY.has(ind) ? "" : ind;
  return [mkt, realInd].filter(Boolean).join(" · ") || mkt || company.ticker || "美股";
}

// EA-5.3: the companies visited within this conversation as switchable tabs —
// every company switched to under the same conversationId shows here; clicking
// one jumps to its research snapshot. Not rendered for single-company threads
// (no visual noise for the common case).
function CompanyTabs() {
  const store = useResearchStore();
  const navigate = useNavigate();
  const convId = store.conversationId;
  if (!convId) return null;
  const members = store.recentSessions.filter((s) => (s.conversationId || s.id) === convId);
  if (members.length <= 1) return null;
  const activeId = store.sessionId;
  return (
    <div className="company-tabs">
      {members.map((s) => {
        const isRunning = running.has(s.id);
        return (
          <button
            type="button"
            className={`company-tab ${s.id === activeId ? "is-active" : ""}`}
            key={s.id}
            onClick={() => void loadSession(s.id, () => navigate({ to: "/" }))}
          >
            <strong>{s.companyName || s.ticker || "研究对象"}</strong>
            <span>
              {isRunning ? (
                <>
                  <i className="session-spin" aria-hidden="true" />
                  生成中
                </>
              ) : (
                s.ticker || ""
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const GROUNDING_PENDING_SLOTS = ["行情", "财报", "新闻", "预期"];
function GroundingSkeleton() {
  return (
    <div className="grounding-bar grounding-pending" aria-hidden="true">
      {GROUNDING_PENDING_SLOTS.map((label) => (
        <span className="ground-chip pending" key={label}>
          {label}
          <i>·</i>
        </span>
      ))}
      <span className="ground-complete pending">完整度 —</span>
    </div>
  );
}

function WaitingCard() {
  return (
    <article className="message assistant">
      <div className="bubble answer-card wait-card">
        <div className="answer-brand">
          <div className="answer-mark">
            <i />
            <span>ECHO</span>
          </div>
        </div>
        <div className="wait-row">
          <span className="wait-orb" aria-hidden="true" />
          <strong>{activeRun()?.label || "正在检索和思考"}</strong>
          <em>
            已等待 <span>{busyElapsedSeconds()}</span>s
          </em>
        </div>
        <p className="wait-phase">{waitPhase()}</p>
        <div className="skeleton" aria-hidden="true">
          <div className="sk-line w-95" />
          <div className="sk-line w-75" />
          <div className="sk-card">
            <div className="sk-line sk-strong w-30" />
            <div className="sk-line w-90" />
            <div className="sk-line w-65" />
          </div>
          <div className="sk-line w-85" />
          <div className="sk-line w-55" />
        </div>
      </div>
    </article>
  );
}

// Streaming answer card: tokens are painted edge-to-edge with a blinking
// caret. Once `final` lands, appendMessage() renders the real answer card
// (with valuation/analyst/grounding) and this card disappears — a grounding
// skeleton up top reserves that card's height so nothing jumps.
function StreamingCard({ text }: { text: string }) {
  return (
    <article className="message assistant">
      <div className="bubble answer-card stream-card">
        <div className="answer-brand">
          <div className="answer-mark">
            <i />
            <span>ECHO</span>
          </div>
        </div>
        <GroundingSkeleton />
        <div className="ans-stream" dangerouslySetInnerHTML={{ __html: `${markdownToHtml(text)}<span class="stream-caret"></span>` }} />
      </div>
    </article>
  );
}

const EXAMPLES = [
  { name: "腾讯", ticker: "0700.HK", market: "港股", q: "腾讯最近怎么样？" },
  { name: "苹果", ticker: "AAPL", market: "美股", q: "苹果赚钱吗？" },
  { name: "英伟达", ticker: "NVDA", market: "美股", q: "英伟达的护城河在哪？" },
  { name: "贵州茅台", ticker: "600519.SS", market: "A股", q: "贵州茅台靠什么赚钱？" }
];
const CAPS = ["赚钱机制", "护城河", "竞争格局", "估值赔率", "什么会证伪"];

function EmptyState({ onExample }: { onExample: (q: string) => void }) {
  return (
    <div className="empty-chat">
      <div className="hero-head">
        <p className="hero-eyebrow">
          <span className="hero-spark" />
          ECHO RESEARCH · 发现真正的价值
        </p>
        <h2>
          喧声之外，
          <br />
          见真知。<span className="hero-slogan-en">Seek signal. Ignore noise.</span>
        </h2>
        <p className="hero-sub">A 股、港股、美股与全球科技资产的 AI 价值研究。从财报、估值、新闻与行业趋势里提取真正有价值的信号，一句话就开始，复杂研究再沉到底层。</p>
        <div className="hero-caps">
          {CAPS.map((c) => (
            <span className="cap-pill" key={c}>
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className="example-grid">
        {EXAMPLES.map((item) => (
          <button className="example-card" type="button" onClick={() => onExample(item.q)} key={item.ticker}>
            <span className="ex-head">
              <strong>{item.name}</strong>
              <span className={`ex-badge ${item.market === "美股" ? "us" : item.market === "A股" ? "cn" : "hk"}`}>{item.market}</span>
            </span>
            <span className="ex-ticker">{item.ticker}</span>
            <span className="ex-q">{item.q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ResearchPage() {
  const store = useResearchStore();
  const { company, thread } = store;
  const hasResearch = Boolean(company || thread.length);
  const busy = isViewBusy();
  const streaming = store.streamingKey && store.streamingKey === activeRunKey();
  const convRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(thread.length);

  // Follow the conversation to the bottom on new messages, but only when the
  // Keep streaming readable without stealing scroll from someone reviewing evidence.
  // behavior (keepScroll for the streaming→final transition is implicit here
  // since that transition doesn't change thread.length).
  useEffect(() => {
    if (thread.length !== prevLenRef.current) {
      prevLenRef.current = thread.length;
      const el = convRef.current;
      if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    }
  }, [thread.length]);

  // The document-level listener only blocks on
  // the *current* session being busy — a different session running in the
  // background doesn't block asking here or starting a new one (parallel
  // conversations).
  async function handleAsk(q: string) {
    if (!q || isViewBusy()) return;
    appendMessage("user", q);
    setResolving(true, "正在检索和思考");
    try {
      await sendChat(q);
    } catch (error) {
      appendMessage("assistant", `这轮研究失败：${error instanceof Error ? error.message : "未知错误"}。`);
    } finally {
      setResolving(false);
    }
  }

  return (
    <Shell>
      <section className="desk">
        {hasResearch ? (
          <div className="desk-head">
            <div>
              <p>Echo Research</p>
              <h1>{company ? `${company.nameZh} ${company.ticker}` : "输入公司，开始判断"}</h1>
              <span>{companySubtitle(company)} </span>
            </div>
            {thread.length ? (
              <button className="desk-export-btn" type="button" aria-label="导出研究" title="导出研究" onClick={exportResearch}>
                {EXPORT_ICON}
              </button>
            ) : null}
          </div>
        ) : null}
        <CompanyTabs />
        <div className={`conversation ${hasResearch ? "" : "is-empty"}`} ref={convRef}>
          {thread.length ? thread.map((m) => <AnswerCard message={m} key={m.id} />) : <EmptyState onExample={handleAsk} />}
          {streaming ? <StreamingCard text={store.streamingText} /> : busy ? <WaitingCard /> : null}
        </div>
        <Composer company={company} resolvingLabel={store.resolvingLabel} busySeconds={busyElapsedSeconds()} onSubmit={handleAsk} />
      </section>
    </Shell>
  );
}
