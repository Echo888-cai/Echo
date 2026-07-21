use crate::{api, research::ResearchPage};
use echo_contracts::{
    AuthLoginRequest, AuthLogoutResponse, AuthRegisterRequest, AuthUserResponse,
    ChangedCountResponse, Decimal, MutationResponse, NotificationReadRequest,
    NotificationsListResponse, PortfolioListResponse, PortfolioUpsertRequest, PreferencesResponse,
    PreferencesUpdateRequest, PublicUser, UnreadResponse, WatchListResponse, WatchMutationRequest,
};
use leptos::*;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Page {
    /// 研究页——可选携带会话 id，对应深链 `/research/:session_id`。
    Research(Option<String>),
    Watch,
    Portfolio,
    Settings,
}

impl Page {
    #[cfg(target_arch = "wasm32")]
    fn path(&self) -> String {
        match self {
            Self::Research(None) => "/research".to_string(),
            Self::Research(Some(id)) => format!("/research/{id}"),
            Self::Watch => "/watch".to_string(),
            Self::Portfolio => "/portfolio".to_string(),
            Self::Settings => "/settings".to_string(),
        }
    }

    const fn label(&self) -> &'static str {
        match self {
            Self::Research(_) => "研究",
            Self::Watch => "自选",
            Self::Portfolio => "持仓",
            Self::Settings => "设置",
        }
    }

    /// 导航栏高亮只看落在哪个 tab，不看研究页携带的具体会话 id。
    fn same_tab(&self, other: &Page) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

#[cfg(target_arch = "wasm32")]
fn page_from_path(path: &str) -> Page {
    if let Some(rest) = path.strip_prefix("/research/") {
        let id = rest.trim_matches('/');
        return Page::Research((!id.is_empty()).then(|| id.to_string()));
    }
    match path {
        "/watch" => Page::Watch,
        "/portfolio" => Page::Portfolio,
        "/settings" => Page::Settings,
        _ => Page::Research(None),
    }
}

#[cfg(target_arch = "wasm32")]
fn initial_page() -> Page {
    page_from_path(&leptos::window().location().pathname().unwrap_or_default())
}

#[cfg(not(target_arch = "wasm32"))]
fn initial_page() -> Page {
    Page::Research(None)
}

fn navigate(set_page: WriteSignal<Page>, page: Page) {
    #[cfg(target_arch = "wasm32")]
    let path = page.path();
    set_page.set(page);
    #[cfg(target_arch = "wasm32")]
    if let Ok(history) = leptos::window().history() {
        let _ = history.push_state_with_url(&wasm_bindgen::JsValue::NULL, "", Some(&path));
    }
}

/// 监听浏览器前进/后退——`navigate` 只 `push_state` 不够，URL 变了页面得跟着变，
/// 否则后退键在地址栏里动了但视图纹丝不动。
#[cfg(target_arch = "wasm32")]
fn install_popstate_listener(set_page: WriteSignal<Page>) {
    let handle = leptos::window_event_listener(leptos::ev::popstate, move |_| {
        let path = leptos::window().location().pathname().unwrap_or_default();
        set_page.set(page_from_path(&path));
    });
    on_cleanup(move || handle.remove());
}

#[cfg(not(target_arch = "wasm32"))]
fn install_popstate_listener(_set_page: WriteSignal<Page>) {}

#[component]
pub fn Workspace(user: PublicUser, on_auth_changed: Callback<()>) -> impl IntoView {
    let (page, set_page) = create_signal(initial_page());
    install_popstate_listener(set_page);
    let logout = create_action(|_: &()| async {
        api::post::<_, AuthLogoutResponse>("/api/auth/logout", &serde_json::json!({})).await
    });
    create_effect(move |_| {
        if matches!(logout.value().get(), Some(Ok(_))) {
            on_auth_changed.call(());
        }
    });
    let display_name = user
        .display_name
        .clone()
        .unwrap_or_else(|| user.username.clone());
    let on_research_navigate = Callback::new(move |session_id: Option<String>| {
        navigate(set_page, Page::Research(session_id))
    });

    view! {
        <div class="app-shell">
            <header class="echo-topbar workspace-topbar">
                <button class="echo-brand brand-button" on:click=move |_| navigate(set_page, Page::Research(None))>
                    <div class="echo-brand-mark">
                        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 26 L16 6 L26 26" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M9.5 19.5 H22.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <span class="echo-brand-name">"Echo"</span>
                    <span class="echo-brand-sub">"Research"</span>
                </button>
                <nav class="workspace-nav" aria-label="主导航">
                    {[Page::Research(None), Page::Watch, Page::Portfolio, Page::Settings]
                        .into_iter()
                        .map(|item| {
                            let item_for_class = item.clone();
                            let item_for_click = item.clone();
                            view! {
                                <button
                                    class=move || if page.get().same_tab(&item_for_class) { "nav-item is-active" } else { "nav-item" }
                                    on:click=move |_| navigate(set_page, item_for_click.clone())
                                >{item.label()}</button>
                            }
                        })
                        .collect_view()}
                </nav>
                <div class="topbar-actions">
                    <NotificationsPanel />
                    <span class="user-chip">{display_name}</span>
                    <button class="quiet-button" on:click=move |_| logout.dispatch(())>"退出"</button>
                </div>
            </header>
            <section class="workspace-stage">
                {move || match page.get() {
                    Page::Research(session_id) => view! {
                        <ResearchPage initial_session=session_id on_navigate=on_research_navigate />
                    }.into_view(),
                    Page::Watch => view! { <WatchPage on_research=Callback::new(move |_| navigate(set_page, Page::Research(None))) /> }.into_view(),
                    Page::Portfolio => view! { <PortfolioPage /> }.into_view(),
                    Page::Settings => view! { <SettingsPage /> }.into_view(),
                }}
            </section>
        </div>
    }
}

