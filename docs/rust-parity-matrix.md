# Echo Rust 功能平价矩阵

> Phase 0 capability ledger for the Rust-only migration after PR #43 (`dc4b75c`).
>
> Migration baseline: `dc4b75c^` / `eb3b766`. Historical TypeScript/React/Python code is behavior-only reference and must not be restored as a runtime.
>
> Last inventoried: 2026-07-21 · Updated for #44 (ResearchService / QA fixtures) and #45 (CI live DB).

## 1. Purpose and update rules

This ledger prevents “the old files were deleted” from being treated as product parity. Every baseline capability must have exactly one current status and a concrete Rust landing, replacement, retirement decision, or blocker.

Update this document in every parity-related PR:

1. Update the affected row’s Rust landing, tests, owner/PR, and status.
2. `rust-accepted` requires a Rust implementation plus relevant automated evidence; compilation, mocks alone, ignored tests, or a manual curl are insufficient.
3. Use `replaced` only when the replacement is named and its migration behavior is documented.
4. Use `retire-candidate` only while an ADR/product decision is pending; once approved, retain the row and link the ADR.
5. Do not mutate migration files `0001`–`0010`; add `0011+` migrations only.
6. Keep the totals in §10 synchronized with this ledger.

## 2. Status legend

| Status | Meaning |
| --- | --- |
| `rust-accepted` | Rust implementation is the supported landing and has proportionate automated tests. |
| `skeleton` | Rust code/path exists, but important behavior, boundaries, persistence, security, or UI workflow is incomplete. |
| `pending` | Baseline capability remains in scope but has no adequate Rust equivalent. |
| `replaced` | Deliberately consolidated into a named Rust capability; migration behavior still needs documentation/tests. |
| `retire-candidate` | Candidate for removal; requires an explicit product decision and ADR before closure. |
| `blocked` | Cannot be safely accepted until an external dependency, production decision, or prerequisite is resolved. |
| `product-decide` | Product scope is genuinely unclear; implementation must not silently choose retention or retirement. |

Default product decision is `keep`. Only explicitly unclear areas use `product-decide`.

## 3. HTTP/API parity

