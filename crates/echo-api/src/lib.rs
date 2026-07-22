//! Echo Research HTTP 边界（axum）。
//!
//!   * `GET  /health` / `/healthz`  —— 存活探针
//!   * `POST /api/ask` —— 研究入口：吃 { question, ticker, 行情/财报字段, 可选 draft_answer }，
//!                        经 `echo-domain` 跑**整条纯核**——意图路由 → 定点估值 → 决策面板 →
//!                        （给了草稿答案时）数字护栏——返回结构化结果。
//!
//! 取数（DB/行情/网页）由 `echo-db` 注入、模型网关与 SSE 流式作答随后接上；此处刻意让
//! 意图路由 + 估值 + 数字护栏这条**正确性关键路径先整体跑在 Rust 定点上**，因为它正是
//! 研究质量的病灶所在。单公司硬取值：面板与护栏只吃本请求这一家公司的财务事实，
//! 跨公司污染（"问苹果答腾讯"）在类型层面就发生不了。

use axum::extract::{DefaultBodyLimit, Extension, Path, Query, Request, State};
use axum::http::header::{COOKIE, ORIGIN, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::{
    Json, Router,
    routing::{get, post},
};
use echo_application::model_gateway::{
    AuditContext, ModelAnswerOptions, ModelStreamStart, OwnedAuditContext, ProviderConfig,
    model_answer, model_answer_stream,
};
use echo_application::{
    AuthError, AuthService, CompanyResolvePorts, CompanyResolveService, DbCompanyHit,
    ExternalSymbolHit, LoadedFundamentals, PersistResearchSession, PriorTurn, ResearchPorts,
    ResearchService, ResolvedCompany, market_snapshot_from_rows, resolved_company_from_rows,
};
use echo_config::ApiConfig;
use echo_contracts::{
    AskRequest, AskResponse, AuthInviteRequest, AuthInviteResponse, AuthLoginRequest,
    AuthLogoutResponse, AuthMeResponse, AuthRegisterRequest, AuthUserResponse,
    ChangedCountResponse, CompanyProfileDetail, CompanyProfileResponse, CompanyProfileSummary,
    CompanyProfileUpsertRequest, CompanyProfilesListResponse, CompanyResolveItem,
    CompanyResolveQuery, CompanyResolveResponse, CompanySearchItem, CompanySearchQuery,
    CompanySearchResponse, CompanyVerifyQuery, CompanyVerifyResponse, CompanyVerifySuggestion,
    CompareRequest, CompareResponse, ErrorResponse, HealthResponse, ListQuery, MutationResponse,
    Notification, NotificationReadRequest, NotificationsListResponse, PortfolioListResponse,
    PortfolioPosition, PortfolioUpsertRequest, PreferencesResponse, PreferencesUpdateRequest,
    PublicUser, ResearchSessionDetail, ResearchSessionResponse, ResearchSessionSummary,
    ResearchSessionsResponse, ResearchStreamEvent, TickerQuery, UnreadResponse, UserPreferences,
    UserRole, WatchEntry, WatchListResponse, WatchMutationRequest,
};
use echo_data::{
    CalendarService, FilingsService, FmpSearchService, FundamentalsRow, FundamentalsService,
    HistoricalValuationService, PeerService, QuoteService, pct_change, pct_of,
};
use echo_db::{
    CompanyProfileRepository, CompanyProfileUpsert, CompanyRepository, MarketRepository,
    NotificationsRepository, Pool, PortfolioRepository, PortfolioUpsert, PreferencesPatch,
    PreferencesRepository, RateLimitRepository, ResearchSessionRepository, SaveResearchSession,
    UserPreferencesRow, WatchlistRepository,
};
use echo_domain::{
    EarningsCalendar, Filing, Financials, HistoricalValuation, MarketSnapshot, MultipleType,
    PeerAnchor,
};
use futures_util::Stream;
use std::convert::Infallible;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};

const COOKIE_NAME: &str = "echo_session";
const SESSION_MAX_AGE_SECONDS: i64 = 30 * 86_400;
/// 请求体上限：研究请求体是结构化数字 + 一段问题/草稿文本，512KiB 留足余量，拦掉异常大包。
const MAX_JSON_BODY_BYTES: usize = 512 * 1024;
const ASK_RATE_LIMIT_WINDOW_SECONDS: i64 = 60;

/// 共享状态：可选的数据库连接池。未配 `DATABASE_URL` 时为 `None`——`/api/ask` 只吃请求体里带的
/// 数字（纯核路径，可离库端到端验证）；配了库则在缺行情时从 `echo-db` 兜底最新快照。
/// FMP fundamentals/search 不依赖数据库，有配置即可注入研究端口。
#[derive(Clone)]
pub struct AppState {
    pool: Option<Pool>,
    quotes: Option<QuoteService>,
    fundamentals: Option<FundamentalsService>,
    calendar: Option<CalendarService>,
    historical_valuation: Option<HistoricalValuationService>,
    peers: Option<PeerService>,
    filings: Option<FilingsService>,
    fmp_search: Option<FmpSearchService>,
    auth_disabled: bool,
    auth_disabled_user_id: String,
    secure_cookie: bool,
    model_provider: Option<ProviderConfig>,
    allowed_origins: Vec<String>,
    ask_rate_limit_per_minute: u32,
}

impl AppState {
    #[must_use]
    pub fn without_database() -> Self {
        Self {
            pool: None,
            quotes: None,
            fundamentals: None,
            calendar: None,
            historical_valuation: None,
            peers: None,
            filings: None,
            fmp_search: None,
            auth_disabled: true,
            auth_disabled_user_id: "local".into(),
            secure_cookie: false,
            model_provider: None,
            allowed_origins: vec!["http://localhost:5190".into()],
            ask_rate_limit_per_minute: 20,
        }
    }
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn database_required() -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "此功能需要 PostgreSQL")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorResponse {
                message: self.message,
            }),
        )
            .into_response()
    }
}