#[derive(Clone)]
struct AuthSubmission {
    register: bool,
    username: String,
    password: String,
    invite: String,
    display_name: String,
}

#[component]
pub fn LoginPage(on_authenticated: Callback<()>) -> impl IntoView {
    let (register, set_register) = create_signal(false);
    let (username, set_username) = create_signal(String::new());
    let (password, set_password) = create_signal(String::new());
    let (invite, set_invite) = create_signal(String::new());
    let (display_name, set_display_name) = create_signal(String::new());
    let submit = create_action(|input: &AuthSubmission| {
        let input = input.clone();
        async move {
            if input.register {
                api::post::<_, AuthUserResponse>(
                    "/api/auth/register",
                    &AuthRegisterRequest {
                        invite: input.invite,
                        username: input.username,
                        password: input.password,
                        display_name: (!input.display_name.trim().is_empty())
                            .then_some(input.display_name),
                    },
                )
                .await
            } else {
                api::post::<_, AuthUserResponse>(
                    "/api/auth/login",
                    &AuthLoginRequest {
                        username: input.username,
                        password: input.password,
                    },
                )
                .await
            }
        }
    });
    create_effect(move |_| {
        if matches!(submit.value().get(), Some(Ok(_))) {
            on_authenticated.call(());
        }
    });
    let dispatch = move || {
        submit.dispatch(AuthSubmission {
            register: register.get(),
            username: username.get().trim().to_string(),
            password: password.get(),
            invite: invite.get().trim().to_string(),
            display_name: display_name.get().trim().to_string(),
        });
    };

    view! {
        <main class="auth-page">
            <section class="auth-story">
                <p class="eyebrow">"ECHO / EVIDENCE FIRST"</p>
                <h1>"让噪音退场，"<br/><em>"让证据发声。"</em></h1>
                <p>"面向美股与港股科技公司的研究工作台。事实、估值、证伪与复盘，归到同一条证据链。"</p>
            </section>
            <section class="auth-card">
                <div class="auth-tabs">
                    <button class=move || if !register.get() { "is-active" } else { "" } on:click=move |_| set_register.set(false)>"登录"</button>
                    <button class=move || if register.get() { "is-active" } else { "" } on:click=move |_| set_register.set(true)>"邀请码注册"</button>
                </div>
                <label>"邮箱 / 用户名"<input prop:value=username on:input=move |event| set_username.set(event_target_value(&event)) /></label>
                <label>"密码"<input type="password" prop:value=password on:input=move |event| set_password.set(event_target_value(&event)) on:keydown=move |event| if event.key() == "Enter" { dispatch() } /></label>
                {move || register.get().then(|| view! {
                    <div class="register-extra">
                        <label>"显示名称"<input prop:value=display_name on:input=move |event| set_display_name.set(event_target_value(&event)) /></label>
                        <label>"邀请码"<input prop:value=invite on:input=move |event| set_invite.set(event_target_value(&event)) /></label>
                    </div>
                })}
                {move || submit.value().get().and_then(Result::err).map(|message| view! { <p class="form-error">{message}</p> })}
                <button class="primary-button" disabled=move || submit.pending().get() on:click=move |_| dispatch()>
                    {move || if submit.pending().get() { "正在验证…" } else if register.get() { "创建账号" } else { "进入研究台" }}
                </button>
            </section>
        </main>
    }
}

