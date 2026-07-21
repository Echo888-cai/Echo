//! Echo Research 研究页（Leptos/WASM）。
//!
//! 暗底 #02070a + 青色 #82e7ee + 楷体衬线大标题 + 对话式研究布局。
//! DOM 结构复用 .desk/.conversation/.message/.bubble/.answer-card 语义层次。
//!
//! 作答走类型化 SSE（`/api/ask/stream`）：meta（路由/估值骨架）→ stage（组装/生成/核对/落库）
//! → delta（打字机增量）→ guard（数字护栏）→ final（落库结果）；`error` 或连接异常归一到失败态。

use crate::api;
use echo_contracts::{
    AskRequest, AskResponse, Decimal, GuardView, MutationResponse, ResearchSessionDetail,
    ResearchSessionResponse, ResearchSessionsResponse, ResearchStreamEvent,
    ResearchStreamStageName, RouteView, ValuationView,
};
use leptos::*;

/// 一轮的终态或进行态。`Streaming` 里的字段随 SSE 事件逐步填充。
#[derive(Clone)]
enum TurnStatus {
    Streaming {
        stage: Option<ResearchStreamStageName>,
        meta_route: Option<RouteView>,
        meta_valuation: Option<ValuationView>,
        meta_completeness: Option<u8>,
        meta_sources: Vec<String>,
        delta_text: String,
        guard: Option<GuardView>,
    },
    Done(AskResponse),
    /// 从历史会话加载——字段比 [`AskResponse`] 更少（未持久化路由/完备度/护栏明细），
    /// 缺的就是缺的，不拿假数据补全。
    Loaded(ResearchSessionDetail),
    Failed(String),
    Cancelled,
}

impl TurnStatus {
    fn streaming_default() -> Self {
        Self::Streaming {
            stage: None,
            meta_route: None,
            meta_valuation: None,
            meta_completeness: None,
            meta_sources: Vec::new(),
            delta_text: String::new(),
            guard: None,
        }
    }

    fn is_streaming(&self) -> bool {
        matches!(self, Self::Streaming { .. })
    }
}

/// 一条对话轮——用户问题 + 助手作答的当前状态。
#[derive(Clone)]
struct Turn {
    /// 提交时分配的唯一 id——SSE 回调按 id 归位，不按“最后一条”猜测。
    id: u64,
    question: String,
    ticker: String,
    status: TurnStatus,
    /// 仍在流式进行时持有取消句柄；终态后清空，避免悬空取消一个已结束的请求。
    handle: Option<api::StreamHandle>,
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn intent_label(s: &str) -> &str {
    match s {
        "valuation" => "估值判断",
        "financial_quality" => "利润质量",
        "moat" => "护城河",
        "falsification" => "证伪条件",
        "comparison" => "对比研究",
        "momentum" => "动量与预期",
        "risk" => "风险与赔率",
        "thesis" => "多空逻辑",
        _ => "综合研究",
    }
}

fn stage_label(stage: Option<ResearchStreamStageName>) -> &'static str {
    match stage {
        None => "正在组装事实…",
        Some(ResearchStreamStageName::Assembling) => "正在组装事实…",
        Some(ResearchStreamStageName::Generating) => "正在生成作答…",
        Some(ResearchStreamStageName::Verifying) => "正在核对数字护栏…",
        Some(ResearchStreamStageName::Persisting) => "正在落库…",
    }
}

fn decimal_text(value: Option<Decimal>) -> String {
    value
        .map(|decimal| decimal.normalize().to_string())
        .unwrap_or_else(|| "—".to_string())
}

/// 推入一条新的 pending turn 并接上类型化 SSE 流。
/// `on_persisted`——落库完成（Final 到达）后触发，驱动侧栏刷新，新研究即时出现在历史列表里。
fn start_turn(
    id: u64,
    question: String,
    ticker: String,
    set_thread: WriteSignal<Vec<Turn>>,
    on_persisted: Callback<()>,
) {
    set_thread.update(|v| {
        v.push(Turn {
            id,
            question: question.clone(),
            ticker: ticker.clone(),
            status: TurnStatus::streaming_default(),
            handle: None,
        });
    });
    attach_stream(id, question, ticker, set_thread, on_persisted);
}