fn map_auth_error(error: AuthError) -> ApiError {
    let status = match error {
        AuthError::InvalidCredentials => StatusCode::UNAUTHORIZED,
        AuthError::PasswordTooShort
        | AuthError::InvalidAccount
        | AuthError::UsernameTaken
        | AuthError::InvalidInvite
        | AuthError::OwnerExists => StatusCode::BAD_REQUEST,
        AuthError::Database(_) | AuthError::PasswordTask => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status == StatusCode::INTERNAL_SERVER_ERROR {
        error!(error = %error, "认证操作失败");
        ApiError::new(status, "认证服务暂时不可用")
    } else {
        ApiError::new(status, error.to_string())
    }
}

fn map_db_error(error: echo_db::DbError) -> ApiError {
    error!(error = %error, "数据库操作失败");
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "数据库操作失败")
}

fn require_pool(state: &AppState) -> Result<&Pool, ApiError> {
    state.pool.as_ref().ok_or_else(ApiError::database_required)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse::ok())
}

/// 就绪探针：配了 `DATABASE_URL` 就必须能连上（`SELECT 1`），否则 503——流量不该被路由到
/// 一个数据库掉线的副本。未配库属有意的纯核部署，视为就绪（与 `AppState::without_database`
/// 的设计一致，不是降级）。
async fn ready(State(state): State<AppState>) -> Response {
    let Some(pool) = state.pool.as_ref() else {
        return Json(HealthResponse::ok()).into_response();
    };
    match echo_db::ping(pool).await {
        Ok(()) => Json(HealthResponse::ok()).into_response(),
        Err(error) => {
            error!(error = %error, "readiness 探针失败：数据库不可达");
            ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "数据库不可达").into_response()
        }
    }
}

/// Origin 校验（CSRF 防护）：状态变更请求带 `Origin` 头时必须在白名单内；非浏览器客户端
/// 通常不带该头，放行——拦的是"浏览器从别的站点悄悄提交这个会话的 Cookie"这类跨站请求。
async fn enforce_origin(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) {
        if let Some(origin) = request
            .headers()
            .get(ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            if !state
                .allowed_origins
                .iter()
                .any(|allowed| allowed == origin)
            {
                warn!(origin, "Origin 校验拒绝跨站请求");
                return ApiError::new(StatusCode::FORBIDDEN, "非法请求来源").into_response();
            }
        }
    }
    next.run(request).await
}

/// 研究端点限流：按用户 + 60 秒滑动窗口共享 `rate_limit_buckets`，挡掉对昂贵模型调用的
/// 高频重放。仅在配库时生效；限流查询自身出错按放行处理（限流故障不该拖垮研究主链）。
async fn rate_limit_ask(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    request: Request,
    next: Next,
) -> Response {
    if let Some(pool) = state.pool.as_ref() {
        let key = format!("ask:{}", user.id);
        match RateLimitRepository::new(pool)
            .try_consume(
                &key,
                state.ask_rate_limit_per_minute as i32,
                ASK_RATE_LIMIT_WINDOW_SECONDS,
            )
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                return ApiError::new(
                    StatusCode::TOO_MANY_REQUESTS,
                    "研究请求过于频繁，请稍后再试",
                )
                .into_response();
            }
            Err(error) => {
                error!(error = %error, "限流检查失败，本次放行");
            }
        }
    }
    next.run(request).await
}

fn request_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|part| {
                let (name, value) = part.trim().split_once('=')?;
                (name == COOKIE_NAME).then_some(value)
            })
        })
}

fn session_cookie(token: &str, clear: bool, secure: bool) -> Result<HeaderValue, ApiError> {
    let secure = if secure { "; Secure" } else { "" };
    let value = if clear {
        format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")
    } else {
        format!(
            "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_MAX_AGE_SECONDS}{secure}"
        )
    };
    HeaderValue::from_str(&value)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "会话 Cookie 生成失败"))
}

fn local_public_user(id: &str) -> PublicUser {
    PublicUser {
        id: id.to_string(),
        username: "local".into(),
        display_name: Some("本机用户".into()),
        role: UserRole::Owner,
    }
}

async fn resolve_request_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<PublicUser>, ApiError> {
    let Some(pool) = &state.pool else {
        return Ok(Some(local_public_user(&state.auth_disabled_user_id)));
    };
    let auth = AuthService::new(pool);
    if state.auth_disabled {
        return auth
            .local_owner(&state.auth_disabled_user_id)
            .await
            .map(Some)
            .map_err(map_auth_error);
    }
    auth.session_user(request_token(headers))
        .await
        .map_err(map_auth_error)
}

async fn require_auth(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    match resolve_request_user(&state, request.headers()).await {
        Ok(Some(user)) => {
            request.extensions_mut().insert(user);
            next.run(request).await
        }
        Ok(None) => ApiError::new(StatusCode::UNAUTHORIZED, "请先登录").into_response(),
        Err(error) => error.into_response(),
    }
}

async fn auth_login(
    State(state): State<AppState>,
    Json(input): Json<AuthLoginRequest>,
) -> Result<Response, ApiError> {
    let pool = state
        .pool
        .as_ref()
        .ok_or_else(ApiError::database_required)?;
    let session = AuthService::new(pool)
        .login(&input.username, &input.password)
        .await
        .map_err(map_auth_error)?;
    let mut response = Json(AuthUserResponse { user: session.user }).into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        session_cookie(&session.token, false, state.secure_cookie)?,
    );
    Ok(response)
}

async fn auth_register(
    State(state): State<AppState>,
    Json(input): Json<AuthRegisterRequest>,
) -> Result<Response, ApiError> {
    let pool = state
        .pool
        .as_ref()
        .ok_or_else(ApiError::database_required)?;
    let session = AuthService::new(pool)
        .register(
            &input.invite,
            &input.username,
            &input.password,
            input.display_name,
        )
        .await
        .map_err(map_auth_error)?;
    let mut response = Json(AuthUserResponse { user: session.user }).into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        session_cookie(&session.token, false, state.secure_cookie)?,
    );
    Ok(response)
}

async fn auth_logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if let Some(pool) = &state.pool {
        AuthService::new(pool)
            .destroy_session(request_token(&headers))
            .await
            .map_err(map_auth_error)?;
    }
    let mut response = Json(AuthLogoutResponse { logged_out: true }).into_response();
    response
        .headers_mut()
        .insert(SET_COOKIE, session_cookie("", true, state.secure_cookie)?);
    Ok(response)
}

async fn auth_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuthMeResponse>, ApiError> {
    let user = resolve_request_user(&state, &headers).await?;
    let multi_user = state.pool.is_some() && !state.auth_disabled;
    Ok(Json(AuthMeResponse { user, multi_user }))
}