#[component]
fn NotificationsPanel() -> impl IntoView {
    let (open, set_open) = create_signal(false);
    let unread = create_resource(
        || (),
        |_| api::get::<UnreadResponse>("/api/notifications/unread"),
    );
    let notifications = create_resource(
        || (),
        |_| api::get::<NotificationsListResponse>("/api/notifications?limit=20"),
    );
    let mark_all = create_action(|_: &()| async {
        api::post::<_, ChangedCountResponse>(
            "/api/notifications/read",
            &NotificationReadRequest { id: None },
        )
        .await
    });
    create_effect(move |_| {
        if matches!(mark_all.value().get(), Some(Ok(_))) {
            unread.refetch();
            notifications.refetch();
        }
    });
    view! {
        <div class="notification-center">
            <button class="notification-button" aria-label="通知" on:click=move |_| set_open.update(|value| *value = !*value)>
                "◌"
                {move || unread.get().and_then(Result::ok).filter(|value| value.unread > 0).map(|value| view! { <span>{value.unread}</span> })}
            </button>
            {move || open.get().then(|| view! {
                <div class="notification-popover">
                    <div class="popover-head"><strong>"通知"</strong><button on:click=move |_| mark_all.dispatch(())>"全部已读"</button></div>
                    {move || match notifications.get() {
                        None => view! { <p class="muted">"读取中…"</p> }.into_view(),
                        Some(Err(error)) => view! { <p class="form-error">{error}</p> }.into_view(),
                        Some(Ok(data)) if data.notifications.is_empty() => view! { <p class="muted">"暂无通知"</p> }.into_view(),
                        Some(Ok(data)) => data.notifications.into_iter().map(|item| view! {
                            <article class=if item.read_at.is_some() { "notice is-read" } else { "notice" }>
                                <strong>{item.title}</strong><p>{item.body}</p><time>{item.created_at}</time>
                            </article>
                        }).collect_view().into_view(),
                    }}
                </div>
            })}
        </div>
    }
}

#[derive(Clone)]
struct WatchAction {
    track: bool,
    ticker: String,
    company_name: Option<String>,
}

#[component]
fn WatchPage(on_research: Callback<()>) -> impl IntoView {
    let (ticker, set_ticker) = create_signal(String::new());
    let (company_name, set_company_name) = create_signal(String::new());
    let entries = create_resource(|| (), |_| api::get::<WatchListResponse>("/api/watch/list"));
    let mutate = create_action(|input: &WatchAction| {
        let input = input.clone();
        async move {
            api::post::<_, MutationResponse>(
                if input.track {
                    "/api/watch/track"
                } else {
                    "/api/watch/untrack"
                },
                &WatchMutationRequest {
                    ticker: input.ticker,
                    company_name: input.company_name,
                },
            )
            .await
        }
    });
    create_effect(move |_| {
        if matches!(mutate.value().get(), Some(Ok(_))) {
            entries.refetch();
        }
    });
    view! {
        <PageHeader eyebrow="WATCH / SIGNALS" title="自选与证据监控" detail="只保留你主动关注的对象；隐藏不是删除历史。" />
        <main class="page-content">
            <section class="inline-form">
                <input placeholder="Ticker，如 AAPL / 0700.HK" prop:value=ticker on:input=move |event| set_ticker.set(event_target_value(&event).to_uppercase()) />
                <input placeholder="公司名称（可选）" prop:value=company_name on:input=move |event| set_company_name.set(event_target_value(&event)) />
                <button class="primary-button compact" on:click=move |_| {
                    let value = ticker.get().trim().to_string();
                    if !value.is_empty() {
                        mutate.dispatch(WatchAction { track: true, ticker: value, company_name: (!company_name.get().trim().is_empty()).then(|| company_name.get()) });
                    }
                }>"加入自选"</button>
            </section>
            {move || match entries.get() {
                None => loading_view(),
                Some(Err(error)) => error_view(error),
                Some(Ok(data)) => {
                    let visible: Vec<_> = data.entries.into_iter().filter(|entry| entry.mode == "add").collect();
                    if visible.is_empty() { empty_view("还没有自选公司。") } else { view! {
                        <div class="card-grid">
                            {visible.into_iter().map(|entry| {
                                let remove_ticker = entry.ticker.clone();
                                view! { <article class="workspace-card">
                                    <p class="eyebrow">{entry.ticker.clone()}</p>
                                    <h3>{entry.company_name.unwrap_or_else(|| entry.ticker.clone())}</h3>
                                    <p class="muted">{"加入于 "}{entry.created_at}</p>
                                    <div class="card-actions">
                                        <button on:click=move |_| on_research.call(())>"开始研究"</button>
                                        <button class="danger-link" on:click=move |_| mutate.dispatch(WatchAction { track: false, ticker: remove_ticker.clone(), company_name: None })>"移出"</button>
                                    </div>
                                </article> }
                            }).collect_view()}
                        </div>
                    }.into_view() }
                },
            }}
        </main>
    }
}