The baseline contained 45 REST surfaces: `/healthz` plus 44 registered REST contracts. Rust’s `/api/ask/stream` is listed as the current SSE form under the baseline `/api/ask` capability.

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Liveness probe | `GET /healthz` | `echo-api::health` (`/health`, `/healthz`) | rust-accepted | API unit tests; image smoke still pending | keep | #43 | 仅 liveness；尚未实现依赖 DB/必需配置的 readiness。 |
| Login | `POST /api/auth/login` | `echo-api::auth_login`, `echo-application::AuthService` | rust-accepted | auth/API + CI live (#45) | keep | #43 / #45 | scrypt、cookie session 已落地。 |
| Invite registration | `POST /api/auth/register` | `echo-api::auth_register` | rust-accepted | auth/API + CI live (#45) | keep | #43 / #45 | 邀请码注册已落地。 |
| Logout | `POST /api/auth/logout` | `echo-api::auth_logout` | rust-accepted | auth/API + CI live (#45) | keep | #43 / #45 | 销毁 session 并清 cookie。 |
| Current user | `GET /api/auth/me` | `echo-api::auth_me` | rust-accepted | auth/API tests | keep | #43 | 支持本地禁用认证模式。 |
| Create invite | `POST /api/auth/invite` | `echo-api::auth_invite` | rust-accepted | auth/API tests | keep | #43 | 已有 owner 检查；CI live 覆盖 register/session。 |
| Verify ticker | `GET /api/companies/verify` | — | pending | — | keep | Phase 2 | 需“验证成功后才建档”的闭环。 |
| Resolve company identity | `GET /api/companies/resolve` | — | pending | — | keep | Phase 2 | 缺名称→ticker、别名、供应商搜索、行情验证链。 |
| Search companies | `GET /api/companies/search` | `CompanyRepository::search`, `echo-api::companies_search` | rust-accepted | repository/API tests | keep | #43 | 仅本地库检索；不是 resolve/verify 替代品。 |
| Supplier/system status | `GET /api/status` | — | pending | — | keep | Phase 2–3 | 缺 canary、数据新鲜度、供应商可用性汇总。 |
| Get preferences | `GET /api/preferences` | `PreferencesRepository`, `preferences_get` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 偏好读写已在 Rust。 |
| Update preferences | `PATCH /api/preferences` | `PreferencesRepository`, `preferences_update` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 免打扰/通知偏好写入咽喉。 |
| Submit feedback | `POST /api/feedback` | — | pending | — | keep | Phase 3 | `feedback` 表无完整 Rust repository/API。 |
| Parse document | `POST /api/parse-document` | — | pending | — | keep | Phase 3 | 文件/文档解析及其安全边界未迁移。 |
| Research answer | `POST /api/ask` | `ResearchService` + `echo-api` adapter | skeleton | application fake ports + API | keep | #44 | 编排已收口 application；完整取数/hard-fail/客户端事实隔离未完。 |
| Research SSE | historical SSE on ask | `POST /api/ask/stream` typed events | skeleton | application stream tests + contract tags | keep | typed-research-stream | meta/stage/delta/guard/final/error 已落地并在 final 后落库；Web 仍走非流式；缺取消传播 |
| Chat alias | `POST /api/chat` | Unified `POST /api/ask` | replaced | ask contract tests | keep | #44 / Phase 3 | 统一研究入口可替代独立 chat；需 ADR/兼容说明。 |
| Generate deep report | `POST /api/report/generate` | — | pending | — | keep | Phase 3–4 | 独立深度报告契约未迁移。 |
| Discover | `POST /api/discover` | — | product-decide | — | product-decide | Product / ADR | 是否保留“发现”工作流未裁决。 |
| Events digest | `GET /api/events/digest` | Worker digest 内部活动 | pending | worker activity tests only | keep | Phase 3 | Worker 可发摘要，不等价用户读取 API。 |
| Ingest HK financials | `POST /api/hk-financials/ingest` | — | pending | — | keep | Phase 2–3 | HKEX/filing ingestion 未迁移。 |
| Read HK financials | `GET /api/hk-financials` | — | pending | — | keep | Phase 2–3 | `hk_financials` 读模型/API 未迁移。 |
| Unread notification count | `GET /api/notifications/unread` | `NotificationsRepository::unread` | rust-accepted | repository/API tests | keep | #43 | 已有用户过滤。 |
| Mark notifications read | `POST /api/notifications/read` | `NotificationsRepository::mark_read` | rust-accepted | repository/API tests | keep | #43 | 支持单条/全部已读。 |
| Send notification test | `POST /api/notifications/test` | — | pending | — | keep | Phase 3 | 测试通知契约未迁移。 |
| List notifications | `GET /api/notifications` | `NotificationsRepository::list` | rust-accepted | repository/API tests | keep | #43 | 基础列表已落地。 |
| Scheduler status | `GET /api/scheduler/status` | scheduler state 仅 Worker 内部 | pending | scheduler unit + CI live | keep | Phase 3 / #45 | 缺 owner/API status 投影。 |
| Watch desk | `GET /api/watch/desk` | `GET /api/watch/list` | skeleton | repository/API + CI live | keep | #43 / #45 | 基础列表可用；缺 desk、事件、规则聚合。 |
| Watch stock detail | `GET /api/watch/stock` | — | pending | — | keep | Phase 3–4 | 缺单股详情、证据、事件与规则视图。 |
| Track watch item | `POST /api/watch/track` | `watch_track` | skeleton | repository/API + CI live | keep | #43 / #45 | 基础增删有；未连同 desk/detail/rules。 |
| Untrack watch item | `POST /api/watch/untrack` | `watch_untrack` | skeleton | repository/API + CI live | keep | #43 / #45 | 同上。 |
| Portfolio review | `GET /api/portfolio/review` | operations worker calculations | skeleton | worker activity tests | keep | Phase 3–4 | 复盘计算存在片段，用户 API/UI 未完成。 |
| Portfolio snapshots | `GET /api/portfolio/snapshots` | worker `capture_portfolios` 写入 | pending | worker activity tests | keep | Phase 3–4 | 有写入活动，缺读取契约与授权测试。 |
| List portfolio | `GET /api/portfolio` | `PortfolioRepository::list` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 基础持仓 CRUD 已落地。 |
| Upsert portfolio position | `POST /api/portfolio` | `PortfolioRepository::upsert` | rust-accepted | repository/API + CI live | keep | #43 / #45 | Decimal 持仓、成本等字段。 |
| Delete portfolio position | `DELETE /api/portfolio` | `PortfolioRepository::delete` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 按用户与 ticker 删除。 |
| List company profiles | `GET /api/company/profiles` | — | pending | — | keep | Phase 3 | `company_profiles` repository/API 未迁移。 |
| Company profile | `GET /api/company/profile` | — | pending | — | keep | Phase 3 | 画像及 markdown 投影未迁移。 |
| Delete company profile | `DELETE /api/company/profile` | — | pending | — | keep | Phase 3 | 同上。 |
| Company review | `GET /api/company/review` | — | pending | — | keep | Phase 3–4 | 画像 review/scorecard 未迁移。 |
| Research scorecard | `GET /api/research/scorecard` | — | pending | — | keep | Phase 3–4 | 研究质量/资产 scorecard 未迁移。 |
| Research conversations | `GET /api/research/conversations` | — | pending | — | keep | Phase 1, 3 | 现有 session 是独立 turn；缺 conversation grouping。 |
| List research sessions | `GET /api/research/sessions` | `ResearchSessionRepository::list` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 列表、读取、删除、清空基础契约已存在。 |
| Clear research sessions | `DELETE /api/research/sessions` | `ResearchSessionRepository::clear` | rust-accepted | repository/API tests | keep | #43 | 同上。 |
| Get research session | `GET /api/research/sessions/:id` | `ResearchSessionRepository::get` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 不等价多轮 conversation。 |
| Delete research session | `DELETE /api/research/sessions/:id` | `ResearchSessionRepository::delete` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 同上。 |

## 4. Web page parity

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Login/register | `/login` | `echo-web::LoginPage` | rust-accepted | Rust WebDriver E2E currently ignored | keep | #43 | 基础登录、注册可用；需解除 E2E ignore。 |
| Research | `/`, `/research` | `ResearchPage` | skeleton | component tests absent; E2E ignored | keep | Phase 4 | 非流式 ask；缺 SSE、取消、重试、阶段反馈、来源卡、历史继续及深链接。 |
| Watch list | `/watch` | `WatchPage` | skeleton | component tests absent | keep | Phase 4 | 基础自选增删；缺 desk、规则、事件。 |
| Stock detail | `/watch/:ticker` | — | pending | — | keep | Phase 4 | 无详情页、引用证据、事件与规则管理。 |
| Portfolio | `/portfolio` | `PortfolioPage` | skeleton | component tests absent | keep | Phase 4 | 基础 CRUD；缺实时市值、盈亏、风险、复盘、历史曲线。 |
| Settings | `/settings` | `SettingsPage`, notification bell | skeleton | component tests absent | keep | Phase 4 | 仅偏好；缺邀请、反馈、导出、画像等设置能力。 |
| Membership | `/membership` | — | product-decide | — | product-decide | Product / ADR | 计费/会员是否继续属于产品范围未裁决。 |
| Offline/PWA | manifest, service worker, icons | — | product-decide | — | product-decide | Product / ADR | 旧 PWA 已删除；需决定恢复或正式退役。 |

## 5. Worker job parity

All nine schedules are defined and can execute activities, but no atomic claim/lease/advisory lock exists. Until that is fixed, multiple Worker instances may duplicate work; therefore all are `skeleton`.

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Premarket digest | `echo-premarket-digest` | `JobKind::PremarketDigest` | skeleton | schedule/activity unit tests | keep | Phase 5 | 无分布式 lease；通知依赖偏好/去重路径。 |
| After-hours digest | `echo-afterhours-digest` | `JobKind::AfterhoursDigest` | skeleton | schedule/activity unit tests | keep | Phase 5 | 同上。 |
| Market refresh | `echo-market-refresh` | `JobKind::MarketRefresh` | skeleton | schedule/activity unit tests | keep | Phase 5 | quote 可刷新；`tracked_tickers` 与 FORCE RLS 后台权限仍需验证。 |
| Portfolio snapshot | `echo-portfolio-snapshot` | `JobKind::PortfolioSnapshot` | skeleton | schedule/activity unit tests | keep | Phase 5 | 会写快照；缺读模型闭环与并发安全。 |
| Falsifier check | `echo-falsifier-check` | `JobKind::FalsifierCheck` | skeleton | schedule/activity unit tests | keep | Phase 5 | 基础规则检查存在；规则管理 API/UI 缺失。 |
| Earnings review | `echo-earnings-review` | `JobKind::EarningsReview` | skeleton | schedule/activity unit tests | keep | Phase 5 | 依赖未迁移的财务/日历数据面。 |
| Position alert | `echo-position-alert` | `JobKind::PositionAlert` | skeleton | schedule/activity unit tests | keep | Phase 5 | 可计算基础阈值；需真实 RLS、lease、重试测试。 |
| Review reminder | `echo-review-reminder` | `JobKind::ReviewReminder` | skeleton | schedule/activity unit tests | keep | Phase 5 | 提醒活动存在，产品复盘 UI/API 不完整。 |
| PostgreSQL backup | `echo-postgres-backup` | `JobKind::PostgresBackup` | skeleton | activity unit tests | keep | Phase 5 | 当前仅 `pg_dump` 至本地目录；未读 `ECHO_BACKUP_BUCKET`、未上传 S3。 |

## 6. Data adapter parity

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Finnhub quote | `finnhubQuoteAdapter` | `echo-data::QuoteService` | rust-accepted | quote/router/quality tests | keep | #43 | Decimal 映射、质量门、熔断、写库已存在。 |
| Yahoo quote | `yahooQuoteAdapter` | `echo-data::QuoteService` | rust-accepted | quote/router/quality tests | keep | #43 | 同上；商用模式必须遵守授权门。 |
| PostgreSQL quote read | `postgresQuoteAdapter` | `MarketRepository` | replaced | repository tests | keep | #43 | 已由 Rust DB repository 承接。 |
| FMP fundamentals | `fmpFundamentalsAdapter` | `echo-data::FundamentalsService` | rust-accepted | fixture + commercial/HK gates | keep | Phase 2 | US-only stable 三表；商用模式拒绝；`ResearchPorts::load_fundamentals` 已接线。 |
| FMP company search | `fmpSearchAdapter` | `echo-data::FmpSearchService` | rust-accepted | normalize/filter + resolve ports | keep | Phase 2 | resolve/verify 已消费；研究链路建档 ensure 仍待接。 |
| Company resolve/verify | `companyResolution` | `CompanyResolveService` + `/api/companies/{resolve,verify}` | skeleton | alias/identity + fake-port tests | keep | Phase 2 | 无 LLM 兜底；验证先于建档的研究入口未接线。 |
| Tavily evidence search | `tavilySearchAdapter` | — | pending | — | keep | Phase 2 | 配置含 `TAVILY_API_KEY`，但没有 consumer。 |
| Finnhub earnings calendar | `finnhubCalendarAdapter` | — | pending | — | keep | Phase 2 | 日历/业绩数据端口未迁移。 |
| Finnhub peers | `finnhubPeersAdapter` | — | pending | — | keep | Phase 2 | 同业比较事实未迁移。 |
| HK ADR/calendar | `hkAdrCalendarAdapter` | — | pending | — | keep | Phase 2 | 港股/ADR 日期与映射链缺失。 |
| PostgreSQL calendar | `postgresCalendarAdapter` | — | pending | — | keep | Phase 2–3 | `earnings_calendar` 缺完整 Rust repository。 |
| PostgreSQL filings | `postgresFilingsAdapter` | — | pending | — | keep | Phase 2–3 | filing/公告读模型未迁移。 |
| PostgreSQL fundamentals | `postgresFundamentalsAdapter` | — | pending | — | keep | Phase 2–3 | 财务事实、期间、口径、来源、双时间语义未迁移。 |

## 7. DB repositories and tables

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth/users/sessions/invites | `authRepository` | `AuthRepository`, `AuthService` | rust-accepted | auth tests + CI live NOBYPASSRLS | keep | #43 / #45 | CI 用 `echo_app` 跑 register/session round-trip。 |
| Companies | `companyRepository` | `CompanyRepository::{search,ensure,by_ticker}` | rust-accepted | repository/API + resolve | keep | #43 / Phase 2 | search/ensure 已有；resolve/verify HTTP 已接；研究建档未自动调用 ensure。 |
| Market snapshots | quote repositories | `MarketRepository`, `QuoteService` | rust-accepted | market/quote tests | keep | #43 | 需要真实供应商 contract/canary。 |
| Watchlist | `watchlistRepository` | `WatchlistRepository` | skeleton | repository/API + CI live | keep | #43 / #45 | 基础 track/list/untrack；不能替代 rules/desk。 |
| Portfolio positions | `portfolioRepository` | `PortfolioRepository` | skeleton | repository/API + CI live | keep | #43 / #45 | CRUD 已有；enriched/review/snapshot 仍缺。 |
| Preferences | `userPreferencesRepository` | `PreferencesRepository` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 通知偏好已落地。 |
| Notifications | `notificationsRepository` | `NotificationsRepository` | rust-accepted | repository/API tests | keep | #43 | 去重咽喉存在。 |
| Research sessions | `researchSessionsRepository` | `ResearchSessionRepository` | skeleton | repository/API + CI live | keep | #43 / #45 | 单 turn 保存；缺 conversation/facts/guard 版本链。 |
| Scheduler state | scheduler repository | `SchedulerStateRepository` | skeleton | schedule tests + CI live | keep | #45 / Phase 5 | 有运行记录，无 claim/lease、失败游标和 status API。 |
| Operations/rules/snapshots | worker repositories | `OperationsRepository` | skeleton | activity tests | keep | #43 | Worker 内部读取存在；公开 API 与后台 RLS 仍不足。 |
| LLM audit | `llmAuditRepository` | partial DB implementation | skeleton | unit tests | keep | Phase 1, 3 | stream final 状态和全链路追溯未闭环。 |
| Data-source fields/canary | canary repositories | — | pending | — | keep | Phase 2 | 缺新鲜度、授权元数据、供应商 canary repository。 |
| Feedback | `feedbackRepository` | — | pending | — | keep | Phase 3 | 无 Rust 写入边界。 |
| Documents | `documentRepository` | — | pending | — | keep | Phase 3 | 无安全的上传、解析、存储边界。 |
| Financial/history/HK facts | financials / HK repositories | — | pending | — | keep | Phase 2–3 | 缺 bitemporal 财务、估值及 HK facts repository。 |
| Peers/calendar/evidence | peers/calendar/evidence repos | — | pending | — | keep | Phase 2–3 | 同业、日历、网页证据无 Rust 读写边界。 |
| Profiles/research snapshots/memory | profile/snapshot/memory repos | — | pending | — | keep | Phase 3–4 | 未迁移。 |
| Team/audit/billing | team/audit/billing repositories | — | pending | — | keep | Phase 3 / product | P5 表仍存在；是否继续使用需确认。 |
| Rate limits | `rate_limit_buckets` | table only | pending | — | keep | Phase 3, 5 | Rust API 没有应用层限流。 |
| Tenant/RLS integration | RLS context suite | `with_tenant`, partial repos | skeleton | CI live with `echo_app` NOBYPASSRLS | keep | #45 | 双租户正反向与 Worker 路径仍需扩覆盖。 |

## 8. QA corpora and gates

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Intent-routing corpus | historical `corpus.ts` | `docs/qa/fixtures/intent-routing-corpus.json` + `intent_routing_corpus.rs` | skeleton | 275 cases; 101 intent asserts green | keep | #44 | ticker/discovery/comparison 等字段 deferred。 |
| Historical agent-QA baseline | historical result | `agent-qa-baseline.historical.json` | rust-accepted | fixture integrity | keep | #44 | 保留历史基线，不作静默删 case。 |
| Current intent baseline | — | `intent-routing-baseline.current.json` | rust-accepted | recorded from runner | keep | #44 | intent_failures=0；deferred 字段已记账。 |
| Live research probes | historical `live.ts` | `live-research-probes.json` | pending | 15 declarative probes only | keep | Phase 6 | 需 Rust runner 与 live canary。 |
| Migration checksums | migration ledger | `migration-checksums.json` | rust-accepted | frozen SHA-256 for 0001–0010 | keep | #44 | 后续仅新增 0011+。 |
| API JSON snapshots | wire contracts | `api-json-snapshots.json` | rust-accepted | fixture | keep | #44 | Ask/Health 形状冻结。 |
| Browser E2E | old web/API flow tests | `echo-e2e`, `cargo xtask e2e` | pending | currently ignored | keep | Phase 6 | 需 CI 自启 API/Trunk/WebDriver。 |

## 9. Production and infrastructure gaps

These are P0 blockers from the handoff. Dockerfiles or Terraform resources alone do not count as completion.

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Deploy Rust Web | Terraform/ECS topology | Web Dockerfile only | blocked | no image smoke/deploy test | keep | Phase 5 | Terraform 未部署 `echo-web`。 |
| HTTPS and secure cookies | ALB/domain/certificate | partial cookie flag | blocked | — | keep | Phase 5 | 缺 ACM、443、域名、HSTS。 |
| Runtime secret injection | Secrets Manager | config parses keys | blocked | — | keep | Phase 5 | Terraform 未注入模型与数据源密钥。 |
| S3 backup and restore | `ECHO_BACKUP_BUCKET` | local `pg_dump` | blocked | no S3/restore drill | keep | Phase 5 | Worker 不读取 bucket。 |
| Multi-worker safety | ECS desired count 2–8 | due-time scheduler only | blocked | no dual-worker test | keep | Phase 5 | 缺 claim/lease。 |
| Observability | OTEL Terraform config | tracing logs only | blocked | — | keep | Phase 5 | OTLP exporter 未安装。 |
| Research/API rate limiting | WAF/table claim | table only | blocked | — | keep | Phase 3, 5 | 缺应用层配额。 |
| API safety/readiness | production boundary | basic Axum middleware | blocked | — | keep | Phase 3, 5 | 缺 CSRF/Origin、readiness、优雅停机。 |
| Build and IaC gates | release CI | `cargo xtask` + live DB (#45) | skeleton | Docker/IaC CI still missing | keep | #45 / Phase 5–6 | 活库进 CI；仍缺 Docker/TF gates。 |
| Production recovery exercise | runbook | — | blocked | no restore/failover rehearsal | keep | Phase 5–6 | 需备份恢复与故障演练。 |

## 10. Summary counts by status

| Status | Count |
| --- | ---: |
| rust-accepted | 32 |
| skeleton | 27 |
| pending | 36 |
| replaced | 2 |
| retire-candidate | 0 |
| blocked | 9 |
| product-decide | 3 |
| **Total** | **109** |

Completion condition: this ledger may only contain `rust-accepted` or ADR-closed `replaced`/retired entries before the Rust migration is declared complete.

## 变更记录

| Date | Change |
| --- | --- |
| 2026-07-21 | 初版缩略矩阵随 #44 |
| 2026-07-21 | 扩展为 109 行完整底账（对齐交接书逐能力清点）；同步 #44 ResearchService 与 #45 CI live DB |
