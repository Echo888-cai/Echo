//! 研究用例编排——API 只做 HTTP，事实组装 / 估值 / 生成 / 护栏 / 落库收口到这里。
//!
//! 编排顺序固定为：解析主体（当前由请求 ticker 提供）→ 取数 → 衍生/估值 →
//! 提示词 → 生成 → 护栏 → 持久化。端口用假实现即可做无 IO 单测。

use crate::answer_prompt::{AnswerContext, build_system_prompt, build_user_prompt};
use crate::{DecisionPanel, ResolvedCompany, build_panel};
use echo_contracts::{
    AnswerSource, AskRequest, AskResponse, AssetStageView, GuardView, MethodBandView, RouteView,
    ValuationView,
};
use echo_domain::{
    AssetStage, Company, Financials, MarketSnapshot, RegistrySources, ResearchRoute,
    build_facts_registry, build_soft_note, route_research_intent, verify_answer_numbers,
};
use std::future::Future;

pub use echo_domain::intent::{
    ResearchDepth, ResearchIntent, classify_research_intent, plan_research_stages,
    route_research_intent as route_intent,
};

/// 单公司研究事实——比较场景用 [`CompareResearchFacts`] 隔离第二家。
#[derive(Clone, Debug)]
pub struct ResearchFacts {
    pub company: ResolvedCompany,
    pub market: MarketSnapshot,
    pub financials: Financials,
}

/// 比较研究的双腿事实；两侧 registry 不得交叉污染。
#[derive(Clone, Debug)]
pub struct CompareResearchFacts {
    pub primary: ResearchFacts,
    pub peer: ResearchFacts,
}

/// 会话落库所需最小字段（与 `echo-db::SaveResearchSession` 对齐，避免端口泄漏 sqlx 细节）。
#[derive(Clone, Debug, Default)]
pub struct PersistResearchSession {
    pub ticker: String,
    pub company_name: Option<String>,
    pub question: Option<String>,
    pub report_markdown: Option<String>,
    pub decision_panel: Option<serde_json::Value>,
    pub full_research: Option<String>,
    pub data_sources: Option<serde_json::Value>,
    pub turn_count: Option<i32>,
}

/// 研究副作用端口——DB / 行情 / 模型 / 落库都从这里注入。
pub trait ResearchPorts: Send + Sync {
    fn load_company_market(
        &self,
        ticker: &str,
    ) -> impl Future<Output = Option<(ResolvedCompany, MarketSnapshot)>> + Send;

    fn refresh_quote(&self, ticker: &str) -> impl Future<Output = Result<(), String>> + Send;

    fn complete_answer(
        &self,
        system: &str,
        user: &str,
        user_id: &str,
    ) -> impl Future<Output = Option<String>> + Send;

    fn save_session(
        &self,
        user_id: &str,
        session: PersistResearchSession,
    ) -> impl Future<Output = Result<(), String>> + Send;
}

/// 一次非流式研究的结果；可追溯主体、护栏与是否已落库。
#[derive(Clone, Debug)]
pub struct ResearchOutcome {
    pub response: AskResponse,
    pub facts: ResearchFacts,
    pub route: ResearchRoute,
    pub persisted: bool,
}

#[derive(Clone, Debug)]
pub struct ResearchService;