#[component]
fn PortfolioPage() -> impl IntoView {
    let (ticker, set_ticker) = create_signal(String::new());
    let (company_name, set_company_name) = create_signal(String::new());
    let (shares, set_shares) = create_signal(String::new());
    let (avg_cost, set_avg_cost) = create_signal(String::new());
    let (form_error, set_form_error) = create_signal(None::<String>);
    let positions = create_resource(
        || (),
        |_| api::get::<PortfolioListResponse>("/api/portfolio"),
    );
    let save = create_action(|input: &PortfolioUpsertRequest| {
        let input = input.clone();
        async move { api::post::<_, echo_contracts::PortfolioPosition>("/api/portfolio", &input).await }
    });
    let remove = create_action(|ticker: &String| {
        let path = format!("/api/portfolio?ticker={ticker}");
        async move { api::delete::<MutationResponse>(&path).await }
    });
    create_effect(move |_| {
        if matches!(save.value().get(), Some(Ok(_))) || matches!(remove.value().get(), Some(Ok(_)))
        {
            positions.refetch();
        }
    });
    let submit = move || {
        let parsed_shares = shares.get().parse::<Decimal>();
        let parsed_cost = avg_cost.get().parse::<Decimal>();
        match (parsed_shares, parsed_cost) {
            (Ok(shares), Ok(avg_cost)) => {
                set_form_error.set(None);
                save.dispatch(PortfolioUpsertRequest {
                    ticker: ticker.get().trim().to_uppercase(),
                    company_name: (!company_name.get().trim().is_empty())
                        .then(|| company_name.get()),
                    shares,
                    avg_cost,
                    stop_loss: None,
                    take_profit: None,
                    note: String::new(),
                });
            }
            _ => set_form_error.set(Some("股数和成本必须是有效数字".into())),
        }
    };
    view! {
        <PageHeader eyebrow="PORTFOLIO / EXACT DECIMAL" title="持仓与成本" detail="股数、成本和盈亏全程使用十进制定点，不用二进制浮点。" />
        <main class="page-content">
            <section class="portfolio-form inline-form">
                <input placeholder="Ticker" prop:value=ticker on:input=move |event| set_ticker.set(event_target_value(&event).to_uppercase()) />
                <input placeholder="公司名称" prop:value=company_name on:input=move |event| set_company_name.set(event_target_value(&event)) />
                <input placeholder="股数" inputmode="decimal" prop:value=shares on:input=move |event| set_shares.set(event_target_value(&event)) />
                <input placeholder="平均成本" inputmode="decimal" prop:value=avg_cost on:input=move |event| set_avg_cost.set(event_target_value(&event)) />
                <button class="primary-button compact" on:click=move |_| submit()>"保存持仓"</button>
            </section>
            {move || form_error.get().map(|error| view! { <p class="form-error">{error}</p> })}
            {move || save.value().get().and_then(Result::err).map(|error| view! { <p class="form-error">{error}</p> })}
            {move || match positions.get() {
                None => loading_view(),
                Some(Err(error)) => error_view(error),
                Some(Ok(data)) if data.positions.is_empty() => empty_view("还没有持仓。"),
                Some(Ok(data)) => view! { <div class="portfolio-table">
                    <div class="table-row table-head"><span>"公司"</span><span>"股数"</span><span>"平均成本"</span><span>"风控线"</span><span></span></div>
                    {data.positions.into_iter().map(|position| {
                        let remove_ticker = position.ticker.clone();
                        view! { <div class="table-row">
                            <span><strong>{position.company_name}</strong><small>{position.ticker}</small></span>
                            <span>{decimal_text(position.shares)}</span>
                            <span>{decimal_text(position.avg_cost)}</span>
                            <span>{format!("{} / {}", decimal_text(position.stop_loss), decimal_text(position.take_profit))}</span>
                            <button class="danger-link" on:click=move |_| remove.dispatch(remove_ticker.clone())>"删除"</button>
                        </div> }
                    }).collect_view()}
                </div> }.into_view(),
            }}
        </main>
    }
}

