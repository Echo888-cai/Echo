//! Echo Research 研究页（Leptos/WASM）。
//!
//! 暗底 #02070a + 青色 #82e7ee + 楷体衬线大标题 + 对话式研究布局。
//! DOM 结构复用 .desk/.conversation/.message/.bubble/.answer-card 语义层次。

use crate::api;
use echo_contracts::{AskRequest, AskResponse, Decimal, ValuationView};
use leptos::*;

/// 一条对话轮——用户问题 + 助手答案（或错误）。
#[derive(Clone)]
struct Turn {
    /// 提交时分配的唯一 id——并发请求的结果按 id 归位，不按“最后一条”猜测。
    id: u64,
    question: String,
    ticker: String,
    /// `None` 表示正在 pending；`Some(Ok(_))` 成功；`Some(Err(_))` 失败。
    result: Option<Result<AskResponse, String>>,
}

async fn fetch_ask(req: AskRequest) -> Result<AskResponse, String> {
    api::post("/api/ask", &req).await
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

fn decimal_text(value: Option<Decimal>) -> String {
    value
        .map(|decimal| decimal.normalize().to_string())
        .unwrap_or_else(|| "—".to_string())
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

/// 一张 answer-card（助手回应）。
#[component]
fn AnswerCard(turn: Turn) -> impl IntoView {
    let res = match turn.result {
        Some(Ok(r)) => r,
        Some(Err(msg)) => {
            return view! {
                <div class="answer-card">
                    <p class="echo-error">"请求未成功：" {msg}</p>
                </div>
            }
            .into_view();
        }
        None => {
            return view! {
                <div class="answer-card"><p class="working-text">"正在研究…"</p></div>
            }
            .into_view();
        }
    };
    let completeness = res.data_completeness;
    let conf = (res.route.confidence * 100.0).round() as u32;
    view! {
        <div class="answer-card">
            <div class="answer-brand">
                <div class="answer-mark">
                    <i></i>
                    <span>"ECHO RESEARCH"</span>
                </div>
                <div class="ac-chips">
                    <span class="ac-chip">{intent_label(&res.route.intent).to_string()}</span>
                    <span class="ac-chip dim">{res.route.depth.clone()}</span>
                    <span class="ac-chip dim">"置信 " {conf} "%"</span>
                </div>
            </div>

            <ValuationBand v=res.valuation.clone() />

            <div class="completeness-row">
                <div class="completeness-bar">
                    <span class="completeness-fill" style=move || format!("width:{}%", completeness)></span>
                </div>
                <span class="completeness-label">"数据完备度 " {completeness} "%"</span>
            </div>

            {if !res.connected_sources.is_empty() {
                view! {
                    <div class="data-sources">
                        {res.connected_sources.iter().cloned().map(|s| view! {
                            <span class="data-source">{s}</span>
                        }).collect_view()}
                    </div>
                }.into_view()
            } else {
                ().into_view()
            }}

            <div class="answer-text-section">
                <p class="answer-source-label">"作答 · " {res.answer_source.as_str()}</p>
                {match res.answer.clone() {
                    Some(text) => view! { <p class="answer-text">{text}</p> }.into_view(),
                    None => view! {
                        <p class="answer-unavailable">
                            "未核到模型作答（未配 provider）——本轮只给结构化事实，不臆造。"
                        </p>
                    }.into_view(),
                }}
            </div>

            {res.fact_guard.clone().map(|g| {
                let cls = if g.has_hard_fail { "fact-guard has-hard" } else { "fact-guard" };
                view! {
                    <div class=cls>
                        <span class="fact-guard-k">"数字护栏"</span>
                        <span>"核 " {g.total} " · 过 " {g.pass} " · 软 " {g.soft} " · 硬 " {g.hard}</span>
                        {(!g.soft_note.is_empty()).then(|| view! {
                            <p class="fact-guard-note">{g.soft_note.clone()}</p>
                        })}
                    </div>
                }
            })}
        </div>
    }.into_view()
}

// ── App root ──────────────────────────────────────────────────────────────

#[component]
pub fn ResearchPage() -> impl IntoView {
    let (question, set_question) = create_signal(String::new());
    let (ticker, set_ticker) = create_signal(String::new());
    let (thread, set_thread) = create_signal(Vec::<Turn>::new());
    let (next_id, set_next_id) = create_signal(0u64);

    // 任一轮还没落地结果时视为 pending——禁止再次提交，避免并发请求的结果错位。
    let pending = move || thread.get().iter().any(|turn| turn.result.is_none());

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
        // push a pending placeholder so the thread shows the user bubble immediately
        set_thread.update(|v| {
            v.push(Turn {
                id,
                question: q.clone(),
                ticker: t.clone(),
                result: None,
            })
        });
        set_question.set(String::new());
        let req = AskRequest::minimal(q, t);
        leptos::spawn_local(async move {
            let result = fetch_ask(req).await;
            set_thread.update(|v| {
                if let Some(turn) = v.iter_mut().find(|turn| turn.id == id) {
                    turn.result = Some(result);
                }
            });
        });
    };

    let has_thread = move || !thread.get().is_empty();

    view! {
        // ── Desk ──
        <main class=move || if has_thread() { "desk has-thread" } else { "desk" }>
            // conversation thread
            <div class=move || if has_thread() { "conversation" } else { "conversation is-empty" }>
                {move || if !has_thread() {
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
                } else {
                    // ── 对话 thread ──
                    view! {
                        <div>
                            {move || thread.get().into_iter().map(|turn| {
                                let question = turn.question.clone();
                                let ticker   = turn.ticker.clone();
                                let result_view = match turn.result.clone() {
                                    None => view! {
                                        <div class="answer-card">
                                            <p class="working-text">"正在研究…"</p>
                                        </div>
                                    }.into_view(),
                                    Some(r) => view! {
                                        <AnswerCard turn=Turn { result: Some(r), ..turn } />
                                    }.into_view(),
                                };
                                view! {
                                    // user bubble
                                    <div class="message user">
                                        <div class="bubble">
                                            {question} " · " <strong>{ticker}</strong>
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
    }
}