async fn auth_invite(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Json(input): Json<AuthInviteRequest>,
) -> Result<Json<AuthInviteResponse>, ApiError> {
    if user.role != UserRole::Owner {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "只有 owner 能生成邀请码",
        ));
    }
    let pool = state
        .pool
        .as_ref()
        .ok_or_else(ApiError::database_required)?;
    let code = AuthService::new(pool)
        .create_invite(&user, input.note.as_deref())
        .await
        .map_err(map_auth_error)?;
    Ok(Json(AuthInviteResponse { code }))
}

async fn companies_search(
    State(state): State<AppState>,
    Query(query): Query<CompanySearchQuery>,
) -> Result<Json<CompanySearchResponse>, ApiError> {
    let rows = CompanyRepository::new(require_pool(&state)?)
        .search(&query.q, query.limit.unwrap_or(20))
        .await
        .map_err(map_db_error)?;
    Ok(Json(CompanySearchResponse {
        companies: rows
            .into_iter()
            .map(|row| CompanySearchItem {
                ticker: row.ticker,
                name_zh: row.name_zh,
                name_en: row.name_en,
                sector: row.sector,
                industry: row.industry,
                has_portrait: row.has_portrait,
            })
            .collect(),
    }))
}

struct ApiCompanyResolvePorts {
    state: AppState,
}

impl CompanyResolvePorts for ApiCompanyResolvePorts {
    async fn db_by_ticker(&self, ticker: &str) -> Option<DbCompanyHit> {
        let pool = self.state.pool.as_ref()?;
        let row = CompanyRepository::new(pool)
            .by_ticker(ticker)
            .await
            .ok()??;
        Some(DbCompanyHit {
            ticker: row.ticker,
            name_zh: row.name_zh,
            name_en: row.name_en,
            industry: row.industry,
        })
    }

    async fn db_search(&self, query: &str, limit: i64) -> Vec<DbCompanyHit> {
        let Some(pool) = self.state.pool.as_ref() else {
            return Vec::new();
        };
        CompanyRepository::new(pool)
            .search(query, limit)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|row| DbCompanyHit {
                ticker: row.ticker,
                name_zh: row.name_zh,
                name_en: row.name_en,
                industry: row.industry,
            })
            .collect()
    }

    async fn fmp_exact_us(&self, ticker: &str) -> Option<ExternalSymbolHit> {
        let search = self.state.fmp_search.as_ref()?;
        let hit = search.exact_us_hit(ticker).await?;
        Some(ExternalSymbolHit {
            symbol: hit.symbol,
            name: hit.name,
            exchange: hit.exchange,
        })
    }

    async fn fmp_search_name(&self, name: &str) -> Vec<ExternalSymbolHit> {
        let Some(search) = self.state.fmp_search.as_ref() else {
            return Vec::new();
        };
        search
            .search_name(name)
            .await
            .into_iter()
            .map(|hit| ExternalSymbolHit {
                symbol: hit.symbol,
                name: hit.name,
                exchange: hit.exchange,
            })
            .collect()
    }

    async fn quote_alive(&self, ticker: &str) -> bool {
        let Some(quotes) = self.state.quotes.as_ref() else {
            return false;
        };
        matches!(quotes.fetch_live(ticker).await, Ok(routed) if routed.quote.price.is_some())
    }
}

async fn companies_resolve(
    State(state): State<AppState>,
    Query(query): Query<CompanyResolveQuery>,
) -> Json<CompanyResolveResponse> {
    let ports = ApiCompanyResolvePorts { state };
    let result = CompanyResolveService::resolve_query(&ports, &query.q).await;
    Json(CompanyResolveResponse {
        company: result.company.map(|company| CompanyResolveItem {
            ticker: company.ticker,
            name_zh: company.name_zh,
            name_en: (!company.name_en.is_empty()).then_some(company.name_en),
            industry: (!company.industry.is_empty()).then_some(company.industry),
        }),
        reason: result.reason,
    })
}

async fn companies_verify(
    State(state): State<AppState>,
    Query(query): Query<CompanyVerifyQuery>,
) -> Json<CompanyVerifyResponse> {
    let ports = ApiCompanyResolvePorts { state };
    let result = CompanyResolveService::verify_ticker(&ports, &query.ticker).await;
    let status = match result.status {
        echo_application::VerifyStatus::Verified => "verified",
        echo_application::VerifyStatus::NotFound => "not_found",
    };
    Json(CompanyVerifyResponse {
        status: status.into(),
        name: result.name.filter(|value| !value.is_empty()),
        suggestions: (!result.suggestions.is_empty()).then(|| {
            result
                .suggestions
                .into_iter()
                .map(|item| CompanyVerifySuggestion {
                    ticker: item.ticker,
                    name: item.name,
                })
                .collect()
        }),
    })
}

/// 研究入口：验证主体（必要时从问题解析）并在有库时 ensure 建档。
async fn prepare_research_request(state: &AppState, mut req: AskRequest) -> AskRequest {
    let ports = ApiCompanyResolvePorts {
        state: state.clone(),
    };
    let ticker = {
        let trimmed = req.ticker.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    };
    let Some(listing) = CompanyResolveService::resolve_research_company(
        &ports,
        ticker,
        req.name_zh.as_deref(),
        &req.question,
    )
    .await
    else {
        return req;
    };
    if let Some(pool) = &state.pool {
        if let Err(error) = CompanyRepository::new(pool)
            .ensure(
                &listing.ticker,
                Some(listing.name_zh.as_str()),
                (!listing.name_en.is_empty()).then_some(listing.name_en.as_str()),
                None,
                (!listing.industry.is_empty()).then_some(listing.industry.as_str()),
            )
            .await
        {
            warn!(
                ticker = %listing.ticker,
                error = %error,
                "验证通过后建档失败，本轮仍继续研究"
            );
        }
    }
    req.ticker = listing.ticker;
    if req.name_zh.is_none() {
        req.name_zh = Some(listing.name_zh);
    }
    req
}