#[component]
fn SettingsPage() -> impl IntoView {
    let (initialized, set_initialized) = create_signal(false);
    let (notify_digest, set_notify_digest) = create_signal(true);
    let (notify_positions, set_notify_positions) = create_signal(true);
    let (notify_falsify, set_notify_falsify) = create_signal(true);
    let (notify_review, set_notify_review) = create_signal(true);
    let (notify_earnings, set_notify_earnings) = create_signal(true);
    let (quiet_start, set_quiet_start) = create_signal(String::new());
    let (quiet_end, set_quiet_end) = create_signal(String::new());
    let preferences = create_resource(
        || (),
        |_| api::get::<PreferencesResponse>("/api/preferences"),
    );
    create_effect(move |_| {
        if initialized.get_untracked() {
            return;
        }
        if let Some(Ok(data)) = preferences.get() {
            let value = data.preferences;
            set_notify_digest.set(value.notify_digest);
            set_notify_positions.set(value.notify_positions);
            set_notify_falsify.set(value.notify_falsify);
            set_notify_review.set(value.notify_review);
            set_notify_earnings.set(value.notify_earnings);
            set_quiet_start.set(value.quiet_hours_start.unwrap_or_default());
            set_quiet_end.set(value.quiet_hours_end.unwrap_or_default());
            set_initialized.set(true);
        }
    });
    let save = create_action(|input: &PreferencesUpdateRequest| {
        let input = input.clone();
        async move { api::patch::<_, PreferencesResponse>("/api/preferences", &input).await }
    });
    view! {
        <PageHeader eyebrow="SETTINGS / SIGNAL HYGIENE" title="通知与免打扰" detail="开关在通知写入咽喉生效，后台作业无法绕过。" />
        <main class="page-content settings-grid">
            <section class="settings-card">
                <h2>"通知类型"</h2>
                <Toggle label="盘前 / 盘后摘要" value=notify_digest set_value=set_notify_digest />
                <Toggle label="仓位价格告警" value=notify_positions set_value=set_notify_positions />
                <Toggle label="证伪条件触线" value=notify_falsify set_value=set_notify_falsify />
                <Toggle label="定期研究复盘" value=notify_review set_value=set_notify_review />
                <Toggle label="业绩闭环" value=notify_earnings set_value=set_notify_earnings />
            </section>
            <section class="settings-card">
                <h2>"免打扰（UTC）"</h2>
                <p class="muted">"非紧急通知在该时段不产生；证伪和仓位告警仍会送达。留空即关闭。"</p>
                <div class="time-range">
                    <input type="time" prop:value=quiet_start on:input=move |event| set_quiet_start.set(event_target_value(&event)) />
                    <span>"至"</span>
                    <input type="time" prop:value=quiet_end on:input=move |event| set_quiet_end.set(event_target_value(&event)) />
                </div>
            </section>
            {move || preferences.get().and_then(Result::err).map(|error| view! { <p class="form-error">{error}</p> })}
            {move || save.value().get().map(|result| match result {
                Ok(_) => view! { <p class="form-success">"设置已保存"</p> }.into_view(),
                Err(error) => view! { <p class="form-error">{error}</p> }.into_view(),
            })}
            <button class="primary-button settings-save" disabled=move || save.pending().get() on:click=move |_| save.dispatch(PreferencesUpdateRequest {
                onboarding_completed: None,
                notify_digest: Some(notify_digest.get()),
                notify_positions: Some(notify_positions.get()),
                notify_falsify: Some(notify_falsify.get()),
                notify_review: Some(notify_review.get()),
                notify_earnings: Some(notify_earnings.get()),
                quiet_hours_start: Some(quiet_start.get()),
                quiet_hours_end: Some(quiet_end.get()),
            })>"保存设置"</button>
        </main>
    }
}

#[component]
fn Toggle(
    label: &'static str,
    value: ReadSignal<bool>,
    set_value: WriteSignal<bool>,
) -> impl IntoView {
    view! {
        <label class="toggle-row"><span>{label}</span><input type="checkbox" prop:checked=value on:change=move |event| set_value.set(event_target_checked(&event)) /></label>
    }
}

#[component]
fn PageHeader(eyebrow: &'static str, title: &'static str, detail: &'static str) -> impl IntoView {
    view! { <header class="page-header"><p class="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></header> }
}

fn decimal_text(value: Option<Decimal>) -> String {
    value
        .map(|value| value.normalize().to_string())
        .unwrap_or_else(|| "—".into())
}

fn loading_view() -> View {
    view! { <p class="page-state">"读取中…"</p> }.into_view()
}

fn error_view(error: String) -> View {
    view! { <p class="page-state form-error">{error}</p> }.into_view()
}

fn empty_view(message: &'static str) -> View {
    view! { <p class="page-state">{message}</p> }.into_view()
}
