//! Echo Research HTTP 边界（axum）——绞杀 Hono+tRPC 的 `/api` 面。
//!
//!   * `GET  /health`  —— 存活探针
//!   * `POST /api/ask` —— 研究入口：吃 { question, ticker, 行情/财报字段, 可选 draft_answer }，
//!                        经 `echo-domain` 跑**整条纯核**——意图路由 → 定点估值 → 决策面板 →
//!                        （给了草稿答案时）数字护栏——返回结构化结果。
//!
//! 取数（DB/行情/网页）由 `echo-db` 注入、模型网关与 SSE 流式作答随后接上；此处刻意让
//! 意图路由 + 估值 + 数字护栏这条**正确性关键路径先整体跑在 Rust 定点上**，因为它正是
//! 研究质量的病灶所在。单公司硬取值：面板与护栏只吃本请求这一家公司的财务事实，
//! 跨公司污染（"问苹果答腾讯"）在类型层面就发生不了。

use axum::extract::State;
use axum::{Json, Router, routing::get, routing::post};
use echo_application::model_gateway::{AuditContext, ModelAnswerOptions, model_answer};
use echo_application::{
    AnswerContext, ResolvedCompany, build_panel, build_system_prompt, build_user_prompt,
    market_snapshot_from_rows, resolved_company_from_rows,
};
use echo_db::{CompanyRepository, MarketRepository, Pool};
use echo_domain::{
    Company, Financials, MarketSnapshot, RegistrySources, build_facts_registry, build_soft_note,
    route_research_intent, verify_answer_numbers,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Deserialize)]
struct AskRequest {
    question: String,
    ticker: String,
    name_zh: Option<String>,
    /// 报价币种（HKEX=HKD、美股=USD）。
    quote_currency: Option<String>,
    /// 财报记账币种（腾讯 HKD 报价 / CNY 记账）。
    reporting_currency: Option<String>,
    price: Option<Decimal>,
    pe: Option<Decimal>,
    market_cap: Option<Decimal>,
    change_percent: Option<Decimal>,
    eps: Option<Decimal>,
    #[serde(default)]
    eps_annualized: Option<bool>,
    net_margin: Option<Decimal>,
    gross_margin: Option<Decimal>,
    revenue: Option<Decimal>,
    revenue_growth: Option<Decimal>,
    net_income: Option<Decimal>,
    shares_outstanding: Option<Decimal>,
    free_cash_flow: Option<Decimal>,
    net_cash: Option<Decimal>,
    /// 可选：模型草稿答案。给了就跑数字护栏，返回逐条核对结果 + soft 提示。
    draft_answer: Option<String>,
}

#[derive(Serialize)]
struct RouteView {
    intent: &'static str,
    depth: &'static str,
    confidence: f64,
    multi_part: bool,
    answer_style: &'static str,
    plan: Vec<&'static str>,
}

#[derive(Serialize)]
struct GuardView {
    total: usize,
    pass: usize,
    soft: usize,
    hard: usize,
    has_hard_fail: bool,
    soft_note: String,
}

#[derive(Serialize)]
struct AskResponse {
    ticker: String,
    route: RouteView,
    data_completeness: u8,
    connected_sources: Vec<&'static str>,
    valuation: echo_domain::Valuation,
    /// 最终答案正文——客户端给了 `draft_answer` 就回原样，否则由模型网关生成；无 provider/生成失败为 `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<String>,
    /// 答案来源：`draft`（客户端草稿）/ `generated`（网关生成）/ `unavailable`（未核到模型）。
    answer_source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    fact_guard: Option<GuardView>,
}

/// 共享状态：可选的数据库连接池。未配 `DATABASE_URL` 时为 `None`——`/api/ask` 只吃请求体里带的
/// 数字（纯核路径，可离库端到端验证）；配了库则在缺行情时从 `echo-db` 兜底最新快照。
#[derive(Clone)]
struct AppState {
    pool: Option<Pool>,
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "echo-api", "stack": "rust" }))
}

/// DB 补数：请求体没带价格且配了库时，从 `echo-db` 拉本公司身份 + 最新快照，经应用层映射折成
/// 领域事实。仍是**单一公司**——只按本请求的 ticker 取一家，绝不掺别家数字。缺行情就返回 `None`，
/// 保持"未核到"语义，不用陈旧/占位价冒充（记忆：缺数断口）。
async fn db_fill(pool: &Pool, ticker: &str) -> Option<(ResolvedCompany, MarketSnapshot)> {
    let company_row = CompanyRepository::new(pool)
        .by_ticker(ticker)
        .await
        .ok()??;
    let market_row = MarketRepository::new(pool)
        .latest_snapshot(ticker)
        .await
        .ok()??;
    let snapshot = market_snapshot_from_rows(&company_row, &market_row);
    let resolved = resolved_company_from_rows(&company_row, Some(&market_row));
    Some((resolved, snapshot))
}

