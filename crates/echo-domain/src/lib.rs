//! Echo Research 领域内核——纯逻辑，不碰时钟、数据库、网络或环境变量。
//!
//! 绞杀式迁移账本（从 `packages/domain/*.js` 迁入 Rust 定点，逐块达到平价后摘掉旧件）：
//!   * [x] `valuation`   ← valuation.js（多方法估值 + 阶段感知 EV/Sales + 可信度护栏）
//!   * [x] `fact_guard`  ← factGuard.js（数字护栏：中文财经抽取 + 数量级/符号/币种/日期核对）
//!   * [x] `intent`      ← intentClassifier.js（意图路由 + 深度 + 阶段计划，中英双语一等公民）
//!   * [x] `derivations` ← research.ts 的 deriveAnnualEps / 比率衍生（TTM 桥接 + EPS 年化护栏）
//!
//! 纯领域核到此收口。迁移期这套逻辑经 `echo-finance-node`（NAPI）暴露给尚存的 TS 应用层，
//! 两栈算同一份数字。

pub mod derivations;
pub mod fact_guard;
pub mod intent;
pub mod valuation;

pub use derivations::{AnnualEps, FilingRow, derive_annual_eps, pct_change, pct_of};
pub use fact_guard::{
    FactsRegistry, Position, RegistrySources, Verdict, VerifyReport, build_facts_registry,
    build_soft_note, merge_facts_registry, render_hard_fail_issues, verify_answer_numbers,
};
pub use intent::{
    ResearchDepth, ResearchIntent, ResearchRoute, classify_research_intent, plan_research_stages,
    route_research_intent,
};
pub use valuation::{
    AssetStage, Company, Financials, HistoricalValuation, HkBuyback, InsiderActivity,
    MarketSnapshot, MethodBand, MultipleType, PeerAnchor, Valuation, classify_asset_stage,
    compute_valuation, display_valuation,
};