/// 重试：把已存在的 turn（取消/失败终态）原地重置为 streaming，而不是追加新 turn。
fn retry_turn(
    id: u64,
    question: String,
    ticker: String,
    set_thread: WriteSignal<Vec<Turn>>,
    on_persisted: Callback<()>,
) {
    set_thread.update(|v| {
        if let Some(turn) = v.iter_mut().find(|t| t.id == id) {
            turn.status = TurnStatus::streaming_default();
            turn.handle = None;
        }
    });
    attach_stream(id, question, ticker, set_thread, on_persisted);
}

/// 把一次研究请求接到类型化 SSE 流上：事件回来后按 `id` 精确回填对应 turn，
/// 迟到事件（turn 已是别的终态）一律忽略。
fn attach_stream(
    id: u64,
    question: String,
    ticker: String,
    set_thread: WriteSignal<Vec<Turn>>,
    on_persisted: Callback<()>,
) {
    let req = AskRequest::minimal(question, ticker);

    let on_event = move |event: ResearchStreamEvent| {
        set_thread.update(|v| {
            let Some(turn) = v.iter_mut().find(|t| t.id == id) else {
                return;
            };
            if !turn.status.is_streaming() {
                return; // 已取消/完成/失败，忽略迟到事件
            }
            match event {
                ResearchStreamEvent::Final(f) => {
                    turn.status = TurnStatus::Done(f.response);
                    turn.handle = None;
                    on_persisted.call(());
                    return;
                }
                ResearchStreamEvent::Error(e) => {
                    turn.status = TurnStatus::Failed(e.message);
                    turn.handle = None;
                    return;
                }
                _ => {}
            }
            let TurnStatus::Streaming {
                stage,
                meta_route,
                meta_valuation,
                meta_completeness,
                meta_sources,
                delta_text,
                guard,
            } = &mut turn.status
            else {
                return;
            };
            match event {
                ResearchStreamEvent::Meta(m) => {
                    *meta_route = Some(m.route);
                    *meta_valuation = Some(m.valuation);
                    *meta_completeness = Some(m.data_completeness);
                    *meta_sources = m.connected_sources;
                }
                ResearchStreamEvent::Stage(s) => *stage = Some(s.name),
                ResearchStreamEvent::Delta(d) => delta_text.push_str(&d.text),
                ResearchStreamEvent::Guard(g) => *guard = g.fact_guard,
                ResearchStreamEvent::Final(_) | ResearchStreamEvent::Error(_) => unreachable!(),
            }
        });
    };

    let on_error = move |message: String| {
        set_thread.update(|v| {
            if let Some(turn) = v.iter_mut().find(|t| t.id == id) {
                if turn.status.is_streaming() {
                    turn.status = TurnStatus::Failed(message);
                    turn.handle = None;
                }
            }
        });
    };

    let handle = api::post_stream("/api/ask/stream", &req, on_event, on_error);
    set_thread.update(|v| {
        if let Some(turn) = v.iter_mut().find(|t| t.id == id) {
            if turn.status.is_streaming() {
                turn.handle = Some(handle);
            }
        }
    });
}

// ── Components ────────────────────────────────────────────────────────────

/// 估值三段带（bear / base / bull）。
#[component]
fn ValuationBand(v: ValuationView) -> impl IntoView {
    if let Some(reason) = v.cannot_value_reason.clone() {
        return view! {
            <div class="valuation-block">
                <div class="valuation-head"><span>"估值区间"</span></div>
                <p class="val-none">"未核到 · " {reason}</p>
            </div>
        }
        .into_view();
    }
    view! {
        <div class="valuation-block">
            <div class="valuation-head">
                <span>"估值区间"</span>
                <em>{v.method.clone()}</em>
            </div>
            <div class="val-bands">
                <div class="val-cell">
                    <span class="val-k">"熊"</span>
                    <span class="val-v">{decimal_text(v.bear)}</span>
                </div>
                <div class="val-cell base-cell">
                    <span class="val-k">"基准"</span>
                    <span class="val-v">{decimal_text(v.base)}</span>
                </div>
                <div class="val-cell">
                    <span class="val-k">"牛"</span>
                    <span class="val-v">{decimal_text(v.bull)}</span>
                </div>
            </div>
            {v.upside.clone().map(|u| view! {
                <p class="val-upside">"相对现价 " <strong>{u}</strong></p>
            })}
        </div>
    }
    .into_view()
}

