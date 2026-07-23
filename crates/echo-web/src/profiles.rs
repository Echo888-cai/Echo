//! 公司档案页（Leptos）——`GET/PUT/DELETE /api/profiles[/:ticker]` 的 Web 编辑接线。
//!
//! 对标 honeclaw 的 Markdown 长期记忆，但每条数字仍经护栏核对（见 `CompanyProfileDetail`
//! 的 valuation_* 字段），此页只做手动编辑；研究会话自动沉淀 thesis/bull/bear 仍待产品判断
//! （IMPROVEMENT_PLAN §4 P3-2 pending 项），本页不实现。

use crate::api;
use echo_contracts::{
    CompanyProfileDetail, CompanyProfileResponse, CompanyProfileUpsertRequest,
    CompanyProfilesListResponse, Decimal, MutationResponse,
};
use leptos::*;

fn lines_to_vec(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn vec_to_lines(items: &[String]) -> String {
    items.join("\n")
}

#[derive(Clone, Default)]
struct EditForm {
    company_name: String,
    thesis: String,
    research_status: String,
    confidence: String,
    bull: String,
    bear: String,
    monitors: String,
    falsifiers: String,
    profile_md: String,
}

impl From<&CompanyProfileDetail> for EditForm {
    fn from(detail: &CompanyProfileDetail) -> Self {
        Self {
            company_name: detail.company_name.clone().unwrap_or_default(),
            thesis: detail.thesis.clone().unwrap_or_default(),
            research_status: detail.research_status.clone().unwrap_or_default(),
            confidence: detail.confidence.clone().unwrap_or_default(),
            bull: vec_to_lines(&detail.bull),
            bear: vec_to_lines(&detail.bear),
            monitors: vec_to_lines(&detail.monitors),
            falsifiers: vec_to_lines(&detail.falsifiers),
            profile_md: detail.profile_md.clone().unwrap_or_default(),
        }
    }
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn decimal_text(value: Option<Decimal>) -> String {
    value
        .map(|value| value.normalize().to_string())
        .unwrap_or_else(|| "—".to_string())
}

#[component]
pub fn ProfilesSection() -> impl IntoView {
    let (selected, set_selected) = create_signal(None::<String>);
    let (new_ticker, set_new_ticker) = create_signal(String::new());

    let list = create_resource(
        || (),
        |_| api::get::<CompanyProfilesListResponse>("/api/profiles"),
    );

    let detail = create_resource(
        move || selected.get(),
        |ticker| async move {
            match ticker {
                Some(ticker) => Some(
                    api::get::<CompanyProfileResponse>(&format!("/api/profiles/{ticker}")).await,
                ),
                None => None,
            }
        },
    );

    let (form, set_form) = create_signal(EditForm::default());
    let (form_ticker, set_form_ticker) = create_signal(String::new());
    create_effect(move |_| {
        if let Some(Some(Ok(response))) = detail.get() {
            match response.profile {
                Some(profile) => {
                    set_form.set(EditForm::from(&profile));
                    set_form_ticker.set(profile.ticker);
                }
                None => {
                    // 尚无档案（首次为该 ticker 建档）——留一张空表单，ticker 取自选中值。
                    set_form.set(EditForm::default());
                    if let Some(ticker) = selected.get_untracked() {
                        set_form_ticker.set(ticker);
                    }
                }
            }
        }
    });

    let save = create_action(|input: &(String, CompanyProfileUpsertRequest)| {
        let (ticker, body) = input.clone();
        async move {
            api::put::<_, CompanyProfileDetail>(&format!("/api/profiles/{ticker}"), &body)
                .await
                .map(|_| ticker)
        }
    });
    create_effect(move |_| {
        if matches!(save.value().get(), Some(Ok(_))) {
            list.refetch();
            detail.refetch();
        }
    });

    let delete = create_action(|ticker: &String| {
        let ticker = ticker.clone();
        async move {
            api::delete::<MutationResponse>(&format!("/api/profiles/{ticker}"))
                .await
                .map(|_| ticker)
        }
    });
    create_effect(move |_| {
        if let Some(Ok(deleted_ticker)) = delete.value().get() {
            list.refetch();
            if selected.get_untracked().as_deref() == Some(deleted_ticker.as_str()) {
                set_selected.set(None);
            }
        }
    });

    let submit_save = move || {
        let ticker = form_ticker.get().trim().to_uppercase();
        if ticker.is_empty() {
            return;
        }
        let f = form.get();
        save.dispatch((
            ticker,
            CompanyProfileUpsertRequest {
                company_name: non_empty(f.company_name),
                thesis: non_empty(f.thesis),
                research_status: non_empty(f.research_status),
                confidence: non_empty(f.confidence),
                bull: Some(lines_to_vec(&f.bull)),
                bear: Some(lines_to_vec(&f.bear)),
                monitors: Some(lines_to_vec(&f.monitors)),
                falsifiers: Some(lines_to_vec(&f.falsifiers)),
                valuation_method: None,
                valuation_bear: None,
                valuation_base: None,
                valuation_bull: None,
                valuation_current_price: None,
                profile_md: non_empty(f.profile_md),
            },
        ));
    };

    view! {
        <section class="library-section profiles-page">
            <p class="section-note">"长期研究记忆——论点、多空逻辑、监控项与证伪条件；手动编辑，估值字段由研究会话写入。"</p>
            <section class="inline-form">
                <input
                    placeholder="新建档案，输入 Ticker"
                    prop:value=new_ticker
                    on:input=move |ev| set_new_ticker.set(event_target_value(&ev).to_uppercase())
                />
                <button
                    class="primary-button compact"
                    on:click=move |_| {
                        let ticker = new_ticker.get().trim().to_uppercase();
                        if !ticker.is_empty() {
                            set_selected.set(Some(ticker.clone()));
                            set_form_ticker.set(ticker);
                            set_form.set(EditForm::default());
                            set_new_ticker.set(String::new());
                        }
                    }
                >"新建 / 打开"</button>
            </section>

            <div class="profiles-layout">
                <div class="profiles-list">
                    {move || match list.get() {
                        None => view! { <p class="page-state">"读取中…"</p> }.into_view(),
                        Some(Err(error)) => view! { <p class="page-state form-error">{error}</p> }.into_view(),
                        Some(Ok(data)) if data.profiles.is_empty() => {
                            view! { <p class="page-state">"还没有公司档案。"</p> }.into_view()
                        }
                        Some(Ok(data)) => {
                            let active = selected.get();
                            data.profiles.into_iter().map(|item| {
                                let is_active = active.as_deref() == Some(item.ticker.as_str());
                                let go_ticker = item.ticker.clone();
                                view! {
                                    <button
                                        class=if is_active { "session-item-main profile-item is-active" } else { "session-item-main profile-item" }
                                        on:click=move |_| set_selected.set(Some(go_ticker.clone()))
                                    >
                                        <span class="session-item-title">
                                            {item.company_name.clone().unwrap_or_else(|| item.ticker.clone())}
                                            " · " {item.ticker.clone()}
                                        </span>
                                        <span class="session-item-meta">
                                            {item.research_status.clone().unwrap_or_else(|| "未标注".to_string())}
                                            " · 置信 " {item.confidence.clone().unwrap_or_else(|| "—".to_string())}
                                            " · " {item.turn_count} " 轮 · " {item.updated_at.clone()}
                                        </span>
                                    </button>
                                }
                            }).collect_view()
                        }
                    }}
                </div>

                <div class="profiles-editor">
                    {move || if selected.get().is_none() {
                        view! { <p class="page-state">"从左侧选择一份档案，或新建一个。"</p> }.into_view()
                    } else {
                        let show_valuation = detail.get()
                            .and_then(|inner| inner)
                            .and_then(Result::ok)
                            .and_then(|response| response.profile);
                        view! {
                            <div class="settings-card profile-form">
                                <h2>{move || form_ticker.get()}</h2>
                                <label>"公司名称"
                                    <input
                                        prop:value=move || form.get().company_name
                                        on:input=move |ev| set_form.update(|f| f.company_name = event_target_value(&ev))
                                    />
                                </label>
                                <label>"研究状态（如 building / conviction / watch）"
                                    <input
                                        prop:value=move || form.get().research_status
                                        on:input=move |ev| set_form.update(|f| f.research_status = event_target_value(&ev))
                                    />
                                </label>
                                <label>"置信度（如 high / medium / low）"
                                    <input
                                        prop:value=move || form.get().confidence
                                        on:input=move |ev| set_form.update(|f| f.confidence = event_target_value(&ev))
                                    />
                                </label>
                                <label>"核心论点"
                                    <textarea
                                        rows="3"
                                        prop:value=move || form.get().thesis
                                        on:input=move |ev| set_form.update(|f| f.thesis = event_target_value(&ev))
                                    ></textarea>
                                </label>
                                <label>"多头逻辑（每行一条）"
                                    <textarea
                                        rows="4"
                                        prop:value=move || form.get().bull
                                        on:input=move |ev| set_form.update(|f| f.bull = event_target_value(&ev))
                                    ></textarea>
                                </label>
                                <label>"空头逻辑（每行一条）"
                                    <textarea
                                        rows="4"
                                        prop:value=move || form.get().bear
                                        on:input=move |ev| set_form.update(|f| f.bear = event_target_value(&ev))
                                    ></textarea>
                                </label>
                                <label>"监控项（每行一条）"
                                    <textarea
                                        rows="3"
                                        prop:value=move || form.get().monitors
                                        on:input=move |ev| set_form.update(|f| f.monitors = event_target_value(&ev))
                                    ></textarea>
                                </label>
                                <label>"证伪条件（每行一条）"
                                    <textarea
                                        rows="3"
                                        prop:value=move || form.get().falsifiers
                                        on:input=move |ev| set_form.update(|f| f.falsifiers = event_target_value(&ev))
                                    ></textarea>
                                </label>
                                <label>"自由笔记（Markdown）"
                                    <textarea
                                        rows="6"
                                        prop:value=move || form.get().profile_md
                                        on:input=move |ev| set_form.update(|f| f.profile_md = event_target_value(&ev))
                                    ></textarea>
                                </label>

                                {show_valuation.map(|p| view! {
                                    <p class="muted profile-valuation-readout">
                                        "研究会话写入的估值（只读）：" {p.valuation_method.unwrap_or_else(|| "未核到".to_string())}
                                        " · 熊 " {decimal_text(p.valuation_bear)}
                                        " · 基准 " {decimal_text(p.valuation_base)}
                                        " · 牛 " {decimal_text(p.valuation_bull)}
                                    </p>
                                })}

                                {move || save.value().get().and_then(Result::err).map(|error| view! { <p class="form-error">{error}</p> })}
                                {move || matches!(save.value().get(), Some(Ok(_))).then(|| view! { <p class="form-success">"已保存"</p> })}

                                <div class="card-actions">
                                    <button class="primary-button compact" disabled=move || save.pending().get() on:click=move |_| submit_save()>
                                        {move || if save.pending().get() { "保存中…" } else { "保存档案" }}
                                    </button>
                                    <button
                                        class="danger-link"
                                        on:click=move |_| {
                                            let ticker = form_ticker.get_untracked();
                                            if !ticker.is_empty() {
                                                delete.dispatch(ticker);
                                            }
                                        }
                                    >"删除档案"</button>
                                </div>
                            </div>
                        }.into_view()
                    }}
                </div>
            </div>
        </section>
    }
}
