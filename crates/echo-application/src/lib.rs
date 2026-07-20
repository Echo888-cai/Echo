//! 用例编排——研究链路的骨架（取数 → 估值 → 作答 → 护栏 → 落库）。
//!
//! 迁移自 `packages/application/src/research.ts`。本轮先把**纯编排 + 估值**接通并强类型化，
//! 取数（DB/行情/网页）与模型网关会随 `echo-db`、`echo-api` 逐步接入。
//!
//! 关键修复（对应本次诊断的研究质量根因）：`ResearchRequest` 显式携带**被解析出的单一公司**，
//! 决策面板与作答上下文都以它为唯一事实主体——跨公司的历史/记忆一律只作代词承接，
//! 不得携带别家的财务数字（"问苹果答腾讯"的架构级封堵）。

use echo_domain::{Company, Financials, MarketSnapshot, PeerAnchor, Valuation, display_valuation};
use rust_decimal::Decimal;

pub mod from_db;
pub mod model_gateway;
pub mod research;

pub use from_db::{market_snapshot_from_rows, resolved_company_from_rows};
pub use model_gateway::{
    AnswerKind, ModelAnswer, ModelAnswerOptions, ProviderConfig, model_answer, parse_json_object,
    provider_config,
};

/// 一轮研究请求——公司是必到字段（由公司解析闭环在边界处兑现），history 只用于代词承接。
#[derive(Clone, Debug)]
pub struct ResearchRequest {
    pub question: String,
    pub company: ResolvedCompany,
    pub compare_with: Option<ResolvedCompany>,
}

/// 已解析、已核实的研究主体。
#[derive(Clone, Debug)]
pub struct ResolvedCompany {
    pub ticker: String,
    pub name_zh: Option<String>,
    pub company: Company,
}

/// 决策面板的数据完备度——今天能核到的五个源里站住了几个（不是产品评分）。
#[derive(Clone, Debug)]
pub struct DecisionPanel {
    pub ticker: String,
    pub valuation: Valuation,
    pub connected_sources: Vec<&'static str>,
    pub data_completeness: u8,
}

/// 用已取到的数据算估值并拼出决策面板。**只吃当前公司的财务事实**，无跨公司泄漏面。
#[must_use]
pub fn build_panel(
    company: &ResolvedCompany,
    market: &MarketSnapshot,
    financials: &Financials,
    peer: Option<&PeerAnchor>,
) -> DecisionPanel {
    let valuation = display_valuation(&company.company, market, financials, peer);

    let mut connected = Vec::new();
    if market.price.is_some() {
        connected.push("实时行情");
    }
    if financials.provider_ok {
        connected.push("财报口径");
    }
    if valuation.is_valued() {
        connected.push("估值区间");
    }
    let completeness = ((connected.len() as f64 / 5.0) * 100.0).round() as u8;

    DecisionPanel {
        ticker: company.ticker.clone(),
        valuation,
        connected_sources: connected,
        data_completeness: completeness,
    }
}

/// 仓位盈亏用 Rust 定点内核算（红线 4：展示边界之外不得二进制浮点）。
#[must_use]
pub fn position_return_pct(price: Decimal, avg_cost: Decimal) -> Option<Decimal> {
    use echo_finance_core::{Currency, Money, ratio, subtract};
    let price = Money::new(price, Currency::Usd);
    let cost = Money::new(avg_cost, Currency::Usd);
    let gain = subtract(price, cost).ok()?;
    ratio(gain, cost).ok().flatten()
}
