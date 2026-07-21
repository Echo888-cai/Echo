//! Echo Research 的端到端契约单一事实源。
//!
//! axum 边界与 Leptos/WASM 直接依赖这些类型，避免服务端与前端各手抄一套 JSON 结构后静默漂移。
//! 金融数字保留 [`rust_decimal::Decimal`]，JSON 往返不经过二进制浮点。

pub use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub stack: String,
}

impl HealthResponse {
    #[must_use]
    pub fn ok() -> Self {
        Self {
            status: "ok".into(),
            service: "echo-api".into(),
            stack: "rust".into(),
        }
    }
}

/// 研究入口请求。除 `question` / `ticker` 外的字段均为已核实事实；缺失就是缺失，不补零。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AskRequest {
    pub question: String,
    pub ticker: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_zh: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reporting_currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pe: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market_cap: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_percent: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eps: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eps_annualized: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub net_margin: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gross_margin: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revenue: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revenue_growth: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub net_income: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shares_outstanding: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_cash_flow: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub net_cash: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_answer: Option<String>,
}

impl AskRequest {
    #[must_use]
    pub fn minimal(question: impl Into<String>, ticker: impl Into<String>) -> Self {
        Self {
            question: question.into(),
            ticker: ticker.into(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteView {
    pub intent: String,
    pub depth: String,
    pub confidence: f64,
    pub multi_part: bool,
    pub answer_style: String,
    pub plan: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuardView {
    pub total: usize,
    pub pass: usize,
    pub soft: usize,
    pub hard: usize,
    pub has_hard_fail: bool,
    pub soft_note: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssetStageView {
    Profitable,
    LossGrowth,
    Loss,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodBandView {
    pub name: String,
    pub bear: Decimal,
    pub base: Decimal,
    pub bull: Decimal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValuationView {
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bear: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bull: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upside: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downside: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_price: Option<Decimal>,
    pub methods: Vec<String>,
    pub method_detail: Vec<MethodBandView>,
    pub key_assumptions: Vec<String>,
    pub sensitivity: Vec<String>,
    #[serde(default)]
    pub stage_aware: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<AssetStageView>,
    #[serde(default)]
    pub data_suspect: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cannot_value_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnswerSource {
    Draft,
    Generated,
    Unavailable,
}

impl AnswerSource {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Generated => "generated",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AskResponse {
    pub ticker: String,
    pub route: RouteView,
    pub data_completeness: u8,
    pub connected_sources: Vec<String>,
    pub valuation: ValuationView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    pub answer_source: AnswerSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fact_guard: Option<GuardView>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Owner,
    Member,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub role: UserRole,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AuthRegisterRequest {
    pub invite: String,
    pub username: String,
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthInviteRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthUserResponse {
    pub user: PublicUser,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AuthMeResponse {
    pub user: Option<PublicUser>,
    pub multi_user: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AuthLogoutResponse {
    pub logged_out: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthInviteResponse {
    pub code: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponse {
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompanySearchQuery {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CompanySearchItem {
    pub ticker: String,
    pub name_zh: String,
    pub name_en: Option<String>,
    pub sector: Option<String>,
    pub industry: Option<String>,
    pub has_portrait: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompanySearchResponse {
    pub companies: Vec<CompanySearchItem>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WatchEntry {
    pub ticker: String,
    pub company_name: Option<String>,
    pub mode: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WatchListResponse {
    pub entries: Vec<WatchEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WatchMutationRequest {
    pub ticker: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MutationResponse {
    pub changed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PortfolioPosition {
    pub ticker: String,
    pub company_name: String,
    pub shares: Option<Decimal>,
    pub avg_cost: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    pub take_profit: Option<Decimal>,
    pub note: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioListResponse {
    pub positions: Vec<PortfolioPosition>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PortfolioUpsertRequest {
    pub ticker: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_name: Option<String>,
    pub shares: Decimal,
    pub avg_cost: Decimal,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub take_profit: Option<Decimal>,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TickerQuery {
    pub ticker: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UserPreferences {
    pub onboarding_completed: bool,
    pub notify_digest: bool,
    pub notify_positions: bool,
    pub notify_falsify: bool,
    pub notify_review: bool,
    pub notify_earnings: bool,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            onboarding_completed: false,
            notify_digest: true,
            notify_positions: true,
            notify_falsify: true,
            notify_review: true,
            notify_earnings: true,
            quiet_hours_start: None,
            quiet_hours_end: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PreferencesUpdateRequest {
    #[serde(default)]
    pub onboarding_completed: Option<bool>,
    #[serde(default)]
    pub notify_digest: Option<bool>,
    #[serde(default)]
    pub notify_positions: Option<bool>,
    #[serde(default)]
    pub notify_falsify: Option<bool>,
    #[serde(default)]
    pub notify_review: Option<bool>,
    #[serde(default)]
    pub notify_earnings: Option<bool>,
    #[serde(default)]
    pub quiet_hours_start: Option<String>,
    #[serde(default)]
    pub quiet_hours_end: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreferencesResponse {
    pub preferences: UserPreferences,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Notification {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub ticker: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationsListResponse {
    pub notifications: Vec<Notification>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnreadResponse {
    pub unread: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationReadRequest {
    #[serde(default)]
    pub id: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangedCountResponse {
    pub changed: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub ticker: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResearchSessionSummary {
    pub id: String,
    pub ticker: Option<String>,
    pub title: String,
    pub question: String,
    pub conversation_id: String,
    pub status: String,
    pub rating: Option<String>,
    pub confidence: Option<String>,
    pub turn_count: i32,
    pub company_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchSessionsResponse {
    pub sessions: Vec<ResearchSessionSummary>,
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResearchSessionDetail {
    pub id: String,
    pub ticker: Option<String>,
    pub title: String,
    pub question: String,
    pub conversation_id: String,
    pub status: String,
    pub report_markdown: Option<String>,
    pub rating: Option<String>,
    pub confidence: Option<String>,
    pub decision_panel: Option<serde_json::Value>,
    pub full_research: Option<String>,
    pub data_sources: Option<serde_json::Value>,
    pub thread: Option<serde_json::Value>,
    pub turn_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchSessionResponse {
    pub session: Option<ResearchSessionDetail>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    #[test]
    fn minimal_request_omits_unknown_financials() {
        let json =
            serde_json::to_value(AskRequest::minimal("腾讯估值？", "0700.HK")).expect("serialize");
        assert_eq!(json["question"], "腾讯估值？");
        assert_eq!(json["ticker"], "0700.HK");
        assert!(json.get("price").is_none());
    }

    #[test]
    fn decimal_request_round_trips_exactly() {
        let mut request = AskRequest::minimal("AAPL 利润质量", "AAPL");
        request.price = Some(Decimal::from_str("201.123456789").expect("decimal"));
        let encoded = serde_json::to_string(&request).expect("serialize");
        let decoded: AskRequest = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(decoded, request);
    }

    #[test]
    fn unknown_request_field_is_rejected() {
        let error =
            serde_json::from_str::<AskRequest>(r#"{"question":"q","ticker":"AAPL","made_up":1}"#)
                .expect_err("unknown field must fail");
        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn answer_source_wire_values_are_stable() {
        assert_eq!(
            serde_json::to_string(&AnswerSource::Unavailable).expect("serialize"),
            r#""unavailable""#
        );
    }
}
