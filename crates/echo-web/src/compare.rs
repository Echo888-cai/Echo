//! 双主体对比研究页（Leptos）——`POST /api/compare` 的 Web 接线。
//!
//! 两条腿在服务端各自独立取数/独立护栏（见 `ResearchService::compare`），这里只负责
//! 双栏渲染：绝不把两条腿的估值/护栏数字混排在同一个卡片里，保持"分别验证"的语义可见。

use crate::api;
use crate::research::{CompletenessRow, DataSources, GuardBadge, RouteChips, ValuationBand};
use echo_contracts::{CompareLegView, CompareRequest, CompareResponse};
use leptos::*;

#[component]
fn CompareLegCard(leg: CompareLegView) -> impl IntoView {
    view! {
        <div class="answer-card compare-leg">
            <div class="answer-brand">
                <div class="answer-mark">
                    <i></i>
                    <span>{leg.ticker.clone()}</span>
                </div>
            </div>
            <ValuationBand v=leg.valuation.clone() />
            <CompletenessRow completeness=leg.data_completeness />
            <DataSources sources=leg.connected_sources.clone() />
            {leg.fact_guard.clone().map(|g| view! { <GuardBadge guard=g /> })}
        </div>
    }
}

#[component]
pub fn ComparePage() -> impl IntoView {
    let (question, set_question) = create_signal(String::new());
    let (primary_ticker, set_primary_ticker) = create_signal(String::new());
    let (peer_ticker, set_peer_ticker) = create_signal(String::new());

    let run = create_action(|input: &CompareRequest| {
        let input = input.clone();
        async move { api::post::<_, CompareResponse>("/api/compare", &input).await }
    });

    let submit = move || {
        let question = question.get().trim().to_string();
        let primary = primary_ticker.get().trim().to_uppercase();
        let peer = peer_ticker.get().trim().to_uppercase();
        if question.is_empty() || primary.is_empty() || peer.is_empty() {
            return;
        }
        run.dispatch(CompareRequest {
            question,
            primary_ticker: primary,
            peer_ticker: peer,
        });
    };

    view! {
        <header class="page-header">
            <p class="eyebrow">"COMPARE / TWO LEGS"</p>
            <h1>"双主体对比"</h1>
            <p>"两家公司各自独立取数、独立护栏核对，绝不把一家的数字算作另一家的支持证据。"</p>
        </header>
        <main class="page-content">
            <section class="inline-form compare-form">
                <input
                    placeholder="主体 Ticker，如 AAPL"
                    prop:value=primary_ticker
                    on:input=move |ev| set_primary_ticker.set(event_target_value(&ev))
                />
                <span class="compare-vs">"对比"</span>
                <input
                    placeholder="对照 Ticker，如 MSFT"
                    prop:value=peer_ticker
                    on:input=move |ev| set_peer_ticker.set(event_target_value(&ev))
                />
                <input
                    class="compare-question"
                    placeholder="想对比什么？如：利润质量 / 估值贵不贵"
                    prop:value=question
                    on:input=move |ev| set_question.set(event_target_value(&ev))
                    on:keydown=move |ev| if ev.key() == "Enter" { submit() }
                />
                <button
                    class="primary-button compact"
                    disabled=move || run.pending().get()
                    on:click=move |_| submit()
                >
                    {move || if run.pending().get() { "对比中…" } else { "开始对比" }}
                </button>
            </section>

            {move || match run.value().get() {
                None => ().into_view(),
                Some(Err(error)) => view! { <p class="form-error">{error}</p> }.into_view(),
                Some(Ok(response)) => view! { <CompareResult response=response /> }.into_view(),
            }}
        </main>
    }
}

#[component]
fn CompareResult(response: CompareResponse) -> impl IntoView {
    let answer_html = response
        .answer
        .clone()
        .map(|text| crate::markdown::render(&text));
    view! {
        <div class="compare-result">
            <RouteChips route=response.route.clone() />
            <div class="compare-columns">
                <CompareLegCard leg=response.primary.clone() />
                <CompareLegCard leg=response.peer.clone() />
            </div>
            <div class="answer-card compare-answer">
                <p class="answer-source-label">"作答 · " {response.answer_source.as_str()}</p>
                {match answer_html {
                    Some(html) => view! { <div class="answer-text" inner_html=html></div> }.into_view(),
                    None => view! {
                        <p class="answer-unavailable">"未核到模型作答（未配 provider）——仅给两腿结构化事实，不臆造。"</p>
                    }.into_view(),
                }}
            </div>
        </div>
    }
}