/// 路由意图 / 深度 / 置信度三个 chip——meta 到达即可展示，final 到达后原样复用。
#[component]
fn RouteChips(route: RouteView) -> impl IntoView {
    let conf = (route.confidence * 100.0).round() as u32;
    view! {
        <div class="ac-chips">
            <span class="ac-chip">{intent_label(&route.intent).to_string()}</span>
            <span class="ac-chip dim">{route.depth.clone()}</span>
            <span class="ac-chip dim">"置信 " {conf} "%"</span>
        </div>
    }
}

#[component]
fn CompletenessRow(completeness: u8) -> impl IntoView {
    view! {
        <div class="completeness-row">
            <div class="completeness-bar">
                <span class="completeness-fill" style=move || format!("width:{completeness}%")></span>
            </div>
            <span class="completeness-label">"数据完备度 " {completeness} "%"</span>
        </div>
    }
}

#[component]
fn DataSources(sources: Vec<String>) -> impl IntoView {
    if sources.is_empty() {
        return ().into_view();
    }
    view! {
        <div class="data-sources">
            {sources.into_iter().map(|s| view! {
                <span class="data-source">{s}</span>
            }).collect_view()}
        </div>
    }
    .into_view()
}

#[component]
fn GuardBadge(guard: GuardView) -> impl IntoView {
    let cls = if guard.has_hard_fail {
        "fact-guard has-hard"
    } else {
        "fact-guard"
    };
    view! {
        <div class=cls>
            <span class="fact-guard-k">"数字护栏"</span>
            <span>"核 " {guard.total} " · 过 " {guard.pass} " · 软 " {guard.soft} " · 硬 " {guard.hard}</span>
            {(!guard.soft_note.is_empty()).then(|| view! {
                <p class="fact-guard-note">{guard.soft_note.clone()}</p>
            })}
        </div>
    }
}

/// 流式进行中的卡片：已到的 meta 骨架 + 阶段提示 + 打字机增量 + 取消按钮。
#[component]
fn StreamingCard(
    stage: Option<ResearchStreamStageName>,
    meta_route: Option<RouteView>,
    meta_valuation: Option<ValuationView>,
    meta_completeness: Option<u8>,
    meta_sources: Vec<String>,
    delta_text: String,
    guard: Option<GuardView>,
    on_cancel: Callback<()>,
) -> impl IntoView {
    let html = (!delta_text.is_empty()).then(|| crate::markdown::render(&delta_text));
    view! {
        <div class="answer-card">
            <div class="answer-brand">
                <div class="answer-mark">
                    <i class="pulse"></i>
                    <span>"ECHO RESEARCH"</span>
                </div>
                {meta_route.clone().map(|route| view! { <RouteChips route=route /> })}
            </div>

            {meta_valuation.map(|v| view! { <ValuationBand v=v /> })}
            {meta_completeness.map(|c| view! { <CompletenessRow completeness=c /> })}
            <DataSources sources=meta_sources />

            <div class="answer-text-section">
                <p class="answer-source-label stage-label">
                    <span class="stage-dot"></span>
                    {stage_label(stage)}
                </p>
                {match html {
                    Some(html) => view! { <div class="answer-text" inner_html=html></div> }.into_view(),
                    None => view! { <p class="working-text">"正在研究…"</p> }.into_view(),
                }}
            </div>

            {guard.map(|g| view! { <GuardBadge guard=g /> })}

            <button class="stream-cancel" on:click=move |_| on_cancel.call(())>"取消"</button>
        </div>
    }
}

/// 干净完成后的答案卡——复用 meta 期同款 route/valuation/completeness/sources 展示块。
#[component]
fn DoneCard(res: AskResponse) -> impl IntoView {
    let completeness = res.data_completeness;
    view! {
        <div class="answer-card">
            <div class="answer-brand">
                <div class="answer-mark">
                    <i></i>
                    <span>"ECHO RESEARCH"</span>
                </div>
                <RouteChips route=res.route.clone() />
            </div>

            <ValuationBand v=res.valuation.clone() />
            <CompletenessRow completeness=completeness />
            <DataSources sources=res.connected_sources.clone() />

            <div class="answer-text-section">
                <p class="answer-source-label">"作答 · " {res.answer_source.as_str()}</p>
                {match res.answer.clone() {
                    Some(text) => {
                        let html = crate::markdown::render(&text);
                        view! { <div class="answer-text" inner_html=html></div> }.into_view()
                    }
                    None => view! {
                        <p class="answer-unavailable">
                            "未核到模型作答（未配 provider）——本轮只给结构化事实，不臆造。"
                        </p>
                    }.into_view(),
                }}
            </div>

            {res.fact_guard.clone().map(|g| view! { <GuardBadge guard=g /> })}
        </div>
    }
}