async fn ask(State(state): State<AppState>, Json(req): Json<AskRequest>) -> Json<AskResponse> {
    // 1) 意图路由（确定性首轮；置信度 < 0.7 时应用层再请模型，那步随网关接入）。
    let route = route_research_intent(&req.question);

    // 2) 组装本公司的单一事实源。请求体优先；缺价格且配了库时用 DB 最新快照兜底。
    let mut company = ResolvedCompany {
        ticker: req.ticker.clone(),
        name_zh: req.name_zh.clone(),
        company: Company {
            price: req.price,
            pe: req.pe,
            ..Default::default()
        },
    };
    let mut market = MarketSnapshot {
        price: req.price,
        pe: req.pe,
        market_cap: req.market_cap,
        currency: req.quote_currency.clone(),
        change_percent: req.change_percent,
        ..Default::default()
    };
    if market.price.is_none() {
        if let Some(pool) = &state.pool {
            if let Some((resolved, snapshot)) = db_fill(pool, &req.ticker).await {
                company = resolved;
                market = snapshot;
            }
        }
    }
    let financials = Financials {
        provider_ok: req.revenue.is_some() || req.eps.is_some(),
        eps: req.eps,
        eps_annualized: req.eps_annualized,
        net_margin: req.net_margin,
        gross_margin: req.gross_margin,
        revenue: req.revenue,
        revenue_growth: req.revenue_growth,
        net_income: req.net_income,
        shares_outstanding: req.shares_outstanding,
        free_cash_flow: req.free_cash_flow,
        net_cash: req.net_cash,
        currency: req.reporting_currency.clone(),
        ..Default::default()
    };

    // 3) 定点估值 + 决策面板。
    let panel = build_panel(&company, &market, &financials, None);

    // 4) 答案：客户端给了草稿就用草稿；否则配了 provider 就用领域事实构造提示词、经网关生成。
    //    生成的答案同样要过下面的数字护栏——生成路径不是护栏的旁路。
    let (answer, answer_source) = match req.draft_answer.clone() {
        Some(draft) => (Some(draft), "draft"),
        None => {
            let system = build_system_prompt();
            let user = build_user_prompt(&AnswerContext {
                question: &req.question,
                name_zh: company.name_zh.as_deref(),
                panel: &panel,
                market: &market,
                financials: &financials,
            });
            // 配了库就把 LLM 调用审计落库（best-effort，绝不阻断作答）；用户身份暂用 "local"，
            // 待 auth 边界迁到 Rust 后接真实租户。
            let audit = state.pool.as_ref().map(|pool| AuditContext {
                pool,
                user_id: "local",
            });
            match model_answer(&system, &user, ModelAnswerOptions::default(), audit).await {
                Some(generated) => (Some(generated.content), "generated"),
                None => (None, "unavailable"),
            }
        }
    };

    // 5) 数字护栏（有答案就跑，草稿或生成一视同仁）：只登记本公司事实，逐条核对。
    let fact_guard = answer.as_deref().map(|draft| {
        let registry = build_facts_registry(&RegistrySources {
            ticker: &req.ticker,
            native_currency: req
                .reporting_currency
                .as_deref()
                .or(req.quote_currency.as_deref()),
            market: Some(&market),
            financials: Some(&financials),
            valuation: Some(&panel.valuation),
            ..Default::default()
        });
        let report = verify_answer_numbers(draft, &registry);
        GuardView {
            total: report.checked.len(),
            pass: report.pass_count(),
            soft: report.soft_count,
            hard: report.hard_count,
            has_hard_fail: report.has_hard_fail(),
            soft_note: build_soft_note(&report),
        }
    });

    Json(AskResponse {
        ticker: panel.ticker,
        route: RouteView {
            intent: route.intent.as_str(),
            depth: route.depth.as_str(),
            confidence: route.confidence,
            multi_part: route.multi_part,
            answer_style: route.answer_style,
            plan: route.plan,
        },
        data_completeness: panel.data_completeness,
        connected_sources: panel.connected_sources,
        valuation: panel.valuation,
        answer,
        answer_source,
        fact_guard,
    })
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/ask", post(ask))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    // 配了 DATABASE_URL 就建池（缺行情时兜底 DB 快照）；没配则纯核路径运行——两条路都真跑，
    // 不静默假装接了库。连不上库属硬失败：宁可启动即报，也不带半接的库悄悄降级。
    let pool = match std::env::var("DATABASE_URL") {
        Ok(url) => {
            let pool = echo_db::connect(&url, 5)
                .await
                .expect("connect DATABASE_URL");
            println!("echo-api: DATABASE_URL 已连，缺行情将兜底 DB 快照");
            Some(pool)
        }
        Err(_) => {
            println!("echo-api: 未配 DATABASE_URL——纯核路径，只吃请求体数字");
            None
        }
    };
    let app = router(AppState { pool });
    let port = std::env::var("PORT").unwrap_or_else(|_| "4180".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind echo-api");
    println!("echo-api listening on {addr} (rust axum)");
    axum::serve(listener, app).await.expect("serve echo-api");
}
