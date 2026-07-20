//! Echo Research 前端（Leptos/WASM）——绞杀 React/PWA。
//!
//! 本阶段落"研究对话优先"外壳 + 决策面板：输入问题与研究对象（ticker），打 `echo-api` 的
//! `/api/ask`，把返回的意图路由 / 定点估值区间 / 连通数据源 / 数据完备度 / 作答按 Echo 视觉渲染。
//! UX/动效/视觉质感按一等验收项对齐（用户约束），不是先跑通再补。
//!
//! 显式 seam（逐屏搬 `apps/web` 时接上）：公司解析（问题→ticker，现由显式输入代替）、
//! 流式 SSE 作答、watch/portfolio/settings 路由、auth 边界。

use leptos::*;
use serde::{Deserialize, Serialize};

/// 请求体——最小可用：问题 + 研究对象。公司解析闭环迁入前，ticker 由用户显式给出。
#[derive(Serialize, Clone)]
struct AskRequest {
    question: String,
    ticker: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name_zh: Option<String>,
}

/// 与 `echo-api::AskResponse` 同形（只取前端要渲染的字段）。定点数在边界处以字符串下发，
/// 前端不重算金融数字（红线 4）——只做展示。
#[derive(Deserialize, Clone, Debug)]
struct AskResponse {
    ticker: String,
    route: RouteView,
    data_completeness: u8,
    connected_sources: Vec<String>,
    valuation: ValuationView,
    #[serde(default)]
    answer: Option<String>,
    answer_source: String,
    #[serde(default)]
    fact_guard: Option<GuardView>,
}

#[derive(Deserialize, Clone, Debug)]
struct RouteView {
    intent: String,
    depth: String,
    confidence: f64,
    answer_style: String,
}

