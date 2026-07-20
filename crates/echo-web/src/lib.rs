//! Echo Research 前端（Leptos/WASM）——绞杀 React/PWA。
//!
//! 本阶段落"研究对话优先"外壳与研究面板的 Leptos 组件骨架；数据经 `echo-api` 的 `/api/ask`
//! 拉取。逐屏迁移 `apps/web` 时，UX/动效/视觉质感按一等验收项对齐（用户约束），不是先跑通再补。

use leptos::*;

/// 应用根组件——研究对话优先外壳。
#[component]
pub fn App() -> impl IntoView {
    let (question, set_question) = create_signal(String::new());

    view! {
        <main class="echo-shell">
            <header class="echo-topbar">
                <span class="echo-brand">"Echo"</span>
                <span class="echo-brand-sub">"EVIDENCE RESEARCH"</span>
            </header>
            <section class="echo-research">
                <p class="echo-hint">"继续追问：利润、护城河、估值或证伪条件"</p>
                <input
                    class="echo-ask"
                    prop:value=question
                    on:input=move |ev| set_question.set(event_target_value(&ev))
                    placeholder="研究一家美股 / 港股科技公司…"
                />
            </section>
        </main>
    }
}

/// WASM 挂载入口（仅 wasm32 目标编译；native 构建用于类型检查，不进入运行时）。
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    leptos::mount_to_body(App);
}