async fn watch_list(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
) -> Result<Json<WatchListResponse>, ApiError> {
    let rows = WatchlistRepository::new(require_pool(&state)?)
        .list(&user.id)
        .await
        .map_err(map_db_error)?;
    Ok(Json(WatchListResponse {
        entries: rows
            .into_iter()
            .map(|row| WatchEntry {
                ticker: row.ticker,
                company_name: row.company_name,
                mode: row.mode,
                created_at: row.created_at.to_rfc3339(),
            })
            .collect(),
    }))
}

async fn watch_track(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Json(input): Json<WatchMutationRequest>,
) -> Result<Json<MutationResponse>, ApiError> {
    let changed = WatchlistRepository::new(require_pool(&state)?)
        .set(
            &user.id,
            &input.ticker,
            input.company_name.as_deref(),
            "add",
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(MutationResponse { changed }))
}

async fn watch_untrack(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Json(input): Json<WatchMutationRequest>,
) -> Result<Json<MutationResponse>, ApiError> {
    let changed = WatchlistRepository::new(require_pool(&state)?)
        .set(&user.id, &input.ticker, None, "hide")
        .await
        .map_err(map_db_error)?;
    Ok(Json(MutationResponse { changed }))
}

fn portfolio_position(row: echo_db::PortfolioPositionRow) -> PortfolioPosition {
    PortfolioPosition {
        company_name: row.company_name.unwrap_or_else(|| row.ticker.clone()),
        ticker: row.ticker,
        shares: row.shares,
        avg_cost: row.avg_cost,
        stop_loss: row.stop_loss,
        take_profit: row.take_profit,
        note: row.note.unwrap_or_default(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

async fn portfolio_list(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
) -> Result<Json<PortfolioListResponse>, ApiError> {
    let positions = PortfolioRepository::new(require_pool(&state)?)
        .list(&user.id)
        .await
        .map_err(map_db_error)?
        .into_iter()
        .map(portfolio_position)
        .collect();
    Ok(Json(PortfolioListResponse { positions }))
}

async fn portfolio_upsert(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Json(input): Json<PortfolioUpsertRequest>,
) -> Result<Json<PortfolioPosition>, ApiError> {
    if input.shares <= echo_contracts::Decimal::ZERO
        || input.avg_cost < echo_contracts::Decimal::ZERO
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "持有股数必须大于 0，平均成本不得为负",
        ));
    }
    let row = PortfolioRepository::new(require_pool(&state)?)
        .upsert(
            &user.id,
            &input.ticker,
            &PortfolioUpsert {
                company_name: input.company_name,
                shares: Some(input.shares),
                avg_cost: Some(input.avg_cost),
                stop_loss: input.stop_loss,
                take_profit: input.take_profit,
                note: Some(input.note),
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(portfolio_position(row)))
}

async fn portfolio_delete(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Query(query): Query<TickerQuery>,
) -> Result<Json<MutationResponse>, ApiError> {
    let changed = PortfolioRepository::new(require_pool(&state)?)
        .delete(&user.id, &query.ticker)
        .await
        .map_err(map_db_error)?;
    Ok(Json(MutationResponse { changed }))
}

fn company_profile_summary(row: echo_db::CompanyProfileSummaryRow) -> CompanyProfileSummary {
    CompanyProfileSummary {
        ticker: row.ticker,
        company_name: row.company_name,
        research_status: row.research_status,
        confidence: row.confidence,
        turn_count: row.turn_count,
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn company_profile_detail(row: echo_db::CompanyProfileRow) -> CompanyProfileDetail {
    CompanyProfileDetail {
        ticker: row.ticker,
        company_name: row.company_name,
        thesis: row.thesis,
        research_status: row.research_status,
        confidence: row.confidence,
        bull: row.bull.unwrap_or_default(),
        bear: row.bear.unwrap_or_default(),
        monitors: row.monitors.unwrap_or_default(),
        falsifiers: row.falsifiers.unwrap_or_default(),
        valuation_method: row.valuation_method,
        valuation_bear: row.valuation_bear,
        valuation_base: row.valuation_base,
        valuation_bull: row.valuation_bull,
        valuation_current_price: row.valuation_current_price,
        profile_md: row.profile_md,
        turn_count: row.turn_count,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

async fn profiles_list(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Query(query): Query<ListQuery>,
) -> Result<Json<CompanyProfilesListResponse>, ApiError> {
    let profiles = CompanyProfileRepository::new(require_pool(&state)?)
        .list(&user.id, query.limit.unwrap_or(50))
        .await
        .map_err(map_db_error)?
        .into_iter()
        .map(company_profile_summary)
        .collect();
    Ok(Json(CompanyProfilesListResponse { profiles }))
}

async fn profile_get(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Path(ticker): Path<String>,
) -> Result<Json<CompanyProfileResponse>, ApiError> {
    let profile = CompanyProfileRepository::new(require_pool(&state)?)
        .get(&user.id, &ticker)
        .await
        .map_err(map_db_error)?
        .map(company_profile_detail);
    Ok(Json(CompanyProfileResponse { profile }))
}

async fn profile_upsert(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Path(ticker): Path<String>,
    Json(input): Json<CompanyProfileUpsertRequest>,
) -> Result<Json<CompanyProfileDetail>, ApiError> {
    let row = CompanyProfileRepository::new(require_pool(&state)?)
        .upsert(
            &user.id,
            &ticker,
            &CompanyProfileUpsert {
                company_name: input.company_name,
                thesis: input.thesis,
                research_status: input.research_status,
                confidence: input.confidence,
                bull: input.bull,
                bear: input.bear,
                monitors: input.monitors,
                falsifiers: input.falsifiers,
                valuation_method: input.valuation_method,
                valuation_bear: input.valuation_bear,
                valuation_base: input.valuation_base,
                valuation_bull: input.valuation_bull,
                valuation_current_price: input.valuation_current_price,
                profile_md: input.profile_md,
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(company_profile_detail(row)))
}

async fn profile_delete(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Path(ticker): Path<String>,
) -> Result<Json<MutationResponse>, ApiError> {
    let changed = CompanyProfileRepository::new(require_pool(&state)?)
        .delete(&user.id, &ticker)
        .await
        .map_err(map_db_error)?;
    Ok(Json(MutationResponse { changed }))
}

fn preferences(row: UserPreferencesRow) -> UserPreferences {
    UserPreferences {
        onboarding_completed: row.onboarding_completed,
        notify_digest: row.notify_digest,
        notify_positions: row.notify_positions,
        notify_falsify: row.notify_falsify,
        notify_review: row.notify_review,
        notify_earnings: row.notify_earnings,
        quiet_hours_start: row.quiet_hours_start,
        quiet_hours_end: row.quiet_hours_end,
    }
}

async fn preferences_get(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    let row = PreferencesRepository::new(require_pool(&state)?)
        .get(&user.id)
        .await
        .map_err(map_db_error)?;
    Ok(Json(PreferencesResponse {
        preferences: preferences(row),
    }))
}

fn valid_hhmm(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 5
        && bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2] == b':'
        && bytes[3].is_ascii_digit()
        && bytes[4].is_ascii_digit()
        && (bytes[0] - b'0') * 10 + (bytes[1] - b'0') < 24
        && (bytes[3] - b'0') * 10 + (bytes[4] - b'0') < 60
}

async fn preferences_update(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Json(input): Json<PreferencesUpdateRequest>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    for value in [
        input.quiet_hours_start.as_deref(),
        input.quiet_hours_end.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !value.is_empty() && !valid_hhmm(value) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "免打扰时间必须是 HH:MM",
            ));
        }
    }
    let row = PreferencesRepository::new(require_pool(&state)?)
        .update(
            &user.id,
            &PreferencesPatch {
                onboarding_completed: input.onboarding_completed,
                notify_digest: input.notify_digest,
                notify_positions: input.notify_positions,
                notify_falsify: input.notify_falsify,
                notify_review: input.notify_review,
                notify_earnings: input.notify_earnings,
                quiet_hours_start: input.quiet_hours_start,
                quiet_hours_end: input.quiet_hours_end,
            },
        )
        .await
        .map_err(map_db_error)?;
    Ok(Json(PreferencesResponse {
        preferences: preferences(row),
    }))
}

async fn notifications_list(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Query(query): Query<ListQuery>,
) -> Result<Json<NotificationsListResponse>, ApiError> {
    let notifications = NotificationsRepository::new(require_pool(&state)?)
        .list(&user.id, query.limit.unwrap_or(20))
        .await
        .map_err(map_db_error)?
        .into_iter()
        .map(|row| Notification {
            id: row.id,
            kind: row.kind,
            title: row.title,
            body: row.body.unwrap_or_default(),
            ticker: row.ticker,
            payload: row.payload,
            created_at: row.created_at.to_rfc3339(),
            read_at: row.read_at.map(|date| date.to_rfc3339()),
        })
        .collect();
    Ok(Json(NotificationsListResponse { notifications }))
}

async fn notifications_unread(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
) -> Result<Json<UnreadResponse>, ApiError> {
    let unread = NotificationsRepository::new(require_pool(&state)?)
        .unread_count(&user.id)
        .await
        .map_err(map_db_error)?;
    Ok(Json(UnreadResponse { unread }))
}

async fn notifications_read(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Json(input): Json<NotificationReadRequest>,
) -> Result<Json<ChangedCountResponse>, ApiError> {
    let changed = NotificationsRepository::new(require_pool(&state)?)
        .mark_read(&user.id, input.id)
        .await
        .map_err(map_db_error)?;
    Ok(Json(ChangedCountResponse { changed }))
}

fn research_summary(row: echo_db::ResearchSessionSummaryRow) -> ResearchSessionSummary {
    ResearchSessionSummary {
        conversation_id: row.conversation_id.unwrap_or_else(|| row.id.clone()),
        title: row
            .title
            .or_else(|| row.question.clone())
            .unwrap_or_default(),
        question: row.question.unwrap_or_default(),
        id: row.id,
        ticker: row.ticker,
        status: row.status,
        rating: row.rating,
        confidence: row.confidence,
        turn_count: row.turn_count.unwrap_or(0),
        company_name: row.company_name,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn research_detail(row: echo_db::ResearchSessionRow) -> ResearchSessionDetail {
    ResearchSessionDetail {
        conversation_id: row.conversation_id.unwrap_or_else(|| row.id.clone()),
        title: row
            .title
            .or_else(|| row.question.clone())
            .unwrap_or_default(),
        question: row.question.unwrap_or_default(),
        id: row.id,
        ticker: row.ticker,
        status: row.status,
        report_markdown: row.report_markdown,
        rating: row.rating,
        confidence: row.confidence,
        decision_panel: row.decision_panel,
        full_research: row.full_research,
        data_sources: row.data_sources,
        thread: row.thread_json,
        turn_count: row.turn_count.unwrap_or(0),
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

async fn research_sessions_list(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ResearchSessionsResponse>, ApiError> {
    let sessions: Vec<_> = ResearchSessionRepository::new(require_pool(&state)?)
        .list(&user.id, query.ticker.as_deref(), query.limit.unwrap_or(20))
        .await
        .map_err(map_db_error)?
        .into_iter()
        .map(research_summary)
        .collect();
    let count = sessions.len();
    Ok(Json(ResearchSessionsResponse { sessions, count }))
}

async fn research_session_get(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Path(id): Path<String>,
) -> Result<Json<ResearchSessionResponse>, ApiError> {
    let session = ResearchSessionRepository::new(require_pool(&state)?)
        .get(&user.id, &id)
        .await
        .map_err(map_db_error)?
        .map(research_detail);
    Ok(Json(ResearchSessionResponse { session }))
}

async fn research_session_delete(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
    Path(id): Path<String>,
) -> Result<Json<MutationResponse>, ApiError> {
    let changed = ResearchSessionRepository::new(require_pool(&state)?)
        .delete(&user.id, &id)
        .await
        .map_err(map_db_error)?;
    Ok(Json(MutationResponse { changed }))
}

async fn research_sessions_clear(
    State(state): State<AppState>,
    Extension(user): Extension<PublicUser>,
) -> Result<Json<ChangedCountResponse>, ApiError> {
    let changed = ResearchSessionRepository::new(require_pool(&state)?)
        .clear(&user.id)
        .await
        .map_err(map_db_error)?;
    Ok(Json(ChangedCountResponse { changed }))
}

/// HTTP 边界上的研究端口适配：DB 补数、行情刷新、FMP 财务、模型生成、会话落库。
/// 持有 `AppState` 所有权，以便流式用例在 SSE 生命周期内驱动。
struct ApiResearchPorts {
    state: AppState,
}

fn financials_from_fmp_row(row: &FundamentalsRow) -> Financials {
    Financials {
        provider_ok: true,
        currency: row.currency.clone(),
        revenue: row.revenue,
        gross_profit: row.gross_profit,
        operating_income: row.operating_income,
        net_income: row.net_income,
        operating_cash_flow: row.operating_cash_flow,
        cash_and_equivalents: row.cash_and_equivalents,
        net_cash: row.net_cash,
        // 单季 EPS：标为未年化，禁止 price/eps 反推 PE；估值用 pe_ttm。
        eps: row.eps,
        eps_annualized: Some(false),
        pe: row.pe_ttm,
        revenue_growth: pct_change(row.revenue, row.revenue_prior),
        gross_margin: pct_of(row.gross_profit, row.revenue),
        operating_margin: pct_of(row.operating_income, row.revenue),
        net_margin: pct_of(row.net_income, row.revenue),
        profit_growth: pct_change(row.net_income, row.net_income_prior),
        period: row.period_label.clone().or_else(|| row.period_end.clone()),
        ..Default::default()
    }
}

impl ResearchPorts for ApiResearchPorts {
    async fn load_company_market(&self, ticker: &str) -> Option<(ResolvedCompany, MarketSnapshot)> {
        let pool = self.state.pool.as_ref()?;
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

    async fn refresh_quote(&self, ticker: &str) -> Result<(), String> {
        let quotes = self
            .state
            .quotes
            .as_ref()
            .ok_or_else(|| "quote service unavailable".to_string())?;
        match quotes.refresh(ticker).await {
            Ok(_) => Ok(()),
            Err(error) => {
                warn!(ticker, error = %error, "实时行情未核到");
                Err(error.to_string())
            }
        }
    }

    async fn load_fundamentals(&self, ticker: &str) -> Option<LoadedFundamentals> {
        let service = self.state.fundamentals.as_ref()?;
        let result = service.fetch(ticker).await;
        if !result.provider_ok {
            return None;
        }
        let row = result.latest()?;
        let company_name = match self.state.fmp_search.as_ref() {
            Some(search) => search
                .exact_us_hit(ticker)
                .await
                .map(|hit| hit.name)
                .filter(|name| !name.is_empty()),
            None => None,
        };
        Some(LoadedFundamentals {
            pe_ttm: row.pe_ttm,
            company_name,
            financials: financials_from_fmp_row(row),
        })
    }

    async fn load_earnings_calendar(&self, ticker: &str) -> Option<EarningsCalendar> {
        let service = self.state.calendar.as_ref()?;
        let row = service.load(ticker).await?;
        row.next_date.is_some().then_some(EarningsCalendar {
            provider_ok: true,
            next_date: row.next_date,
            quarter: row.quarter,
            year: row.year,
            eps_estimate: row.eps_estimate,
            revenue_estimate: row.revenue_estimate,
        })
    }

    async fn load_historical_valuation(&self, ticker: &str) -> Option<HistoricalValuation> {
        let service = self.state.historical_valuation.as_ref()?;
        let summary = service.load(ticker).await?;
        Some(HistoricalValuation {
            percentile: summary.percentile,
            min: summary.min,
            max: summary.max,
            median: summary.median,
        })
    }

    async fn load_peer_anchor(
        &self,
        ticker: &str,
        multiple_type: MultipleType,
    ) -> Option<PeerAnchor> {
        let service = self.state.peers.as_ref()?;
        let summary = service.load(ticker).await?;
        let band = match multiple_type {
            MultipleType::Pe => summary.pe,
            MultipleType::EvSales => summary.ev_sales,
        }?;
        Some(PeerAnchor {
            multiple_type,
            p25: band.p25,
            median: band.median,
            p75: band.p75,
            n: band.n,
            tickers: band.tickers,
        })
    }

    async fn load_recent_filings(&self, ticker: &str) -> Vec<Filing> {
        let Some(service) = self.state.filings.as_ref() else {
            return Vec::new();
        };
        service
            .recent(ticker)
            .await
            .into_iter()
            .map(|filing| Filing {
                form: filing.form,
                filed_date: filing.filed_date,
                source_url: filing.source_url,
            })
            .collect()
    }

    async fn complete_answer(&self, system: &str, user: &str, user_id: &str) -> Option<String> {
        let audit = self
            .state
            .pool
            .as_ref()
            .map(|pool| AuditContext { pool, user_id });
        model_answer(
            system,
            user,
            ModelAnswerOptions::default(),
            self.state.model_provider.as_ref(),
            audit,
        )
        .await
        .map(|generated| generated.content)
    }

    async fn stream_answer(
        &self,
        system: String,
        user: String,
        user_id: String,
    ) -> ModelStreamStart {
        let audit = self.state.pool.as_ref().map(|pool| OwnedAuditContext {
            pool: pool.clone(),
            user_id,
        });
        model_answer_stream(
            system,
            user,
            ModelAnswerOptions::default(),
            self.state.model_provider.clone(),
            audit,
        )
    }

    async fn save_session(
        &self,
        user_id: &str,
        session: PersistResearchSession,
    ) -> Result<String, String> {
        let Some(pool) = &self.state.pool else {
            return Ok(session.id.unwrap_or_else(|| "s_offline".to_string()));
        };
        let save = SaveResearchSession {
            id: session.id,
            ticker: session.ticker,
            company_name: session.company_name,
            question: session.question,
            report_markdown: session.report_markdown,
            decision_panel: session.decision_panel,
            full_research: session.full_research,
            data_sources: session.data_sources,
            turn_count: session.turn_count,
            thread: session.thread,
            ..Default::default()
        };
        ResearchSessionRepository::new(pool)
            .save(user_id, &save)
            .await
            .map_err(|error| error.to_string())
    }

    async fn load_prior_turns(&self, user_id: &str, session_id: &str) -> Vec<PriorTurn> {
        let Some(pool) = &self.state.pool else {
            return Vec::new();
        };
        let Ok(Some(row)) = ResearchSessionRepository::new(pool)
            .get(user_id, session_id)
            .await
        else {
            return Vec::new();
        };
        row.thread_json
            .and_then(|value| serde_json::from_value::<Vec<PriorTurn>>(value).ok())
            .unwrap_or_default()
    }
}

async fn ask(
    State(state): State<AppState>,
    Extension(current_user): Extension<PublicUser>,
    Json(req): Json<AskRequest>,
) -> Json<AskResponse> {
    let req = prepare_research_request(&state, req).await;
    let ports = ApiResearchPorts {
        state: state.clone(),
    };
    let outcome = ResearchService::ask(&ports, &current_user.id, req.clone()).await;
    if !outcome.persisted && state.pool.is_some() {
        warn!(ticker = req.ticker, "研究会话落库失败，保留本轮响应");
    }
    Json(outcome.response)
}

/// 双主体对比研究：`POST /api/compare` —— 两个 ticker 各自走同一条单公司解析/建档管线
/// （`prepare_research_request`），再交给 `ResearchService::compare` 隔离取数、分别护栏。
/// 不落库（对比会话的落库形态待产品判断，见 IMPROVEMENT_PLAN §4 P3-1）。
async fn compare(
    State(state): State<AppState>,
    Extension(current_user): Extension<PublicUser>,
    Json(req): Json<CompareRequest>,
) -> Json<CompareResponse> {
    let primary = prepare_research_request(
        &state,
        AskRequest::minimal(req.question.clone(), req.primary_ticker),
    )
    .await;
    let peer = prepare_research_request(
        &state,
        AskRequest::minimal(req.question.clone(), req.peer_ticker),
    )
    .await;
    let ports = ApiResearchPorts {
        state: state.clone(),
    };
    let outcome = ResearchService::compare(
        &ports,
        &current_user.id,
        req.question,
        primary.ticker,
        peer.ticker,
    )
    .await;
    Json(outcome.response)
}

/// 流式作答：`POST /api/ask/stream` —— 类型化 SSE（meta/stage/delta/guard/final/error）；
/// 仅在干净完成后跑护栏并落库，由 `final.persisted` 报告落库结果。
async fn ask_stream(
    State(state): State<AppState>,
    Extension(current_user): Extension<PublicUser>,
    Json(req): Json<AskRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let req = prepare_research_request(&state, req).await;
    let ports = ApiResearchPorts { state };
    let rx = ResearchService::ask_stream(ports, current_user.id, req);
    let stream = ReceiverStream::new(rx).map(|event: ResearchStreamEvent| {
        let name = event.event_name();
        let data = serde_json::to_string(&event).unwrap_or_else(|_| {
            serde_json::to_string(&ResearchStreamEvent::Error(
                echo_contracts::ResearchStreamError {
                    message: "failed to serialize stream event".into(),
                },
            ))
            .expect("error event serializes")
        });
        Ok(Event::default().event(name).data(data))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

pub fn router(state: AppState) -> Router {
    let ask_rate_limited = middleware::from_fn_with_state(state.clone(), rate_limit_ask);
    let protected = Router::new()
        .route("/api/ask", post(ask).route_layer(ask_rate_limited.clone()))
        .route(
            "/api/ask/stream",
            post(ask_stream).route_layer(ask_rate_limited.clone()),
        )
        .route("/api/compare", post(compare).route_layer(ask_rate_limited))
        .route("/api/auth/invite", post(auth_invite))
        .route("/api/companies/search", get(companies_search))
        .route("/api/companies/resolve", get(companies_resolve))
        .route("/api/companies/verify", get(companies_verify))
        .route("/api/watch/list", get(watch_list))
        .route("/api/watch/track", post(watch_track))
        .route("/api/watch/untrack", post(watch_untrack))
        .route(
            "/api/portfolio",
            get(portfolio_list)
                .post(portfolio_upsert)
                .delete(portfolio_delete),
        )
        .route(
            "/api/preferences",
            get(preferences_get).patch(preferences_update),
        )
        .route("/api/notifications", get(notifications_list))
        .route("/api/notifications/unread", get(notifications_unread))
        .route("/api/notifications/read", post(notifications_read))
        .route(
            "/api/research/sessions",
            get(research_sessions_list).delete(research_sessions_clear),
        )
        .route(
            "/api/research/sessions/:id",
            get(research_session_get).delete(research_session_delete),
        )
        .route("/api/profiles", get(profiles_list))
        .route(
            "/api/profiles/:ticker",
            get(profile_get).put(profile_upsert).delete(profile_delete),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));
    Router::new()
        .route("/health", get(health))
        .route("/healthz", get(health))
        .route("/ready", get(ready))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/auth/me", get(auth_me))
        .merge(protected)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            enforce_origin,
        ))
        .layer(DefaultBodyLimit::max(MAX_JSON_BODY_BYTES))
        .with_state(state)
}

pub async fn run() {
    echo_observability::init("echo-api").expect("init tracing");
    let config = ApiConfig::from_env().expect("load echo-api config");
    let listen_addr = config.listen_addr;
    // 配了 DATABASE_URL 就建池（缺行情时兜底 DB 快照）；没配则纯核路径运行——两条路都真跑，
    // 不静默假装接了库。连不上库属硬失败：宁可启动即报，也不带半接的库悄悄降级。
    let pool = match config.database_url.as_deref() {
        Some(url) => {
            let pool = echo_db::connect(url, config.max_connections)
                .await
                .expect("connect DATABASE_URL");
            info!("DATABASE_URL 已连，缺行情将兜底 DB 快照");
            Some(pool)
        }
        None => {
            warn!("未配 DATABASE_URL——纯核路径，只吃请求体数字");
            None
        }
    };
    let quotes = pool.clone().map(|pool| {
        QuoteService::new(pool, config.data_sources.clone()).expect("build quote service")
    });
    let fundamentals = FundamentalsService::new(config.data_sources.clone()).ok();
    let calendar = pool
        .clone()
        .and_then(|pool| CalendarService::new(pool, config.data_sources.clone()).ok());
    let historical_valuation = pool
        .clone()
        .and_then(|pool| HistoricalValuationService::new(pool, config.data_sources.clone()).ok());
    let peers = pool
        .clone()
        .and_then(|pool| PeerService::new(pool, config.data_sources.clone()).ok());
    let filings = pool
        .clone()
        .and_then(|pool| FilingsService::new(pool, config.data_sources.clone()).ok());
    let fmp_search = FmpSearchService::new(config.data_sources.clone()).ok();
    let app = router(AppState {
        pool,
        quotes,
        fundamentals,
        calendar,
        historical_valuation,
        peers,
        filings,
        fmp_search,
        auth_disabled: config.auth_disabled,
        auth_disabled_user_id: config.auth_disabled_user_id,
        secure_cookie: config.secure_cookie,
        model_provider: config.model_provider,
        allowed_origins: config.allowed_origins,
        ask_rate_limit_per_minute: config.ask_rate_limit_per_minute,
    });
    let listener = tokio::net::TcpListener::bind(listen_addr)
        .await
        .expect("bind echo-api");
    info!(address = %listen_addr, "echo-api listening");
    axum::serve(listener, app).await.expect("serve echo-api");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use echo_contracts::AnswerSource;
    use tower::ServiceExt;

    #[test]
    fn cookie_parser_is_exact_and_cookie_flags_are_safe() {
        let headers = HeaderMap::from_iter([(
            COOKIE,
            HeaderValue::from_static("other=x; echo_session=abc_123; theme=dark"),
        )]);
        assert_eq!(request_token(&headers), Some("abc_123"));
        let cookie = session_cookie("abc_123", false, true)
            .expect("cookie")
            .to_str()
            .expect("header")
            .to_string();
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains("Secure"));
    }

    #[test]
    fn quiet_hours_parser_is_ascii_exact_and_panic_free() {
        assert!(valid_hhmm("00:00"));
        assert!(valid_hhmm("23:59"));
        assert!(!valid_hhmm("24:00"));
        assert!(!valid_hhmm("12:60"));
        assert!(!valid_hhmm("九:00"));
        assert!(!valid_hhmm("1:00"));
    }

    #[tokio::test]
    async fn health_and_local_auth_are_available_without_database() {
        let app = router(AppState::without_database());
        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("health");
        assert_eq!(health.status(), StatusCode::OK);

        let healthz = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("healthz");
        assert_eq!(healthz.status(), StatusCode::OK);

        let me = app
            .oneshot(
                Request::builder()
                    .uri("/api/auth/me")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("me");
        assert_eq!(me.status(), StatusCode::OK);
        let body = to_bytes(me.into_body(), 64 * 1024).await.expect("body");
        let response: AuthMeResponse = serde_json::from_slice(&body).expect("contract");
        assert_eq!(response.user.expect("local user").id, "local");
        assert!(!response.multi_user);
    }

    #[tokio::test]
    async fn protected_ask_receives_local_tenant_in_dbless_mode() {
        let request = AskRequest::minimal("苹果估值？", "AAPL");
        let response = router(AppState::without_database())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ask")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request).expect("json")))
                    .expect("request"),
            )
            .await
            .expect("ask");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 256 * 1024)
            .await
            .expect("body");
        let answer: AskResponse = serde_json::from_slice(&body).expect("shared contract");
        assert_eq!(answer.ticker, "AAPL");
        assert_eq!(answer.answer_source, AnswerSource::Unavailable);
    }

    #[tokio::test]
    async fn readiness_is_ok_without_database() {
        let response = router(AppState::without_database())
            .oneshot(
                Request::builder()
                    .uri("/ready")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("ready");
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn mismatched_origin_is_rejected_on_mutating_requests() {
        let request = AskRequest::minimal("苹果估值？", "AAPL");
        let response = router(AppState::without_database())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ask")
                    .header("content-type", "application/json")
                    .header("origin", "https://evil.example")
                    .body(Body::from(serde_json::to_vec(&request).expect("json")))
                    .expect("request"),
            )
            .await
            .expect("ask");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn matching_origin_is_allowed_through() {
        let request = AskRequest::minimal("苹果估值？", "AAPL");
        let response = router(AppState::without_database())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ask")
                    .header("content-type", "application/json")
                    .header("origin", "http://localhost:5190")
                    .body(Body::from(serde_json::to_vec(&request).expect("json")))
                    .expect("request"),
            )
            .await
            .expect("ask");
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    #[ignore = "需要隔离 DATABASE_URL；验证 Rust 认证、RLS 会话和保护路由"]
    async fn live_register_session_logout_round_trip() {
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let pool = echo_db::connect(&database_url, 3).await.expect("connect");
        if std::env::var("ECHO_SKIP_TEST_MIGRATE").ok().as_deref() != Some("1") {
            echo_db::migrate(&pool).await.expect("migrate");
        }
        let auth = AuthService::new(&pool);
        let owner = auth
            .create_owner("owner@example.com", "owner-password", Some("Owner".into()))
            .await
            .expect("owner");
        let invite = auth
            .create_invite(&owner, Some("integration"))
            .await
            .expect("invite");
        let app = router(AppState {
            pool: Some(pool),
            quotes: None,
            fundamentals: None,
            calendar: None,
            historical_valuation: None,
            peers: None,
            filings: None,
            fmp_search: None,
            auth_disabled: false,
            auth_disabled_user_id: "local".into(),
            secure_cookie: false,
            model_provider: None,
            allowed_origins: vec!["http://localhost:5190".into()],
            ask_rate_limit_per_minute: 20,
        });

        let register = AuthRegisterRequest {
            invite,
            username: "member@example.com".into(),
            password: "member-password".into(),
            display_name: Some("Member".into()),
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/register")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&register).expect("json")))
                    .expect("request"),
            )
            .await
            .expect("register");
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get(SET_COOKIE)
            .expect("session cookie")
            .to_str()
            .expect("cookie")
            .split(';')
            .next()
            .expect("cookie pair")
            .to_string();

        let ask = AskRequest::minimal("腾讯估值？", "0700.HK");
        let protected = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ask")
                    .header("content-type", "application/json")
                    .header(COOKIE, &cookie)
                    .body(Body::from(serde_json::to_vec(&ask).expect("json")))
                    .expect("request"),
            )
            .await
            .expect("protected ask");
        assert_eq!(protected.status(), StatusCode::OK);

        let logout = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/logout")
                    .header(COOKIE, &cookie)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("logout");
        assert_eq!(logout.status(), StatusCode::OK);
        assert!(
            logout.headers()[SET_COOKIE]
                .to_str()
                .expect("clear cookie")
                .contains("Max-Age=0")
        );

        let rejected = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ask")
                    .header("content-type", "application/json")
                    .header(COOKIE, cookie)
                    .body(Body::from(serde_json::to_vec(&ask).expect("json")))
                    .expect("request"),
            )
            .await
            .expect("rejected ask");
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    }
}