/// 从会话历史加载的答案卡——只展示落库时实际持久化过的字段（估值/数据源/作答文本），
/// 路由 chip、完备度、护栏明细当时未存，缺了就不画，不拿假数据充数。
#[component]
fn HistoryCard(detail: ResearchSessionDetail) -> impl IntoView {
    let valuation = detail
        .decision_panel
        .clone()
        .and_then(|value| serde_json::from_value::<ValuationView>(value).ok());
    let sources: Vec<String> = detail
        .data_sources
        .as_ref()
        .and_then(|value| value.get("connected").cloned())
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    let answer = detail
        .report_markdown
        .clone()
        .or_else(|| detail.full_research.clone());

    view! {
        <div class="answer-card">
            <div class="answer-brand">
                <div class="answer-mark">
                    <i></i>
                    <span>"ECHO RESEARCH"</span>
                </div>
                <span class="ac-chip dim">"历史记录 · " {detail.created_at.clone()}</span>
            </div>

            {valuation.map(|v| view! { <ValuationBand v=v /> })}
            <DataSources sources=sources />

            <div class="answer-text-section">
                <p class="answer-source-label">"作答 · 历史存档"</p>
                {match answer {
                    Some(text) => {
                        let html = crate::markdown::render(&text);
                        view! { <div class="answer-text" inner_html=html></div> }.into_view()
                    }
                    None => view! {
                        <p class="answer-unavailable">"该记录未保存作答文本。"</p>
                    }.into_view(),
                }}
            </div>
        </div>
    }
}

#[component]
fn RetryableMessage(message: String, cancelled: bool, on_retry: Callback<()>) -> impl IntoView {
    let label = if cancelled {
        "已取消"
    } else {
        "请求未成功"
    };
    view! {
        <div class="answer-card">
            <p class="echo-error">{label} {(!cancelled).then(|| view! { "：" {message.clone()} })}</p>
            <button class="stream-retry" on:click=move |_| on_retry.call(())>"重试"</button>
        </div>
    }
}

// ── App root ──────────────────────────────────────────────────────────────

/// 会话历史侧栏——列表/切换/删除，选中项由 `active_id` 驱动高亮。
#[component]
fn HistorySidebar(
    sessions: Resource<(), Result<ResearchSessionsResponse, String>>,
    active_id: Option<String>,
    on_select: Callback<Option<String>>,
    on_delete: Callback<String>,
) -> impl IntoView {
    view! {
        <aside class="research-sidebar">
            <div class="research-sidebar-head">
                <span>"研究历史"</span>
                <button class="sidebar-new" on:click=move |_| on_select.call(None)>"+ 新对话"</button>
            </div>
            <div class="research-sidebar-list">
                {move || match sessions.get() {
                    None => view! { <p class="page-state">"读取中…"</p> }.into_view(),
                    Some(Err(error)) => view! { <p class="page-state form-error">{error}</p> }.into_view(),
                    Some(Ok(data)) if data.sessions.is_empty() => {
                        view! { <p class="page-state">"暂无研究历史。"</p> }.into_view()
                    }
                    Some(Ok(data)) => {
                        let active_id = active_id.clone();
                        data.sessions.into_iter().map(|item| {
                            let is_active = active_id.as_deref() == Some(item.id.as_str());
                            let go_id = item.id.clone();
                            let del_id = item.id.clone();
                            let meta = format!(
                                "{} · {}",
                                item.ticker.clone().unwrap_or_default(),
                                item.updated_at.clone(),
                            );
                            view! {
                                <div class=if is_active { "session-item is-active" } else { "session-item" }>
                                    <button class="session-item-main" on:click=move |_| on_select.call(Some(go_id.clone()))>
                                        <span class="session-item-title">{item.title.clone()}</span>
                                        <span class="session-item-meta">{meta.clone()}</span>
                                    </button>
                                    <button
                                        class="session-item-delete"
                                        title="删除"
                                        on:click=move |ev| {
                                            ev.stop_propagation();
                                            on_delete.call(del_id.clone());
                                        }
                                    >"×"</button>
                                </div>
                            }
                        }).collect_view()
                    }
                }}
            </div>
        </aside>
    }
}

