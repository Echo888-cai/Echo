// Shared research state and parallel in-flight runs keyed by session.
// Kept module-level because the sidebar and research page both need to
// read/react to the same "what's the active company / is anything running"
// truth, and several actions (sendChat, comparisons, deep research) run
// entirely outside any component's lifecycle — they're triggered by a submit
// handler and keep mutating state after the triggering component might have
// unmounted (switching to another session mid-run). useSyncExternalStore lets
// components subscribe to this without prop-drilling through Shell.
import { useSyncExternalStore } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: Record<string, any>;
  createdAt: string;
}

export interface ResearchCompany {
  ticker: string;
  nameZh?: string;
  nameEn?: string;
  industry?: string;
  /** 港美双重上市：chosen 是用户选定（或显式点名）的分析腿，另一腿仅作对照。 */
  dualListing?: { hk: string; us: string; chosen: string };
}

export interface RecentSession {
  id: string;
  title?: string;
  question?: string;
  companyName?: string;
  ticker?: string;
  conversationId?: string;
  updatedAt: string;
  optimistic?: boolean;
  [key: string]: any;
}

function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function genSessionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? `s_${crypto.randomUUID()}` : uid("s");
}

const storeKeys = {
  thread: "echo.v3.thread",
  company: "echo.v3.company",
  panel: "echo.v3.panel",
  documents: "echo.v3.documents",
  sessionId: "echo.v3.sessionId",
  conversationId: "echo.v3.conversationId"
};

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clearStore(key: string) {
  localStorage.removeItem(key);
}

function normalizeMessage(message: Message): Message {
  return { ...message, id: message.id || uid("msg") };
}

// ── snapshot (the useSyncExternalStore-visible slice) ──────────────────────
interface Snapshot {
  thread: Message[];
  company: ResearchCompany | null;
  panel: any | null;
  documents: any[];
  sessionId: string | null;
  conversationId: string | null;
  recentSessions: RecentSession[];
  sessionsLoaded: boolean;
  resolving: boolean;
  resolvingLabel: string;
  streamingKey: string | null;
  streamingText: string;
}

let state: Snapshot = {
  thread: readStore<Message[]>(storeKeys.thread, []).map(normalizeMessage),
  company: readStore(storeKeys.company, null),
  panel: readStore(storeKeys.panel, null),
  documents: readStore(storeKeys.documents, []),
  sessionId: readStore(storeKeys.sessionId, null),
  conversationId: readStore(storeKeys.conversationId, null),
  recentSessions: [],
  sessionsLoaded: false,
  resolving: false,
  resolvingLabel: "正在检索和思考",
  streamingKey: null,
  streamingText: ""
};