impl ResearchService {
    /// 组装本公司事实：请求体优先；缺价格时经端口读库 / 刷新行情。
    pub async fn assemble_facts<P: ResearchPorts>(ports: &P, req: &AskRequest) -> ResearchFacts {
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
            if let Some((resolved, snapshot)) = ports.load_company_market(&req.ticker).await {
                company = resolved;
                market = snapshot;
            } else if ports.refresh_quote(&req.ticker).await.is_ok() {
                if let Some((resolved, snapshot)) = ports.load_company_market(&req.ticker).await {
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
        ResearchFacts {
            company,
            market,
            financials,
        }
    }

    /// 非流式研究主用例。
    pub async fn ask<P: ResearchPorts>(
        ports: &P,
        user_id: &str,
        req: AskRequest,
    ) -> ResearchOutcome {
        let route = route_research_intent(&req.question);
        let facts = Self::assemble_facts(ports, &req).await;
        let panel = build_panel(&facts.company, &facts.market, &facts.financials, None);

        let (answer, answer_source) = match req.draft_answer.clone() {
            Some(draft) => (Some(draft), AnswerSource::Draft),
            None => {
                let system = build_system_prompt();
                let user_prompt = build_user_prompt(&AnswerContext {
                    question: &req.question,
                    name_zh: facts.company.name_zh.as_deref(),
                    panel: &panel,
                    market: &facts.market,
                    financials: &facts.financials,
                });
                match ports.complete_answer(&system, &user_prompt, user_id).await {
                    Some(generated) => (Some(generated), AnswerSource::Generated),
                    None => (None, AnswerSource::Unavailable),
                }
            }
        };

        let fact_guard = answer.as_deref().map(|draft| {
            let registry = build_facts_registry(&RegistrySources {
                ticker: &req.ticker,
                native_currency: req
                    .reporting_currency
                    .as_deref()
                    .or(req.quote_currency.as_deref()),
                market: Some(&facts.market),
                financials: Some(&facts.financials),
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

        let response = AskResponse {
            ticker: panel.ticker.clone(),
            route: route_view(&route),
            data_completeness: panel.data_completeness,
            connected_sources: panel
                .connected_sources
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            valuation: valuation_view(&panel),
            answer: answer.clone(),
            answer_source,
            fact_guard,
        };

        let mut persisted = false;
        let session = PersistResearchSession {
            ticker: req.ticker.clone(),
            company_name: facts.company.name_zh.clone(),
            question: Some(req.question.clone()),
            report_markdown: response.answer.clone(),
            decision_panel: serde_json::to_value(&response.valuation).ok(),
            full_research: response.answer.clone(),
            data_sources: Some(
                serde_json::json!({ "connected": response.connected_sources.clone() }),
            ),
            turn_count: Some(1),
        };
        if ports.save_session(user_id, session).await.is_ok() {
            persisted = true;
        }

        ResearchOutcome {
            response,
            facts,
            route,
            persisted,
        }
    }
}

fn route_view(route: &ResearchRoute) -> RouteView {
    RouteView {
        intent: route.intent.as_str().to_string(),
        depth: route.depth.as_str().to_string(),
        confidence: route.confidence,
        multi_part: route.multi_part,
        answer_style: route.answer_style.to_string(),
        plan: route.plan.iter().map(|s| (*s).to_string()).collect(),
    }
}

fn valuation_view(panel: &DecisionPanel) -> ValuationView {
    let valuation = &panel.valuation;
    let stage = valuation.stage.map(|stage| match stage {
        AssetStage::Profitable => AssetStageView::Profitable,
        AssetStage::LossGrowth => AssetStageView::LossGrowth,
        AssetStage::Loss => AssetStageView::Loss,
        AssetStage::Unknown => AssetStageView::Unknown,
    });
    ValuationView {
        method: valuation.method.clone(),
        bear: valuation.bear,
        base: valuation.base,
        bull: valuation.bull,
        upside: valuation.upside.clone(),
        downside: valuation.downside.clone(),
        current_price: valuation.current_price,
        methods: valuation.methods.clone(),
        method_detail: valuation
            .method_detail
            .iter()
            .map(|band| MethodBandView {
                name: band.name.clone(),
                bear: band.bear,
                base: band.base,
                bull: band.bull,
            })
            .collect(),
        key_assumptions: valuation.key_assumptions.clone(),
        sensitivity: valuation.sensitivity.clone(),
        stage_aware: valuation.stage_aware,
        stage,
        data_suspect: valuation.data_suspect,
        cannot_value_reason: valuation.cannot_value_reason.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakePorts {
        market: Option<(ResolvedCompany, MarketSnapshot)>,
        refresh_ok: bool,
        answer: Option<String>,
        saved: Mutex<Vec<PersistResearchSession>>,
        fail_save: bool,
    }

    impl ResearchPorts for FakePorts {
        async fn load_company_market(
            &self,
            _ticker: &str,
        ) -> Option<(ResolvedCompany, MarketSnapshot)> {
            self.market.clone()
        }

        async fn refresh_quote(&self, _ticker: &str) -> Result<(), String> {
            if self.refresh_ok {
                Ok(())
            } else {
                Err("unavailable".into())
            }
        }

        async fn complete_answer(
            &self,
            _system: &str,
            _user: &str,
            _user_id: &str,
        ) -> Option<String> {
            self.answer.clone()
        }

        async fn save_session(
            &self,
            _user_id: &str,
            session: PersistResearchSession,
        ) -> Result<(), String> {
            if self.fail_save {
                return Err("db down".into());
            }
            self.saved.lock().expect("lock").push(session);
            Ok(())
        }
    }

    #[tokio::test]
    async fn request_facts_win_over_empty_ports() {
        let ports = FakePorts::default();
        let req = AskRequest {
            question: "估值怎么样".into(),
            ticker: "AAPL".into(),
            price: Some(dec!(190)),
            pe: Some(dec!(28)),
            draft_answer: Some("现价约 190 美元。".into()),
            ..Default::default()
        };
        let outcome = ResearchService::ask(&ports, "user-1", req).await;
        assert_eq!(outcome.facts.market.price, Some(dec!(190)));
        assert_eq!(outcome.response.answer_source, AnswerSource::Draft);
        assert!(outcome.response.fact_guard.is_some());
        assert!(outcome.persisted);
        assert_eq!(outcome.route.intent.as_str(), "valuation");
    }

    #[tokio::test]
    async fn unavailable_model_still_returns_structured_panel() {
        let ports = FakePorts {
            answer: None,
            ..FakePorts::default()
        };
        let req = AskRequest::minimal("护城河？", "0700.HK");
        let outcome = ResearchService::ask(&ports, "user-1", req).await;
        assert_eq!(outcome.response.answer_source, AnswerSource::Unavailable);
        assert!(outcome.response.answer.is_none());
        assert_eq!(outcome.response.ticker, "0700.HK");
    }

    #[tokio::test]
    async fn save_failure_does_not_drop_response() {
        let ports = FakePorts {
            fail_save: true,
            answer: Some("ok".into()),
            ..FakePorts::default()
        };
        let req = AskRequest::minimal("怎么赚钱", "0700.HK");
        let outcome = ResearchService::ask(&ports, "user-1", req).await;
        assert!(!outcome.persisted);
        assert_eq!(outcome.response.answer.as_deref(), Some("ok"));
    }

    #[tokio::test]
    async fn db_fill_used_when_request_has_no_price() {
        let ports = FakePorts {
            market: Some((
                ResolvedCompany {
                    ticker: "NVDA".into(),
                    name_zh: Some("英伟达".into()),
                    company: Company {
                        price: Some(dec!(120)),
                        ..Default::default()
                    },
                },
                MarketSnapshot {
                    price: Some(dec!(120)),
                    currency: Some("USD".into()),
                    ..Default::default()
                },
            )),
            answer: Some("现价约 120。".into()),
            ..FakePorts::default()
        };
        let req = AskRequest::minimal("股价？", "NVDA");
        let outcome = ResearchService::ask(&ports, "u", req).await;
        assert_eq!(outcome.facts.market.price, Some(dec!(120)));
        assert_eq!(outcome.facts.company.name_zh.as_deref(), Some("英伟达"));
        let saved = ports.saved.lock().expect("lock");
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].company_name.as_deref(), Some("英伟达"));
    }
}
