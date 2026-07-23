//! Echo Research 研究页（Leptos/WASM）。
//!
//! 暗底 #02070a + 青色 #82e7ee + 楷体衬线大标题 + 对话式研究布局。
//! DOM 结构复用 .desk/.conversation/.message/.bubble/.answer-card 语义层次。
//!
//! 作答走类型化 SSE（`/api/ask/stream`）：meta（路由/估值骨架）→ stage（组装/生成/核对/落库）
//! → delta（打字机增量）→ guard（数字护栏）→ final（落库结果）；`error` 或连接异常归一到失败态。

use crate::api;
use echo_contracts::{
    AnswerSource, AskRequest, AskResponse, CompanyResolveResponse, CompanySearchItem,
    CompanySearchResponse, CompareLegView, CompareResponse, Decimal, EarningsCalendarView,
    GuardView, MutationResponse, ReportGenerateResponse, ReportMode, ResearchSessionDetail,
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
        meta_earnings: Option<EarningsCalendarView>,
        delta_text: String,
        guard: Option<GuardView>,
    },
    Done(AskResponse),
    /// 对话内双主体对比完成——两腿独立取数/独立护栏；对比结果暂不落库。
    CompareDone(Box<CompareResponse>),
    /// 从历史会话加载——字段比 [`AskResponse`] 更少（未持久化路由/完备度/护栏明细），
    /// 缺的就是缺的，不拿假数据补全。
    Loaded(ResearchSessionDetail),
    Failed(String),
    Cancelled,
    /// 深度报告——非流式单请求（`POST /api/report/generate`），进行中/完成两态。
    ReportPending,
    ReportDone(ReportGenerateResponse),
}

impl TurnStatus {
    fn streaming_default() -> Self {
        Self::Streaming {
            stage: None,
            meta_route: None,
            meta_valuation: None,
            meta_completeness: None,
            meta_sources: Vec::new(),
            meta_earnings: None,
            delta_text: String::new(),
            guard: None,
        }
    }

    fn is_streaming(&self) -> bool {
        matches!(self, Self::Streaming { .. })
    }

