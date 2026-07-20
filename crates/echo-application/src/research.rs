//! 研究链路编排的意图路由（骨架）。
//!
//! 意图分类与阶段计划是**领域规则**，已收口到 `echo-domain::intent`（CLAUDE.md：领域规则只进
//! echo-domain）。这里只做 re-export，避免应用层再维护一份会与领域漂移的副本。LLM 兜底路由
//! （确定性置信度 < 0.7 时请模型做结构化决策）会在 `echo-api` 接入模型网关后补在应用层。

pub use echo_domain::intent::{
    ResearchDepth, ResearchIntent, ResearchRoute, classify_research_intent, plan_research_stages,
    route_research_intent,
};
