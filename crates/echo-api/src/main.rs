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

use axum::{Json, Router, routing::get, routing::post};
use echo_application::{ResolvedCompany, build_panel};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    fact_guard: Option<GuardView>,
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "echo-api", "stack": "rust" }))
}

async fn ask(Json(req): Json<AskRequest>) -> Json<AskResponse> {
    // 1) 意图路由（确定性首轮；置信度 < 0.7 时应用层再请模型，那步随网关接入）。
    let route = route_research_intent(&req.question);

    // 2) 组装本公司的单一事实源。
    let company = ResolvedCompany {
        ticker: req.ticker.clone(),
        name_zh: req.name_zh.clone(),
        company: Company {
            price: req.price,
            pe: req.pe,
            ..Default::default()
        },
    };
    let market = MarketSnapshot {
        price: req.price,
        pe: req.pe,
        market_cap: req.market_cap,
        currency: req.quote_currency.clone(),
        change_percent: req.change_percent,
        ..Default::default()
    };
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

    // 4) 数字护栏（给了草稿答案才跑）：只登记本公司事实，逐条核对。
    let fact_guard = req.draft_answer.as_deref().map(|draft| {
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
        fact_guard,
    })
}

fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/ask", post(ask))
}

#[tokio::main]
async fn main() {
    let app = router();
    let port = std::env::var("PORT").unwrap_or_else(|_| "4180".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind echo-api");
    println!("echo-api listening on {addr} (rust axum)");
    axum::serve(listener, app).await.expect("serve echo-api");
}