#[component]
pub fn ResearchPage(
    initial_session: Option<String>,
    on_navigate: Callback<Option<String>>,
) -> impl IntoView {
    let (question, set_question) = create_signal(String::new());
    let (ticker, set_ticker) = create_signal(String::new());
    let (thread, set_thread) = create_signal(Vec::<Turn>::new());
    let (next_id, set_next_id) = create_signal(0u64);
    let (session_error, set_session_error) = create_signal(None::<String>);

    let sessions = create_resource(
        || (),
        |_| api::get::<ResearchSessionsResponse>("/api/research/sessions"),
    );

    // 深链带 session id 时拉取该会话详情，回填成 thread 首条（只读历史卡）。
    let fetch_session_id = initial_session.clone();
    let session_detail = create_resource(
        || (),
        move |_| {
            let id = fetch_session_id.clone();
            async move {
                match id {
                    Some(id) => Some(
                        api::get::<ResearchSessionResponse>(&format!(
                            "/api/research/sessions/{id}"
                        ))
                        .await,
                    ),
                    None => None,
                }
            }
        },
    );
    create_effect(move |_| {
        if let Some(Some(result)) = session_detail.get() {
            match result {
                Ok(response) => match response.session {
                    Some(session) => {
                        let id = next_id.get();
                        set_next_id.set(id + 1);
                        set_thread.set(vec![Turn {
                            id,
                            question: session.question.clone(),
                            ticker: session.ticker.clone().unwrap_or_default(),
                            status: TurnStatus::Loaded(session),
                            handle: None,
                        }]);
                    }
                    None => {
                        set_session_error.set(Some("未找到该研究记录，可能已被删除。".to_string()))
                    }
                },
                Err(message) => set_session_error.set(Some(message)),
            }
        }
    });

    let delete_session = create_action(|id: &String| {
        let id = id.clone();
        async move {
            api::delete::<MutationResponse>(&format!("/api/research/sessions/{id}"))
                .await
                .map(|_| id)
        }
    });
    let deleted_active_id = initial_session.clone();
    create_effect(move |_| {
        if let Some(Ok(deleted_id)) = delete_session.value().get() {
            if deleted_active_id.as_deref() == Some(deleted_id.as_str()) {
                // 删的是当前会话——导航到 /research 会整体重挂载 ResearchPage，
                // 那边的 sessions 资源天然会带着最新列表重新拉取，这里不用再 refetch
                // 一次（对即将被销毁的作用域发起 refetch 会在异步结果回来时写已销毁的
                // 信号，炸掉整个响应式运行时）。
                on_navigate.call(None);
            } else {
                sessions.refetch();
            }
        }
    });

    // 任一轮仍在流式进行时视为 pending——禁止再次提交，避免并发请求的结果错位。
    let pending = move || thread.get().iter().any(|turn| turn.status.is_streaming());
    let on_persisted = Callback::new(move |_| sessions.refetch());

    let submit = move || {
        if pending() {
            return;
        }
        let q = question.get().trim().to_string();
        let t = ticker.get().trim().to_uppercase();
        if q.is_empty() || t.is_empty() {
            return;
        }
        let id = next_id.get();
        set_next_id.set(id + 1);
        start_turn(id, q, t, set_thread, on_persisted);
        set_question.set(String::new());
    };

    let has_thread = move || !thread.get().is_empty();
    let awaiting_session = initial_session.is_some();

    view! {
        <div class="research-shell">
            <HistorySidebar
                sessions=sessions
                active_id=initial_session.clone()
                on_select=on_navigate
                on_delete=Callback::new(move |id| delete_session.dispatch(id))
            />
        // ── Desk ──
        <main class=move || if has_thread() { "desk has-thread" } else { "desk" }>
            // conversation thread
            <div class=move || if has_thread() { "conversation" } else { "conversation is-empty" }>
                {move || if !has_thread() {
                    if let Some(error) = session_error.get() {
                        view! {
                            <div class="echo-empty">
                                <p class="echo-empty-sub form-error">{error}</p>
                            </div>
                        }.into_view()
                    } else if awaiting_session {
                        view! {
                            <div class="echo-empty">
                                <p class="echo-empty-sub">"正在加载历史会话…"</p>
                            </div>
                        }.into_view()
                    } else {
                    // ── 空态 hero（对齐原 auth-page 大标题风格）──
                    view! {
                        <div class="echo-empty">
                            <h1>
                                <span class="line-1">"让噪音退场，"</span>
                                <span class="line-2">"让证据发声。"</span>
                            </h1>
                            <p class="echo-empty-sub">
                                "以证据为核心，连接公告、财报、产业与市场信号，"
                                <br />
                                "帮助研究回归清晰判断。"
                            </p>
                        </div>
                    }.into_view()
                    }
                } else {
                    // ── 对话 thread ──
                    view! {
                        <div>
                            {move || thread.get().into_iter().map(|turn| {
                                let question = turn.question.clone();
                                let ticker_label = turn.ticker.clone();
                                let turn_id = turn.id;
                                let retry_question = turn.question.clone();
                                let retry_ticker = turn.ticker.clone();
                                let on_retry = Callback::new(move |_| {
                                    retry_turn(turn_id, retry_question.clone(), retry_ticker.clone(), set_thread, on_persisted);
                                });
                                let result_view = match turn.status {
                                    TurnStatus::Streaming {
                                        stage, meta_route, meta_valuation, meta_completeness,
                                        meta_sources, delta_text, guard,
                                    } => {
                                        let handle = turn.handle.clone();
                                        let on_cancel = Callback::new(move |_| {
                                            if let Some(handle) = &handle {
                                                handle.cancel();
                                            }
                                            set_thread.update(|v| {
                                                if let Some(t) = v.iter_mut().find(|t| t.id == turn_id) {
                                                    if t.status.is_streaming() {
                                                        t.status = TurnStatus::Cancelled;
                                                        t.handle = None;
                                                    }
                                                }
                                            });
                                        });
                                        view! {
                                            <StreamingCard
                                                stage=stage
                                                meta_route=meta_route
                                                meta_valuation=meta_valuation
                                                meta_completeness=meta_completeness
                                                meta_sources=meta_sources
                                                delta_text=delta_text
                                                guard=guard
                                                on_cancel=on_cancel
                                            />
                                        }.into_view()
                                    }
                                    TurnStatus::Done(response) => view! { <DoneCard res=response /> }.into_view(),
                                    TurnStatus::Loaded(detail) => view! { <HistoryCard detail=detail /> }.into_view(),
                                    TurnStatus::Failed(message) => view! {
                                        <RetryableMessage message=message cancelled=false on_retry=on_retry />
                                    }.into_view(),
                                    TurnStatus::Cancelled => view! {
                                        <RetryableMessage message=String::new() cancelled=true on_retry=on_retry />
                                    }.into_view(),
                                };
                                view! {
                                    // user bubble
                                    <div class="message user">
                                        <div class="bubble">
                                            {question} " · " <strong>{ticker_label}</strong>
                                        </div>
                                    </div>
                                    // assistant card
                                    <div class="message">
                                        <div class="bubble" style="max-width:100%;width:100%">
                                            {result_view}
                                        </div>
                                    </div>
                                }
                            }).collect_view()}
                        </div>
                    }.into_view()
                }}
            </div>

            // ── Composer (sticky bottom) ──
            <div class="composer">
                <div class="composer-panel">
                    <textarea
                        prop:value=question
                        on:input=move |ev| set_question.set(event_target_value(&ev))
                        on:keydown=move |ev| {
                            if ev.key() == "Enter" && !ev.shift_key() {
                                ev.prevent_default();
                                submit();
                            }
                        }
                        placeholder="研究一家美股 / 港股科技公司……"
                        rows="2"
                    />
                    <div class="composer-footer">
                        <input
                            class="composer-ticker"
                            prop:value=ticker
                            on:input=move |ev| set_ticker.set(event_target_value(&ev))
                            on:keydown=move |ev| if ev.key() == "Enter" { submit() }
                            placeholder="研究对象，如 AAPL / 9988.HK"
                        />
                        <button
                            class="composer-send"
                            on:click=move |_| submit()
                            disabled=pending
                            title="发送（Enter）"
                        >
                            {move || if pending() { "…" } else { "↑" }}
                        </button>
                    </div>
                </div>
            </div>
        </main>
        </div>
    }
}