#[derive(Deserialize, Clone, Debug)]
struct ValuationView {
    method: String,
    #[serde(default)]
    bear: Option<String>,
    #[serde(default)]
    base: Option<String>,
    #[serde(default)]
    bull: Option<String>,
    #[serde(default)]
    upside: Option<String>,
    #[serde(default)]
    current_price: Option<String>,
    #[serde(default)]
    cannot_value_reason: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct GuardView {
    total: usize,
    pass: usize,
    soft: usize,
    hard: usize,
    has_hard_fail: bool,
    #[serde(default)]
    soft_note: String,
}

/// 打 `/api/ask`（wasm 目标：浏览器 fetch）。返回 Err(消息) 时前端如实显示"请求未成功"，不静默吞。
#[cfg(target_arch = "wasm32")]
async fn fetch_ask(req: AskRequest) -> Result<AskResponse, String> {
    use gloo_net::http::Request;
    let resp = Request::post("/api/ask")
        .json(&req)
        .map_err(|e| format!("构造请求失败：{e}"))?
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;
    if !resp.ok() {
        return Err(format!("服务返回 {}", resp.status()));
    }
    resp.json::<AskResponse>()
        .await
        .map_err(|e| format!("解析返回失败：{e}"))
}

/// 原生目标存根——echo-web 只在 wasm 运行时联网。此版本仅供 workspace 原生类型检查通过组件逻辑，
/// 永不在浏览器执行。参数标记为已用以免未使用告警。
#[cfg(not(target_arch = "wasm32"))]
async fn fetch_ask(_req: AskRequest) -> Result<AskResponse, String> {
    Err("网络仅在 wasm 目标可用".to_string())
}

/// 中文意图标签——路由 intent 的展示名。未知的原样回显。
fn intent_label(intent: &str) -> &str {
    match intent {
        "valuation" => "估值判断",
        "financial_quality" => "利润质量",
        "moat" => "护城河",
        "falsification" => "证伪条件",
        "comparison" => "对比研究",
        "momentum" => "动量与预期",
        "risk" => "风险与赔率",
        "thesis" => "多空逻辑",
        "general" => "综合研究",
        other => other,
    }
}

#[component]
fn ValuationBand(v: ValuationView) -> impl IntoView {
    // 给不出带子就如实说未核到，绝不硬凑数字。
    if let Some(reason) = v.cannot_value_reason.clone() {
        return view! {
            <div class="echo-valuation echo-valuation--none">
                <span class="echo-valuation__label">"估值区间"</span>
                <span class="echo-unverified">"未核到 · " {reason}</span>
            </div>
        }
        .into_view();
    }
    let dash = || "—".to_string();
    view! {
        <div class="echo-valuation">
            <div class="echo-valuation__head">
                <span class="echo-valuation__label">"估值区间"</span>
                <span class="echo-valuation__method">{v.method.clone()}</span>
                {v.upside.clone().map(|u| view! { <span class="echo-chip echo-chip--upside">{u}</span> })}
            </div>
            <div class="echo-band">
                <div class="echo-band__cell">
                    <span class="echo-band__k">"熊"</span>
                    <span class="echo-band__v">{v.bear.clone().unwrap_or_else(dash)}</span>
                </div>
                <div class="echo-band__cell echo-band__cell--base">
                    <span class="echo-band__k">"基准"</span>
                    <span class="echo-band__v">{v.base.clone().unwrap_or_else(dash)}</span>
                </div>
                <div class="echo-band__cell">
                    <span class="echo-band__k">"牛"</span>
                    <span class="echo-band__v">{v.bull.clone().unwrap_or_else(dash)}</span>
                </div>
            </div>
            {v.current_price.clone().map(|p| view! {
                <p class="echo-valuation__price">"现价 " <strong>{p}</strong></p>
            })}
        </div>
    }
    .into_view()
}

#[component]
fn ResultPanel(res: AskResponse) -> impl IntoView {
    let completeness = res.data_completeness;
    let conf_pct = (res.route.confidence * 100.0).round() as i32;
    let answer_block = match res.answer.clone() {
        Some(text) => view! { <p class="echo-answer__text">{text}</p> }.into_view(),
        None => view! {
            <p class="echo-answer__text echo-unverified">
                "未核到模型作答（未配 provider / 生成失败）——本轮只给结构化事实，不臆造。"
            </p>
        }
        .into_view(),
    };

    view! {
        <article class="echo-result">
            <div class="echo-result__top">
                <span class="echo-ticker">{res.ticker.clone()}</span>
                <span class="echo-chip">{intent_label(&res.route.intent).to_string()}</span>
                <span class="echo-chip echo-chip--soft">{res.route.depth.clone()}</span>
                <span class="echo-chip echo-chip--soft">{res.route.answer_style.clone()} " · 置信 " {conf_pct} "%"</span>
            </div>

            <ValuationBand v=res.valuation.clone() />

            <div class="echo-completeness">
                <div class="echo-completeness__bar">
                    <span class="echo-completeness__fill" style=move || format!("width:{completeness}%")></span>
                </div>
                <span class="echo-completeness__label">"数据完备度 " {completeness} "%"</span>
            </div>

            <div class="echo-sources">
                {if res.connected_sources.is_empty() {
                    view! { <span class="echo-unverified">"暂无连通数据源（本轮多为定性判断）"</span> }.into_view()
                } else {
                    res.connected_sources.iter().cloned().map(|s| view! {
                        <span class="echo-source">{s}</span>
                    }).collect_view()
                }}
            </div>

            <section class="echo-answer">
                <span class="echo-answer__k">"作答 · " {res.answer_source.clone()}</span>
                {answer_block}
            </section>

            {res.fact_guard.clone().map(|g| view! {
                <div class=move || if g.has_hard_fail { "echo-guard echo-guard--hard" } else { "echo-guard" }>
                    <span class="echo-guard__k">"数字护栏"</span>
                    <span>"核 " {g.total} " · 过 " {g.pass} " · 软 " {g.soft} " · 硬 " {g.hard}</span>
                    {(!g.soft_note.is_empty()).then(|| view! { <p class="echo-guard__note">{g.soft_note.clone()}</p> })}
                </div>
            })}
        </article>
    }
}

/// 应用根组件——研究对话优先外壳。
#[component]
pub fn App() -> impl IntoView {
    let (question, set_question) = create_signal(String::new());
    let (ticker, set_ticker) = create_signal(String::new());

    // 异步作答动作：把 (问题, ticker) 打给 /api/ask，value() 存最新结果。
    let ask = create_action(|req: &AskRequest| {
        let req = req.clone();
        async move { fetch_ask(req).await }
    });
    let pending = ask.pending();
    let result = ask.value();

    let submit = move || {
        let (q, t) = (
            question.get().trim().to_string(),
            ticker.get().trim().to_uppercase(),
        );
        if q.is_empty() || t.is_empty() {
            return;
        }
        ask.dispatch(AskRequest {
            question: q,
            ticker: t,
            name_zh: None,
        });
    };

    view! {
        <main class="echo-shell">
            <header class="echo-topbar">
                <span class="echo-brand">"Echo"</span>
                <span class="echo-brand-sub">"EVIDENCE RESEARCH"</span>
                <span class="echo-stack-badge">"rust · leptos"</span>
            </header>

            <section class="echo-research">
                <p class="echo-hint">"研究一家美股 / 港股科技公司 —— 利润、护城河、估值或证伪条件"</p>
                <div class="echo-form">
                    <input
                        class="echo-ask"
                        prop:value=question
                        on:input=move |ev| set_question.set(event_target_value(&ev))
                        on:keydown=move |ev| if ev.key() == "Enter" { submit() }
                        placeholder="你的问题，例如：苹果现在的估值贵不贵？"
                    />
                    <input
                        class="echo-ticker-input"
                        prop:value=ticker
                        on:input=move |ev| set_ticker.set(event_target_value(&ev))
                        on:keydown=move |ev| if ev.key() == "Enter" { submit() }
                        placeholder="研究对象，如 AAPL / 9988.HK"
                    />
                    <button class="echo-submit" on:click=move |_| submit() disabled=move || pending.get()>
                        {move || if pending.get() { "研究中…" } else { "研究" }}
                    </button>
                </div>

                <div class="echo-output">
                    {move || match result.get() {
                        None => view! { <p class="echo-idle">"输入问题与研究对象，开始一轮基于真实数据的研究。"</p> }.into_view(),
                        Some(Ok(res)) => view! { <ResultPanel res=res /> }.into_view(),
                        Some(Err(msg)) => view! { <p class="echo-error">"请求未成功：" {msg}</p> }.into_view(),
                    }}
                </div>
            </section>
        </main>
    }
}

/// WASM 挂载入口（仅 wasm32 目标编译；native 构建用于类型检查，不进入运行时）。
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    _ = console_error_panic_hook();
    leptos::mount_to_body(App);
}

/// 极简 panic→控制台钩子，无外部依赖：崩溃信息打到 leptos 日志（浏览器 console.error）。
#[cfg(target_arch = "wasm32")]
fn console_error_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        leptos::logging::error!("echo-web panic: {info}");
    }));
}