    /// 占用提交通道——流式研究进行中，或深度报告正在生成。
    fn is_busy(&self) -> bool {
        matches!(self, Self::Streaming { .. } | Self::ReportPending)
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
    /// 深度报告 turn 失败后重试要走 `fire_report`，不能落回默认的 SSE 问答通道。
    is_report: bool,
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

pub(crate) fn decimal_text(value: Option<Decimal>) -> String {
    value
        .map(|decimal| decimal.normalize().to_string())
        .unwrap_or_else(|| "—".to_string())
}

/// 公司候选的展示标签——优先中文名，缺了退中文名/英文名/代码本身，不留空。
fn company_display(name_zh: &str, name_en: Option<&str>, ticker: &str) -> String {
    let name = non_empty(name_zh)
        .or_else(|| name_en.and_then(non_empty))
        .unwrap_or_else(|| ticker.to_string());
    format!("{name} · {ticker}")
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// 推入一条新的 pending turn 并接上类型化 SSE 流。
/// `on_persisted`——落库完成（Final 到达）后触发，驱动侧栏刷新，新研究即时出现在历史列表里。
fn start_turn(
    id: u64,
    question: String,
    ticker: String,
    session_id: Option<String>,
    set_thread: WriteSignal<Vec<Turn>>,
    set_session_id: WriteSignal<Option<String>>,
    on_persisted: Callback<()>,
) {
    set_thread.update(|v| {
        v.push(Turn {
            id,
            question: question.clone(),
            ticker: ticker.clone(),
            status: TurnStatus::streaming_default(),
            handle: None,
            is_report: false,
        });
    });
    attach_stream(
        id,
        question,
        ticker,
        session_id,
        set_thread,
        set_session_id,
        on_persisted,
    );
}

/// 重试：把已存在的 turn（取消/失败终态）原地重置，而不是追加新 turn——按 `is_report`
/// 分流回原来的通道（SSE 问答 或 一次性深度报告），不会把报告失败重试成问答。
fn retry_turn(
    id: u64,
    question: String,
    ticker: String,
    session_id: Option<String>,
    set_thread: WriteSignal<Vec<Turn>>,
    set_session_id: WriteSignal<Option<String>>,
    on_persisted: Callback<()>,
) {
    let is_report = set_thread
        .try_update(|v| {
            let is_report = v
                .iter()
                .find(|t| t.id == id)
                .is_some_and(|turn| turn.is_report);
            if let Some(turn) = v.iter_mut().find(|t| t.id == id) {
                turn.status = if is_report {
                    TurnStatus::ReportPending
                } else {
                    TurnStatus::streaming_default()
                };
                turn.handle = None;
            }
            is_report
        })
        .unwrap_or(false);
    if is_report {
        fire_report_request(
            id,
            question,
            ticker,
            session_id,
            set_thread,
            set_session_id,
            on_persisted,
        );
    } else {
        attach_stream(
            id,
            question,
            ticker,
            session_id,
            set_thread,
            set_session_id,
            on_persisted,
        );
    }
}

/// 把一次研究请求接到类型化 SSE 流上：事件回来后按 `id` 精确回填对应 turn，
/// 迟到事件（turn 已是别的终态）一律忽略。带 `session_id` 时后端把这轮追加到
/// 同一研究会话（历史只帮代词/实体承接，不注入旧数字）；`Final` 落库归位的会话 id
/// 回填进 `set_session_id`，同一页面接下来的追问就能续接同一会话。
fn attach_stream(
    id: u64,
    question: String,
    ticker: String,
    session_id: Option<String>,
    set_thread: WriteSignal<Vec<Turn>>,
    set_session_id: WriteSignal<Option<String>>,
    on_persisted: Callback<()>,
) {
    let mut req = AskRequest::minimal(question, ticker);
    req.session_id = session_id;

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
                    if f.response.session_id.is_some() {
                        set_session_id.set(f.response.session_id.clone());
                    }
                    turn.status = TurnStatus::Done(f.response);
                    turn.handle = None;
                    on_persisted.call(());
                    return;
                }
                ResearchStreamEvent::Compare(c) => {
                    // 对比结果一次性到达；暂不落库，所以不触发 on_persisted。
                    turn.ticker = format!(
                        "{} vs {}",
                        c.response.primary.ticker, c.response.peer.ticker
                    );
                    turn.status = TurnStatus::CompareDone(Box::new(c.response));
                    turn.handle = None;
                    return;
                }
                ResearchStreamEvent::Error(e) => {
                    turn.status = TurnStatus::Failed(e.message);
                    turn.handle = None;
                    return;
                }
                _ => {}
            }
            let turn_ticker = &mut turn.ticker;
            let TurnStatus::Streaming {
                stage,
                meta_route,
                meta_valuation,
                meta_completeness,
                meta_sources,
                meta_earnings,
                delta_text,
                guard,
            } = &mut turn.status
            else {
                return;
            };
            match event {
                ResearchStreamEvent::Meta(m) => {
                    // 服务端从问题里识别出的主体回填到本轮——气泡标签与后续追问都用它。
                    if turn_ticker.is_empty() {
                        *turn_ticker = m.ticker;
                    }
                    *meta_route = Some(m.route);
                    *meta_valuation = Some(m.valuation);
                    *meta_completeness = Some(m.data_completeness);
                    *meta_sources = m.connected_sources;
                    *meta_earnings = m.earnings;
                }
                ResearchStreamEvent::Stage(s) => *stage = Some(s.name),
                ResearchStreamEvent::Delta(d) => delta_text.push_str(&d.text),
                ResearchStreamEvent::Guard(g) => *guard = g.fact_guard,
                ResearchStreamEvent::Final(_)
                | ResearchStreamEvent::Compare(_)
                | ResearchStreamEvent::Error(_) => unreachable!(),
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
    schedule_stream_timeout(id, set_thread, handle.clone());
    set_thread.update(|v| {
        if let Some(turn) = v.iter_mut().find(|t| t.id == id) {
            if turn.status.is_streaming() {
                turn.handle = Some(handle);
            }
        }
    });
}

/// 推入一条深度报告 turn 并发起非流式请求（`POST /api/report/generate`）——与研究问答共用
/// composer/thread，但走单请求 JSON，不接 SSE。
fn fire_report(
    id: u64,
    question: String,
    ticker: String,
    session_id: Option<String>,
    set_thread: WriteSignal<Vec<Turn>>,
    set_session_id: WriteSignal<Option<String>>,
    on_persisted: Callback<()>,
) {
    set_thread.update(|v| {
        v.push(Turn {
            id,
            question: question.clone(),
            ticker: ticker.clone(),
            status: TurnStatus::ReportPending,
            handle: None,
            is_report: true,
        });
    });
    fire_report_request(
        id,
        question,
        ticker,
        session_id,
        set_thread,
        set_session_id,
        on_persisted,
    );
}

/// 深度报告的实际请求发送——不推入 turn，供首次提交与重试共用。
fn fire_report_request(
    id: u64,
    question: String,
    ticker: String,
    session_id: Option<String>,
    set_thread: WriteSignal<Vec<Turn>>,
    set_session_id: WriteSignal<Option<String>>,
    on_persisted: Callback<()>,
) {
    let mut req = AskRequest::minimal(question, ticker);
    req.session_id = session_id;
    leptos::spawn_local(async move {
        let outcome = api::post::<_, ReportGenerateResponse>("/api/report/generate", &req).await;
        set_thread.update(|v| {
            let Some(turn) = v.iter_mut().find(|t| t.id == id) else {
                return;
            };
            if !matches!(turn.status, TurnStatus::ReportPending) {
                return;
            }
            match outcome {
                Ok(response) => {
                    if response.session_id.is_some() {
                        set_session_id.set(response.session_id.clone());
                    }
                    turn.status = TurnStatus::ReportDone(response);
                    on_persisted.call(());
                }
                Err(message) => turn.status = TurnStatus::Failed(message),
            }
        });
    });
}

/// 超时态——流在固定窗口内没到终态（Final/Error），视为卡死，主动取消并转失败可重试。
/// 一次性定时器，不随事件重置：多阶段研究本就该在这个窗口内跑完，卡死比慢更值得暴露。
#[cfg(target_arch = "wasm32")]
fn schedule_stream_timeout(id: u64, set_thread: WriteSignal<Vec<Turn>>, handle: api::StreamHandle) {
    use wasm_bindgen::JsCast;
    use wasm_bindgen::prelude::Closure;

    let closure = Closure::once(move || {
        set_thread.update(|v| {
            if let Some(turn) = v.iter_mut().find(|t| t.id == id) {
                if turn.status.is_streaming() {
                    handle.cancel();
                    turn.status =
                        TurnStatus::Failed("研究响应超时（120 秒无返回），请重试。".to_string());
                    turn.handle = None;
                }
            }
        });
    });
    let _ = leptos::window().set_timeout_with_callback_and_timeout_and_arguments_0(
        closure.as_ref().unchecked_ref(),
        120_000,
    );
    closure.forget();
}

#[cfg(not(target_arch = "wasm32"))]
fn schedule_stream_timeout(
    _id: u64,
    _set_thread: WriteSignal<Vec<Turn>>,
    _handle: api::StreamHandle,
) {
}

// ── Components ────────────────────────────────────────────────────────────

/// 估值三段带（bear / base / bull）。
#[component]
pub(crate) fn ValuationBand(v: ValuationView) -> impl IntoView {
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
pub(crate) fn RouteChips(route: RouteView) -> impl IntoView {
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
pub(crate) fn CompletenessRow(completeness: u8) -> impl IntoView {
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
pub(crate) fn DataSources(sources: Vec<String>) -> impl IntoView {
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
pub(crate) fn GuardBadge(guard: GuardView) -> impl IntoView {
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

/// 下次财报日徽标——`None` 字段即不展示对应行，绝不占位。
#[component]
fn EarningsBadge(earnings: EarningsCalendarView) -> impl IntoView {
    let Some(next_date) = earnings.next_date.clone() else {
        return ().into_view();
    };
    let period = match (earnings.year, earnings.quarter) {
        (Some(year), Some(quarter)) => Some(format!("{year} Q{quarter}")),
        _ => None,
    };
    view! {
        <div class="earnings-badge">
            <span class="earnings-k">"下次财报"</span>
            <span class="earnings-v">{next_date}</span>
            {period.map(|p| view! { <span class="earnings-period">{p}</span> })}
        </div>
    }
    .into_view()
}

/// 作答来源的用户可读中文标签——纯 UI 展示映射，接口层仍传英文枚举值。
const fn answer_source_label(source: AnswerSource) -> &'static str {
    match source {
        AnswerSource::Draft => "结构化草稿",
        AnswerSource::Generated => "模型生成",
        AnswerSource::Unavailable => "未作答",
    }
}

/// 深度报告生成方式的中文标签——同上，仅 UI 展示。
const fn report_mode_label(mode: ReportMode) -> &'static str {
    match mode {
        ReportMode::Model => "模型生成",
        ReportMode::Local => "本地模板兜底",
    }
}

/// 折叠的「研究依据」面板——答案文本永远优先，估值带/完备度/来源/护栏收进一行摘要，
/// 点开展开。摘要只汇总真实到手的字段，缺的既不出现在摘要也不出现在面板里。
#[component]
fn EvidencePanel(
    valuation: Option<ValuationView>,
    completeness: Option<u8>,
    earnings: Option<EarningsCalendarView>,
    sources: Vec<String>,
    guard: Option<GuardView>,
    answer_source: Option<String>,
) -> impl IntoView {
    let has_content = valuation.is_some()
        || completeness.is_some()
        || earnings.is_some()
        || !sources.is_empty()
        || guard.is_some();
    if !has_content {
        return ().into_view();
    }
    let mut summary_parts: Vec<String> = Vec::new();
    if let Some(value) = completeness {
        summary_parts.push(format!("完备度 {value}%"));
    }
    if !sources.is_empty() {
        summary_parts.push(format!("{} 个数据源", sources.len()));
    }
    let guard_hard = guard.as_ref().is_some_and(|g| g.has_hard_fail);
    if let Some(g) = &guard {
        summary_parts.push(format!("护栏 过 {}/{}", g.pass, g.total));
    }
    let summary_text = if summary_parts.is_empty() {
        "研究依据".to_string()
    } else {
        format!("研究依据 · {}", summary_parts.join(" · "))
    };
    view! {
        <details class=if guard_hard { "evidence-panel has-hard" } else { "evidence-panel" }>
            <summary>
                <span class="evidence-summary-text">{summary_text}</span>
                <svg class="evidence-chevron" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </summary>
            <div class="evidence-body">
                {valuation.map(|v| view! { <ValuationBand v=v /> })}
                {completeness.map(|c| view! { <CompletenessRow completeness=c /> })}
                {earnings.map(|e| view! { <EarningsBadge earnings=e /> })}
                <DataSources sources=sources />
                {guard.map(|g| view! { <GuardBadge guard=g /> })}
                {answer_source.map(|s| view! { <p class="evidence-provenance">"作答来源 · " {s}</p> })}
            </div>
        </details>
    }
    .into_view()
}

/// 流式进行中的卡片：已到的 meta 骨架 + 阶段提示 + 打字机增量 + 取消按钮。
#[component]
fn StreamingCard(
    stage: Option<ResearchStreamStageName>,
    meta_route: Option<RouteView>,
    meta_valuation: Option<ValuationView>,
    meta_completeness: Option<u8>,
    meta_sources: Vec<String>,
    meta_earnings: Option<EarningsCalendarView>,
    delta_text: String,
    guard: Option<GuardView>,
    on_cancel: Callback<()>,
) -> impl IntoView {
    let html = (!delta_text.is_empty()).then(|| crate::markdown::render(&delta_text));
    view! {
        <div class="answer-card">
            {meta_route.clone().map(|route| view! {
                <div class="answer-head"><RouteChips route=route /></div>
            })}

            // 流式期间骨架直接可见——meta 先到先画，答案生成前用户就能看到估值区间在成形。
            {meta_valuation.map(|v| view! { <ValuationBand v=v /> })}
            {meta_completeness.map(|c| view! { <CompletenessRow completeness=c /> })}
            {meta_earnings.map(|e| view! { <EarningsBadge earnings=e /> })}
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

/// 干净完成后的答案卡——答案文本优先，估值/完备度/来源/护栏全部收进折叠的证据面板。
#[component]
fn DoneCard(res: AskResponse) -> impl IntoView {
    view! {
        <div class="answer-card">
            <div class="answer-head">
                <RouteChips route=res.route.clone() />
            </div>

            <div class="answer-text-section">
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

            <EvidencePanel
                valuation=Some(res.valuation.clone())
                completeness=Some(res.data_completeness)
                earnings=res.earnings.clone()
                sources=res.connected_sources.clone()
                guard=res.fact_guard.clone()
                answer_source=Some(answer_source_label(res.answer_source).to_string())
            />
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
            <div class="answer-head">
                <span class="ac-chip dim">"历史记录 · " {detail.created_at.clone()}</span>
            </div>

            <div class="answer-text-section">
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

            <EvidencePanel
                valuation=valuation
                completeness=None
                earnings=None
                sources=sources
                guard=None
                answer_source=Some("历史存档".to_string())
            />
        </div>
    }
}

/// 深度报告生成中——非流式单请求，无逐字增量，只给一个进行中提示。
#[component]
fn ReportPendingCard() -> impl IntoView {
    view! {
        <div class="answer-card">
            <div class="answer-head">
                <span class="ac-chip">"深度报告"</span>
            </div>
            <p class="working-text">"正在生成深度报告…"</p>
        </div>
    }
}

/// 深度报告完成态——固定七段结构的 Markdown + 复用的估值带/护栏，外加客户端导出。
#[component]
fn ReportCard(res: ReportGenerateResponse) -> impl IntoView {
    let html = crate::markdown::render(&res.markdown);
    let filename = format!("{}-深度报告.md", res.ticker);
    let markdown = res.markdown.clone();
    let download =
        move |_| api::download_text_file(&filename, "text/markdown;charset=utf-8", &markdown);
    view! {
        <div class="answer-card">
            <div class="answer-head">
                <span class="ac-chip">"深度报告"</span>
                <RouteChips route=res.route.clone() />
            </div>

            <div class="answer-text-section">
                <div class="answer-text" inner_html=html></div>
            </div>

            <EvidencePanel
                valuation=Some(res.valuation.clone())
                completeness=None
                earnings=res.earnings.clone()
                sources=Vec::new()
                guard=res.fact_guard.clone()
                answer_source=Some(report_mode_label(res.mode).to_string())
            />

            <button class="stream-retry" on:click=download>"下载 Markdown"</button>
        </div>
    }
}

/// 对话内双主体对比卡——结论优先，两腿证据（估值/完备度/来源/护栏）双栏排在下方，
/// 每腿一个独立折叠面板，绝不把两腿数字混进同一个面板。
#[component]
fn CompareCard(res: CompareResponse) -> impl IntoView {
    let answer_html = res
        .answer
        .clone()
        .map(|text| crate::markdown::render(&text));
    view! {
        <div class="answer-card">
            <div class="answer-head">
                <span class="ac-chip">"双主体对比"</span>
                <RouteChips route=res.route.clone() />
            </div>

            <div class="answer-text-section">
                {match answer_html {
                    Some(html) => view! { <div class="answer-text" inner_html=html></div> }.into_view(),
                    None => view! {
                        <p class="answer-unavailable">
                            "未核到模型作答（未配 provider）——仅给两腿结构化事实，不臆造。"
                        </p>
                    }.into_view(),
                }}
            </div>

            <div class="compare-columns">
                <CompareLeg leg=res.primary.clone() />
                <CompareLeg leg=res.peer.clone() />
            </div>

            <p class="compare-note">"两腿独立取数、独立护栏核对；对比结果暂不写入研究历史。"</p>
        </div>
    }
}

/// 对比单腿——ticker 标签 + 该腿自己的证据面板（默认展开首屏可见的估值带）。
#[component]
fn CompareLeg(leg: CompareLegView) -> impl IntoView {
    view! {
        <div class="compare-leg">
            <p class="compare-leg-ticker">{leg.ticker.clone()}</p>
            <ValuationBand v=leg.valuation.clone() />
            <CompletenessRow completeness=leg.data_completeness />
            <DataSources sources=leg.connected_sources.clone() />
            {leg.fact_guard.clone().map(|g| view! { <GuardBadge guard=g /> })}
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
                                        aria-label="删除该研究记录"
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

/// 提交走哪条通道——常规问答（SSE）还是一次性深度报告生成。
#[derive(Clone, Copy, PartialEq, Eq)]
enum SubmitMode {
    Ask,
    Report,
}

#[component]
pub fn ResearchPage(
    initial_session: Option<String>,
    on_navigate: Callback<Option<String>>,
) -> impl IntoView {
    let (question, set_question) = create_signal(String::new());
    // 研究对象输入——公司名/代码皆可；`resolved` 是唯一可信来源，输入文本变化即失效。
    let (company_query, set_company_query) = create_signal(String::new());
    let (resolved, set_resolved) = create_signal(None::<(String, String)>);
    let (candidates, set_candidates) = create_signal(Vec::<CompanySearchItem>::new());
    let (search_gen, set_search_gen) = create_signal(0u64);
    let (resolving, set_resolving) = create_signal(false);
    let (resolve_error, set_resolve_error) = create_signal(None::<String>);
    let (thread, set_thread) = create_signal(Vec::<Turn>::new());
    let (next_id, set_next_id) = create_signal(0u64);
    let (session_error, set_session_error) = create_signal(None::<String>);
    // 本页面当前续接的研究会话 id——深链带来的历史会话，或本页面第一轮问答落库后
    // 归位的新会话；后续每一轮追问都带上它，让模型能承接代词/实体指代。
    let (current_session_id, set_current_session_id) = create_signal(initial_session.clone());

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
                        // 恢复研究对象确认态——续接历史会话的追问不需要重填公司。
                        if let Some(ticker) =
                            session.ticker.clone().filter(|value| !value.is_empty())
                        {
                            set_resolved.set(Some((ticker.clone(), ticker)));
                        }
                        set_thread.set(vec![Turn {
                            id,
                            question: session.question.clone(),
                            ticker: session.ticker.clone().unwrap_or_default(),
                            status: TurnStatus::Loaded(session),
                            handle: None,
                            is_report: false,
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

    // 任一轮仍在流式研究或深度报告生成中都视为 pending——禁止再次提交，避免并发请求的结果错位。
    let pending = move || thread.get().iter().any(|turn| turn.status.is_busy());
    let on_persisted = Callback::new(move |_| sessions.refetch());

    // 服务端从问题里识别出主体后（meta 回填了最后一轮的 ticker），若 composer 还没有
    // 确认公司，就把它补成 chip——追问自然续接。只看最后一轮：不许把更早轮次的旧公司
    // 回填到一个正在等服务端识别的新问题上；对比轮（"A vs B"）也不回填。
    create_effect(move |_| {
        let latest = thread.get().last().and_then(|turn| {
            let ticker = turn.ticker.trim();
            (!ticker.is_empty() && !ticker.contains(" vs ")).then(|| ticker.to_string())
        });
        if let Some(ticker) = latest {
            if resolved.get_untracked().is_none() {
                set_resolved.set(Some((ticker.clone(), ticker)));
            }
        }
    });

    // 研究对象输入变化——本地 DB 候选（便宜）实时查，旧一代请求用 gen 挡掉不覆盖新结果。
    let on_query_input = move |ev| {
        let value = event_target_value(&ev);
        set_company_query.set(value.clone());
        set_resolved.set(None);
        set_resolve_error.set(None);
        let query = value.trim().to_string();
        let generation = search_gen.get() + 1;
        set_search_gen.set(generation);
        if query.is_empty() {
            set_candidates.set(Vec::new());
            return;
        }
        leptos::spawn_local(async move {
            let path = format!(
                "/api/companies/search?q={}&limit=8",
                api::encode_query(&query)
            );
            if let Ok(response) = api::get::<CompanySearchResponse>(&path).await {
                if search_gen.get_untracked() == generation {
                    set_candidates.set(response.companies);
                }
            }
        });
    };

    let select_candidate = move |item: CompanySearchItem| {
        let label = company_display(&item.name_zh, item.name_en.as_deref(), &item.ticker);
        set_company_query.set(label.clone());
        set_resolved.set(Some((item.ticker, label)));
        set_candidates.set(Vec::new());
        set_resolve_error.set(None);
    };

    // 确认好的候选（点选或 resolve 验证成功）才真正起一轮研究。研究对象在会话内保持
    // 确认态不清空——追问同一家公司是最高频路径，绝不让用户每轮重填；换公司点掉 chip 即可。
    let fire = move |mode: SubmitMode, target_ticker: String, target_label: String| {
        let q = question.get().trim().to_string();
        let q = if q.is_empty() && mode == SubmitMode::Report {
            "生成深度研究报告".to_string()
        } else {
            q
        };
        if q.is_empty() {
            return;
        }
        let id = next_id.get();
        set_next_id.set(id + 1);
        match mode {
            SubmitMode::Ask => start_turn(
                id,
                q,
                target_ticker.clone(),
                current_session_id.get(),
                set_thread,
                set_current_session_id,
                on_persisted,
            ),
            SubmitMode::Report => fire_report(
                id,
                q,
                target_ticker.clone(),
                current_session_id.get(),
                set_thread,
                set_current_session_id,
                on_persisted,
            ),
        }
        set_question.set(String::new());
        // 显式确认过的公司 chip 常驻；主体留给服务端识别时（空 ticker）不放假 chip，
        // 等 meta 回填后由 thread 效应补上。
        if !target_ticker.is_empty() {
            set_resolved.set(Some((target_ticker, target_label)));
        }
        set_company_query.set(String::new());
        set_candidates.set(Vec::new());
    };

    let submit = move |mode: SubmitMode| {
        if pending() || resolving.get() {
            return;
        }
        if mode == SubmitMode::Ask && question.get().trim().is_empty() {
            return;
        }
        if let Some((target_ticker, target_label)) = resolved.get() {
            fire(mode, target_ticker, target_label);
            return;
        }
        let query = company_query.get().trim().to_string();
        if query.is_empty() {
            // 没有显式研究对象——把识别交给服务端（resolve 链跑问题文本；
            // 双主体对比问题也在服务端分流）。识别失败会以流错误诚实返回。
            fire(mode, String::new(), String::new());
            return;
        }
        set_resolving.set(true);
        set_resolve_error.set(None);
        leptos::spawn_local(async move {
            let path = format!("/api/companies/resolve?q={}", api::encode_query(&query));
            let outcome = api::get::<CompanyResolveResponse>(&path).await;
            set_resolving.set(false);
            match outcome {
                Ok(response) => match response.company {
                    Some(company) => {
                        let label = company_display(
                            &company.name_zh,
                            company.name_en.as_deref(),
                            &company.ticker,
                        );
                        fire(mode, company.ticker, label);
                    }
                    None => set_resolve_error.set(Some(format!(
                        "未能把「{query}」识别为可研究的公司，请换个更准确的名称或代码。"
                    ))),
                },
                Err(message) => set_resolve_error.set(Some(message)),
            }
        });
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
                                "直接提问即可——现状、估值、风险、证伪条件；"
                                <br />
                                "点到两家公司的问题会自动进入双主体对比。"
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
                                    retry_turn(
                                        turn_id,
                                        retry_question.clone(),
                                        retry_ticker.clone(),
                                        current_session_id.get(),
                                        set_thread,
                                        set_current_session_id,
                                        on_persisted,
                                    );
                                });
                                let result_view = match turn.status {
                                    TurnStatus::Streaming {
                                        stage, meta_route, meta_valuation, meta_completeness,
                                        meta_sources, meta_earnings, delta_text, guard,
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
                                                meta_earnings=meta_earnings
                                                delta_text=delta_text
                                                guard=guard
                                                on_cancel=on_cancel
                                            />
                                        }.into_view()
                                    }
                                    TurnStatus::Done(response) => view! { <DoneCard res=response /> }.into_view(),
                                    TurnStatus::CompareDone(response) => view! { <CompareCard res=*response /> }.into_view(),
                                    TurnStatus::Loaded(detail) => view! { <HistoryCard detail=detail /> }.into_view(),
                                    TurnStatus::ReportPending => view! { <ReportPendingCard /> }.into_view(),
                                    TurnStatus::ReportDone(response) => view! { <ReportCard res=response /> }.into_view(),
                                    TurnStatus::Failed(message) => view! {
                                        <RetryableMessage message=message cancelled=false on_retry=on_retry />
                                    }.into_view(),
                                    TurnStatus::Cancelled => view! {
                                        <RetryableMessage message=String::new() cancelled=true on_retry=on_retry />
                                    }.into_view(),
                                };
                                view! {
                                    // user bubble——问题为主体，研究对象作为小标签而不是拼接文本
                                    <div class="message user">
                                        <div class="bubble">
                                            {(!ticker_label.is_empty()).then(|| view! {
                                                <span class="bubble-ticker">{ticker_label.clone()}</span>
                                            })}
                                            <p class="bubble-text">{question}</p>
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
                                submit(SubmitMode::Ask);
                            }
                        }
                        placeholder="想研究什么？现状、估值、护城河、风险、证伪条件……"
                        rows="2"
                    />
                    <div class="composer-footer">
                        <div class="company-picker">
                            {move || match resolved.get() {
                                // 已确认研究对象——chip 常驻，追问免重填；点 × 更换公司。
                                Some((_, label)) => view! {
                                    <div class="company-chip">
                                        <span class="company-chip-label">{label}</span>
                                        <button
                                            class="company-chip-clear"
                                            title="更换研究对象"
                                            aria-label="更换研究对象"
                                            on:click=move |_| {
                                                set_resolved.set(None);
                                                set_company_query.set(String::new());
                                            }
                                        >"×"</button>
                                    </div>
                                }.into_view(),
                                None => view! {
                                    <input
                                        class="company-input"
                                        prop:value=company_query
                                        on:input=on_query_input
                                        on:keydown=move |ev| {
                                            if ev.key() == "Enter" {
                                                submit(SubmitMode::Ask);
                                            } else if ev.key() == "Escape" && !candidates.get_untracked().is_empty() {
                                                ev.stop_propagation();
                                                set_candidates.set(Vec::new());
                                            }
                                        }
                                        placeholder="研究对象（可留空，自动从问题识别）"
                                        disabled=resolving
                                        role="combobox"
                                        aria-expanded=move || !candidates.get().is_empty()
                                        aria-autocomplete="list"
                                    />
                                }.into_view(),
                            }}
                            {move || resolving.get().then(|| view! {
                                <span class="company-status">"核实中…"</span>
                            })}
                            {move || {
                                let items = candidates.get();
                                if items.is_empty() {
                                    view! {}.into_view()
                                } else {
                                    view! {
                                        <div class="company-dropdown" role="listbox">
                                            {items.into_iter().map(|item| {
                                                let label = company_display(&item.name_zh, item.name_en.as_deref(), &item.ticker);
                                                let industry = item.industry.clone();
                                                let pick = item.clone();
                                                view! {
                                                    <button
                                                        type="button"
                                                        class="company-item"
                                                        role="option"
                                                        on:click=move |_| select_candidate(pick.clone())
                                                    >
                                                        <span class="company-item-name">{label}</span>
                                                        {industry.map(|value| view! { <span class="company-item-industry">{value}</span> })}
                                                    </button>
                                                }
                                            }).collect_view()}
                                        </div>
                                    }.into_view()
                                }
                            }}
                        </div>
                        <button
                            class="composer-report"
                            on:click=move |_| submit(SubmitMode::Report)
                            disabled=move || pending() || resolving.get()
                            title="生成深度报告"
                            aria-label="生成深度研究报告"
                        >"深度报告"</button>
                        <button
                            class="composer-send"
                            on:click=move |_| submit(SubmitMode::Ask)
                            disabled=move || pending() || resolving.get()
                            title="发送（Enter）"
                            aria-label="发送研究请求"
                        >
                            {move || if pending() || resolving.get() { "…" } else { "↑" }}
                        </button>
                    </div>
                    {move || resolve_error.get().map(|message| view! {
                        <p class="company-error">{message}</p>
                    })}
                </div>
            </div>
        </main>
        </div>
    }
}