const listeners = new Set<() => void>();
function emit() {
  state = { ...state };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Snapshot {
  return state;
}

export function useResearchStore(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── getters/setters (mirror state.js's get*/set* pairs) ─────────────────────
export function getThread() {
  return state.thread;
}
export function setThread(thread: Message[]) {
  const sliced = thread.slice(-80).map(normalizeMessage);
  writeStore(storeKeys.thread, sliced);
  state.thread = sliced;
  emit();
}
export function getCompany() {
  return state.company;
}
export function setCompany(company: ResearchCompany | null) {
  writeStore(storeKeys.company, company);
  state.company = company;
  emit();
}
export function getPanel() {
  return state.panel;
}
export function setPanel(panel: any) {
  writeStore(storeKeys.panel, panel);
  state.panel = panel;
  emit();
}
export function getDocuments() {
  return state.documents;
}
export function setDocuments(documents: any[]) {
  const sliced = documents.slice(-12);
  writeStore(storeKeys.documents, sliced);
  state.documents = sliced;
  emit();
}
export function getSessionId() {
  return state.sessionId;
}
export function setSessionId(id: string | null) {
  if (id) writeStore(storeKeys.sessionId, id);
  else clearStore(storeKeys.sessionId);
  state.sessionId = id;
  emit();
}
export function getConversationId() {
  return state.conversationId;
}
export function setConversationId(id: string | null) {
  if (id) writeStore(storeKeys.conversationId, id);
  else clearStore(storeKeys.conversationId);
  state.conversationId = id;
  emit();
}
export function ensureConversationId(): string {
  let id = getConversationId();
  if (!id) {
    id = genSessionId();
    setConversationId(id);
  }
  return id;
}
export function ensureSessionId(): string {
  let id = getSessionId();
  if (!id) {
    id = genSessionId();
    setSessionId(id);
  }
  return id;
}

export function setRecentSessions(sessions: RecentSession[]) {
  state.recentSessions = sessions;
  emit();
}
export function getRecentSessions() {
  return state.recentSessions;
}
export function setSessionsLoaded(loaded: boolean) {
  state.sessionsLoaded = loaded;
  emit();
}
export function setResolving(resolving: boolean, label = "正在检索和思考") {
  state.resolving = resolving;
  state.resolvingLabel = label;
  emit();
}

// Optimistically insert/update a session in the sidebar list (doesn't wait for
// the server). Spinner state comes from `running.has(id)`; refreshSessions()
// later reconciles by id, server version wins.
export function optimisticSession(id: string, opts: { company?: ResearchCompany | null; question?: string; conversationId?: string } = {}) {
  const { company, question, conversationId } = opts;
  const existing = state.recentSessions.find((s) => s.id === id);
  const entry: RecentSession = {
    ...existing,
    id,
    title: existing?.title || String(question || "新研究").slice(0, 80),
    question: existing?.question || question || "",
    companyName: company?.nameZh || company?.ticker || existing?.companyName || "",
    ticker: company?.ticker || existing?.ticker || "",
    conversationId: conversationId || existing?.conversationId || id,
    updatedAt: new Date().toISOString(),
    optimistic: true
  };
  setRecentSessions([entry, ...state.recentSessions.filter((s) => s.id !== id)]);
}

// ── parallel runs ────────────────────────────────────────────────────────
interface Run {
  label: string;
  startedAt: number;
  reasoningChars: number;
  stage: string | null;
  plan: string[];
  /** 取消这一轮的把手。实测一轮研究 13–21s，深度报告 21s+，期间 isViewBusy() 会让追问/
   *  切换/对比全部 early-return——没有这个把手，用户打错一个字母就只能干等 20 秒。
   *  每个 run 各自持有，因为多轮研究是并行的（backgrounded run 也要能单独停）。 */
  controller: AbortController | null;
  snapshot: { thread: Message[]; company: ResearchCompany | null; panel: any; sessionId: string | null; conversationId: string | null };
}

export const running = new Map<string, Run>();
let busyTimer: ReturnType<typeof setInterval> | null = null;

export function runKey(sessionId: string | null, ticker?: string | null): string {
  return sessionId || (ticker ? `new:${ticker}` : "new");
}
export function activeRunKey(): string {
  return runKey(getSessionId(), getCompany()?.ticker);
}
export function activeRun(): Run | null {
  return running.get(activeRunKey()) || null;
}
export function isActiveBusy(): boolean {
  return running.has(activeRunKey());
}
export function isViewBusy(): boolean {
  return state.resolving || isActiveBusy();
}
function snapshotActive() {
  return { thread: getThread(), company: getCompany(), panel: getPanel(), sessionId: getSessionId(), conversationId: getConversationId() };
}

export function startRun(key: string, label = "正在检索和思考", controller: AbortController | null = null) {
  running.set(key, { label, startedAt: Date.now(), reasoningChars: 0, stage: null, plan: [], controller, snapshot: snapshotActive() });
  state.resolving = false;
  if (!busyTimer) busyTimer = setInterval(() => emit(), 1000);
  emit();
}

/** 用户点了停止。只负责 abort——收尾（endRun / 提示）由 run 自己的 finally 走，
 *  这样"取消"和"正常结束"共用同一条收尾路径，不会漏掉 refreshSessions 之类的步骤。 */
export function abortRun(key: string) {
  running.get(key)?.controller?.abort();
}
export function abortActiveRun() {
  abortRun(activeRunKey());
}
/** 当前前台这轮能不能停（没有 controller 的轮次——如深度报告的非流式调用——不显示停止按钮，
 *  显示一个点不动的按钮比没有按钮更糟）。 */
export function canAbortActive(): boolean {
  return Boolean(activeRun()?.controller);
}
export function endRun(key: string) {
  running.delete(key);
  if (state.streamingKey === key) {
    state.streamingKey = null;
    state.streamingText = "";
  }
  if (!running.size && busyTimer) {
    clearInterval(busyTimer);
    busyTimer = null;
  }
  emit();
}

export function busyElapsedSeconds(): number {
  const startedAt = activeRun()?.startedAt || 0;
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

// Stage names must match the onStage callback fired from runResearch
// (packages/application/src/research.ts) via the /api/ask SSE "status" event —
// this is a copy of the pipeline's real steps, not a decorative clock-driven
// carousel, so it stays honest about what the backend is actually doing.
const STAGE_LABELS: Record<string, string> = {
  routing: "正在识别问题意图与研究深度",
  resolving: "正在定位公司",
  market_financials: "正在读取行情与财务数据",
  evidence: "正在交叉核验公开证据",
  valuation: "正在计算估值区间",
  generating: "模型正在生成回答",
  fact_check: "正在核对数字与来源"
};

export function setStage(key: string, stage: string, plan?: string[]) {
  const r = running.get(key);
  if (r) {
    r.stage = stage;
    if (plan?.length) r.plan = plan;
  }
  if (key === activeRunKey()) emit();
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage;
}

export function waitPhase(): string {
  const run = activeRun();
  const rc = run?.reasoningChars || 0;
  const streaming = state.streamingKey && state.streamingKey === activeRunKey();
  if (rc > 0 && !streaming) return `模型正在推理 · 已 ${rc} 字`;
  const stage = run?.stage;
  return (stage && STAGE_LABELS[stage]) || "正在检索和思考";
}

export function setStreaming(key: string | null, text: string) {
  state.streamingKey = key;
  state.streamingText = text;
  emit();
}
export function addReasoningChars(key: string, n: number) {
  const r = running.get(key);
  if (r) r.reasoningChars += n;
  if (key === activeRunKey()) emit();
}

// appendMessage doesn't scroll here; the
// conversation view component handles scroll-follow via a ref + effect on
// thread length change, since that's the idiomatic React way to react to a
// list growing rather than reaching into the DOM from the store.
export function appendMessage(role: Message["role"], content: string, meta: Record<string, any> = {}): Message {
  const message: Message = { id: uid("msg"), role, content, meta, createdAt: new Date().toISOString() };
  setThread([...getThread(), message]);
  return message;
}

export function currentRunSnapshot() {
  return snapshotActive();
}
