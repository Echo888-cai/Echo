# Echo Rust 功能平价矩阵

> Phase 0 capability ledger for the Rust-only migration after PR #43 (`dc4b75c`).
>
> Migration baseline: `dc4b75c^` / `eb3b766`. Historical TypeScript/React/Python code is behavior-only reference and must not be restored as a runtime.
>
> Last inventoried: 2026-07-22 · Updated for #44 (ResearchService / QA fixtures), #45 (CI live DB),
> P2-4 (api-hardening: rate limit / readiness / Origin / body limit), P2-3 remainder
> (comp_peers 同业锚点接线), P2 remainder (company_filings 公告读模型接线, migration 0011), and
> P3-2 (company_profiles repository/API + Web 编辑页接线；自动沉淀仍 pending), Web 对比视图/
> 深度报告导出接线, P4-1 (worker-lease claim/lease 接线), P4-2 (digest 真实内容 + 邮件通道接线),
> P4-3 (watch_rules CRUD + desk 视图接线)。

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
| Liveness probe | `GET /healthz` | `echo-api::health` (`/health`, `/healthz`) | rust-accepted | API unit tests; image smoke still pending | keep | #43 | 仅 liveness。 |
| Readiness probe | — | `echo-api::ready` (`/ready`, `echo_db::ping`) | rust-accepted | API unit test + 真库端到端手测（见 P2-4） | keep | P2-4 | 配库时真连 `SELECT 1`，掉线 503；未配库（纯核部署）视为就绪。 |
| Login | `POST /api/auth/login` | `echo-api::auth_login`, `echo-application::AuthService` | rust-accepted | auth/API + CI live (#45) | keep | #43 / #45 | scrypt、cookie session 已落地。 |
| Invite registration | `POST /api/auth/register` | `echo-api::auth_register` | rust-accepted | auth/API + CI live (#45) | keep | #43 / #45 | 邀请码注册已落地。 |
| Logout | `POST /api/auth/logout` | `echo-api::auth_logout` | rust-accepted | auth/API + CI live (#45) | keep | #43 / #45 | 销毁 session 并清 cookie。 |
| Current user | `GET /api/auth/me` | `echo-api::auth_me` | rust-accepted | auth/API tests | keep | #43 | 支持本地禁用认证模式。 |
| Create invite | `POST /api/auth/invite` | `echo-api::auth_invite` | rust-accepted | auth/API tests | keep | #43 | 已有 owner 检查；CI live 覆盖 register/session。 |
| Verify ticker | `GET /api/companies/verify` | — | pending | — | keep | Phase 2 | 需“验证成功后才建档”的闭环。 |
| Resolve company identity | `GET /api/companies/resolve` | `CompanyResolveService::resolve_query` + `echo-api::companies_resolve` | rust-accepted | application/repository 单测 + 真库/真 FMP 端到端（composer resolve-first 接线） | keep | P1-3 | DB→别名→FMP 搜索→行情探活→（可选 LLM 消歧）全链已接；Web composer 单输入框已消费，不再要求手输 ticker。 |
| Search companies | `GET /api/companies/search` | `CompanyRepository::search`, `echo-api::companies_search` | rust-accepted | repository/API tests | keep | #43 | 仅本地库检索；不是 resolve/verify 替代品。 |
| Supplier/system status | `GET /api/status` | — | pending | — | keep | Phase 2–3 | 缺 canary、数据新鲜度、供应商可用性汇总。 |
| Get preferences | `GET /api/preferences` | `PreferencesRepository`, `preferences_get` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 偏好读写已在 Rust。 |
| Update preferences | `PATCH /api/preferences` | `PreferencesRepository`, `preferences_update` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 免打扰/通知偏好写入咽喉。 |
| Submit feedback | `POST /api/feedback` | — | pending | — | keep | Phase 3 | `feedback` 表无完整 Rust repository/API。 |
| Parse document | `POST /api/parse-document` | — | pending | — | keep | Phase 3 | 文件/文档解析及其安全边界未迁移。 |
| Research answer | `POST /api/ask` | `ResearchService::ask` + `echo-api::ApiResearchPorts`（真实生产端口，非 fake） | rust-accepted | application 单测 + 真库/真供应商端到端（filings/calendar/peers/历史分位全接） | keep | #44 / P2 / P3-4 | 取数管线（fundamentals+filings+calendar+peer anchor+历史分位）、`fact_guard` hard-fail、多轮历史隔离（历史绝不进 `FactsRegistry`）均已接线并真数据验证。 |
| Research SSE | historical SSE on ask | `POST /api/ask/stream` typed events | rust-accepted | application stream tests + contract tags + Web 手动浏览器验证 | keep | web-typed-stream | meta/stage/delta/guard/final/error 已落地并在 final 后落库；Web 已消费，取消经 `AbortController` 传播、服务端断流落 `cancelled` 审计。 |
| Chat alias | `POST /api/chat` | Unified `POST /api/ask` | replaced | ask contract tests | keep | #44 / Phase 3 | 统一研究入口可替代独立 chat；需 ADR/兼容说明。 |
| Generate deep report | `POST /api/report/generate` | `ReportService` + `echo-api` adapter + `echo-web::research::ReportCard` | rust-accepted | application unit tests（本地兜底/模型路径/落库）+ 纯核路径真实 HTTP 端到端验证 + Web 端真实生成/下载实测（AAPL 完整七段报告） | keep | IMPROVEMENT_PLAN §4 P3-3 | 与 `/api/ask` 共用 `assemble_facts`/`build_panel`/护栏；报告专属提示词固定七段结构，模型不可用或输出短于 200 字退化为本地确定性报告，落库归位同一研究会话。Web 视图/导出已接（研究页 composer 按钮，客户端 Blob 下载 `.md`）。 |
| Discover | `POST /api/discover` | — | product-decide | — | product-decide | Product / ADR | 是否保留“发现”工作流未裁决。 |
| Events digest | 通知面板 + 邮件 | `NotificationsRepository`/`EmailService`（SMTP，未配置诚实降级） | done | live worker test `live_digest_and_rule_checks_run_against_real_data` | keep | P4-2 | Digest 内容改为真实持仓异动/规则计数/触发计数（不再是占位统计），经偏好/免打扰/去重咽喉后镜像发邮件；`GET /api/events/digest` 单独端点未做，站内通知走既有 `/api/notifications`。 |
| Ingest HK financials | `POST /api/hk-financials/ingest` | — | pending | — | keep | Phase 2–3 | HKEX/filing ingestion 未迁移。 |
| Read HK financials | `GET /api/hk-financials` | — | pending | — | keep | Phase 2–3 | `hk_financials` 读模型/API 未迁移。 |
| Unread notification count | `GET /api/notifications/unread` | `NotificationsRepository::unread` | rust-accepted | repository/API tests | keep | #43 | 已有用户过滤。 |
| Mark notifications read | `POST /api/notifications/read` | `NotificationsRepository::mark_read` | rust-accepted | repository/API tests | keep | #43 | 支持单条/全部已读。 |
| Send notification test | `POST /api/notifications/test` | — | pending | — | keep | Phase 3 | 测试通知契约未迁移。 |
| List notifications | `GET /api/notifications` | `NotificationsRepository::list` | rust-accepted | repository/API tests | keep | #43 | 基础列表已落地。 |
| Scheduler status | `GET /api/scheduler/status` | scheduler state 仅 Worker 内部 | pending | scheduler unit + CI live | keep | Phase 3 / #45 | 缺 owner/API status 投影。 |
| Watch desk | `GET /api/watch/desk` | `GET /api/watch/desk` | done | live curl + browser round-trip against dev DB | keep | P4-3 | 聚合关注列表+持仓+规则涉及的全部 ticker，各自最新行情、挂载规则、近期触发通知；只读聚合，不新增写路径。 |
| Watch stock detail | `GET /api/watch/stock` | — | pending | — | keep | Phase 3–4 | 缺单股详情、证据、事件与规则视图。 |
| Track watch item | `POST /api/watch/track` | `watch_track` | skeleton | repository/API + CI live | keep | #43 / #45 | 基础增删有；未连同 desk/detail/rules。 |
| Untrack watch item | `POST /api/watch/untrack` | `watch_untrack` | skeleton | repository/API + CI live | keep | #43 / #45 | 同上。 |
| Portfolio review | `GET /api/portfolio/review` | operations worker calculations | skeleton | worker activity tests | keep | Phase 3–4 | 复盘计算存在片段，用户 API/UI 未完成。 |
| Portfolio snapshots | `GET /api/portfolio/snapshots` | worker `capture_portfolios` 写入 | pending | worker activity tests | keep | Phase 3–4 | 有写入活动，缺读取契约与授权测试。 |
| List portfolio | `GET /api/portfolio` | `PortfolioRepository::list` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 基础持仓 CRUD 已落地。 |
| Upsert portfolio position | `POST /api/portfolio` | `PortfolioRepository::upsert` | rust-accepted | repository/API + CI live | keep | #43 / #45 | Decimal 持仓、成本等字段。 |
| Delete portfolio position | `DELETE /api/portfolio` | `PortfolioRepository::delete` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 按用户与 ticker 删除。 |
| List company profiles | `GET /api/company/profiles` | `GET /api/profiles`（`echo-db::CompanyProfileRepository::list`） | rust-accepted | 真库 tenant-isolation 单测 + live HTTP round-trip（CI 见 rust-parity-matrix 惯例，本地真库手测） | keep | P3-2 | 路由名从 `/api/company/profiles` 改为 `/api/profiles`（与既有 `/api/research/sessions` 等新命名对齐）。 |
| Company profile | `GET /api/company/profile` | `GET /api/profiles/:ticker`（`echo-db::CompanyProfileRepository::get`） | rust-accepted | 同上 | keep | P3-2 | 详情含 bull/bear/monitors/falsifiers 数组 + 估值带；`profile_md` 字段保留（Rust 侧尚未生成，只读写既有值）。 |
| Delete company profile | `DELETE /api/company/profile` | `DELETE /api/profiles/:ticker`（`echo-db::CompanyProfileRepository::delete`） | rust-accepted | 同上 | keep | P3-2 | 同上。写路径新增 `PUT /api/profiles/:ticker`（原 TS 版无对应端点，供手动建档/编辑；自动从研究会话沉淀仍 pending，见下一行）。Web 编辑页已接（`echo-web::profiles::ProfilesPage`，真库端到端验证：PUT 后 `company_profiles.thesis` 真实落值）。 |
| Auto-populate profile from research | — | — | pending | — | keep | P3-2 remainder | 每轮研究自动沉淀 thesis/bull/bear 到档案——需要先定语义（哪些字段从答案抽取、抽取规则），产品判断，未做。当前只有手动编辑 API。 |
| Company review | `GET /api/company/review` | — | pending | — | keep | Phase 3–4 | 画像 review/scorecard 未迁移。 |
| Research scorecard | `GET /api/research/scorecard` | — | pending | — | keep | Phase 3–4 | 研究质量/资产 scorecard 未迁移。 |
| Research conversations | `POST /api/ask[/stream]` 带 `session_id` | `ResearchPorts::load_prior_turns` + `persist_outcome` | rust-accepted | application 单测 + 真库端到端（同 session 两轮落成同一行，turn_count/thread_json 累加）| keep | P3-4 | 无独立 conversation 列表端点，续问同一 `research_sessions` 行即"会话"；历史只喂 prompt 做代词/实体承接，不进 `FactsRegistry`。 |
| List research sessions | `GET /api/research/sessions` | `ResearchSessionRepository::list` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 列表、读取、删除、清空基础契约已存在。 |
| Clear research sessions | `DELETE /api/research/sessions` | `ResearchSessionRepository::clear` | rust-accepted | repository/API tests | keep | #43 | 同上。 |
| Get research session | `GET /api/research/sessions/:id` | `ResearchSessionRepository::get` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 不等价多轮 conversation。 |
| Delete research session | `DELETE /api/research/sessions/:id` | `ResearchSessionRepository::delete` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 同上。 |
| Compare research (双主体对比) | `POST /api/compare` | `ResearchService::compare` + `echo-web::compare::ComparePage` | rust-accepted | application 单测 + 真库/真 FMP/真模型端到端（AAPL vs MSFT，双腿 0 hard fail，Web 双栏渲染实测）| keep | P3-1 | 架构判断已定：分别验证不合并 registry；不落库、不支持多轮；Web 对比视图已接。已知 `fact_guard.rs` 货币标签窗口在两数字紧邻时可能误吞邻居标签（预置代码限制，非本次引入）。 |

## 4. Web page parity

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Login/register | `/login` | `echo-web::LoginPage` | rust-accepted | Rust WebDriver E2E currently ignored | keep | #43 | 基础登录、注册可用；需解除 E2E ignore。 |
| Research | `/`, `/research` | `ResearchPage` | skeleton | component tests absent; E2E ignored; Web 手动浏览器验证 | keep | Phase 4 | 已接类型化 SSE：阶段反馈、打字机 delta、护栏徽标、取消与原地重试；仍缺来源卡、会话历史继续及深链接（P1 后续切片）。 |
| Watch list | `/watch` | `WatchPage` + `RulesDeskSection` | done | browser round-trip (create/list/delete rule against dev DB) | keep | P4-3 | 自选增删 + 监控规则创建/删除表单 + 台面聚合 + 近期触发列表，均已接线真实 API。 |
| Watch rules | `/api/watch/rules` (CRUD) | `WatchRuleService` + `WatchRulesRepository` | done | curl + browser round-trip against dev DB | keep | P4-3 | 规则种类：price/fundamental（既有）+ valuation_percentile_*/event_earnings（新增）；创建前校验 ticker 已核实建档。 |
| Stock detail | `/watch/:ticker` | — | pending | — | keep | Phase 4 | 无独立详情页；当前台面卡片已覆盖行情/规则/触发聚合，详情页（引用证据等）仍未做。 |
| Portfolio | `/portfolio` | `PortfolioPage` | skeleton | component tests absent | keep | Phase 4 | 基础 CRUD；缺实时市值、盈亏、风险、复盘、历史曲线。 |
| Settings | `/settings` | `SettingsPage`, notification bell | skeleton | component tests absent | keep | Phase 4 | 仅偏好；缺邀请、反馈、导出、画像等设置能力。 |
| Membership | `/membership` | — | product-decide | — | product-decide | Product / ADR | 计费/会员是否继续属于产品范围未裁决。 |
| Offline/PWA | manifest, service worker, icons | — | product-decide | — | product-decide | Product / ADR | 旧 PWA 已删除；需决定恢复或正式退役。 |

## 5. Worker job parity

All nine schedules are defined and dispatch through a shared `try_claim`/`record_run` lease (P4-1，migration
0012，真库端到端验证过抢占/释放/过期重抢）——分布式重复执行问题已解决，不再是各行 skeleton 的共同成因。
仍标 `skeleton` 的行是各自剩余的具体缺口（见 Notes），非"无 lease"。

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Premarket digest | `echo-premarket-digest` | `JobKind::PremarketDigest` | skeleton | schedule/activity unit tests + live digest 测试（P4-2） | keep | Phase 5 | lease 已接（P4-1）；正文已改真实持仓异动聚合（P4-2）；`GET /api/events/digest` 独立端点仍缺，只经站内通知/邮件镜像触达。 |
| After-hours digest | `echo-afterhours-digest` | `JobKind::AfterhoursDigest` | skeleton | schedule/activity unit tests + live digest 测试（P4-2） | keep | Phase 5 | 同上。 |
| Market refresh | `echo-market-refresh` | `JobKind::MarketRefresh` | skeleton | schedule/activity unit tests | keep | Phase 5 | lease 已接；quote 可刷新；`tracked_tickers` 与 FORCE RLS 后台权限仍需验证。 |
| Portfolio snapshot | `echo-portfolio-snapshot` | `JobKind::PortfolioSnapshot` | skeleton | schedule/activity unit tests | keep | Phase 5 | lease 已接；会写快照；缺读模型闭环（`GET /api/portfolio/snapshots` 仍 pending）与并发安全验证。 |
| Falsifier check | `echo-falsifier-check` | `JobKind::FalsifierCheck` | skeleton | schedule/activity unit tests + live 测试（P4-2） | keep | Phase 5 | lease 已接；规则管理 API/UI 已补齐（`POST/GET/DELETE /api/watch/rules` + Web `RulesDeskSection`，P4-3）；仍缺该 job 自身的失败重试/告警可观测性验证。 |
| Earnings review | `echo-earnings-review` | `JobKind::EarningsReview` | skeleton | schedule/activity unit tests + live 测试（P4-2） | keep | Phase 5 | lease 已接；财务/日历数据面已迁（filings+calendar，P2）；仍缺该 job 自身端到端告警链验证。 |
| Position alert | `echo-position-alert` | `JobKind::PositionAlert` | skeleton | schedule/activity unit tests | keep | Phase 5 | lease 已接；可计算基础阈值；需真实 RLS、重试测试。 |
| Review reminder | `echo-review-reminder` | `JobKind::ReviewReminder` | skeleton | schedule/activity unit tests | keep | Phase 5 | lease 已接；提醒活动存在，产品复盘 UI/API（`GET /api/portfolio/review`）不完整。 |
| PostgreSQL backup | `echo-postgres-backup` | `JobKind::PostgresBackup` | skeleton | activity unit tests | keep | Phase 5 | lease 已接；当前仅 `pg_dump` 至本地目录；未读 `ECHO_BACKUP_BUCKET`、未上传 S3——P5 首个切片。 |

## 6. Data adapter parity

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Finnhub quote | `finnhubQuoteAdapter` | `echo-data::QuoteService` | rust-accepted | quote/router/quality tests | keep | #43 | Decimal 映射、质量门、熔断、写库已存在。 |
| Yahoo quote | `yahooQuoteAdapter` | `echo-data::QuoteService` | rust-accepted | quote/router/quality tests | keep | #43 | 同上；商用模式必须遵守授权门。 |
| PostgreSQL quote read | `postgresQuoteAdapter` | `MarketRepository` | replaced | repository tests | keep | #43 | 已由 Rust DB repository 承接。 |
| FMP fundamentals | `fmpFundamentalsAdapter` | `echo-data::FundamentalsService` | rust-accepted | fixture + commercial/HK gates | keep | Phase 2 | US-only stable 三表；商用模式拒绝；`ResearchPorts::load_fundamentals` 已接线。 |
| FMP company search | `fmpSearchAdapter` | `echo-data::FmpSearchService` | rust-accepted | normalize/filter + resolve ports | keep | Phase 2 | resolve/verify 已消费；研究链路建档 ensure 仍待接。 |
| Company resolve/verify | `companyResolution` | `CompanyResolveService` + `/api/companies/{resolve,verify}` + ask ensure | rust-accepted | alias/identity + research-entry tests | keep | Phase 2 | `/api/ask` 验证后 `ensure`；仍无 LLM 兜底。 |
| Tavily evidence search | `tavilySearchAdapter` | — | pending | — | keep | Phase 2 | `TAVILY_API_KEY` 已从 `echo-config` 移除（无 consumer、额度已耗尽）；P2 选定证据供应商时按届时选型与 consumer 同 PR 重新加入。 |
| Finnhub earnings calendar | `finnhubCalendarAdapter` | `echo-data::CalendarService` | rust-accepted | live Finnhub + DB round-trip (AAPL) | keep | Phase 2 | 24h 陈旧窗口回源；商用模式拒绝；`ResearchPorts::load_earnings_calendar` 已接线到 web `EarningsBadge`。 |
| Finnhub peers | `finnhubPeersAdapter` | `echo-data::PeerService`（FMP `stock-peers` + `ratios-ttm`/`key-metrics-ttm`）+ `echo-db::PeersRepository` | rust-accepted | echo-data 单测（分位/排除自身/JSON 往返）+ live FMP+DB 端到端（AAPL：PE 4 家 p25 23.6x/中位 26.2x、EV-Sales 5 家；RIVN：单点位诚实拒绝成分位，不足两点不成锚点） | keep | P2-3 remainder | 供应商换成 FMP（非 Finnhub）；美股专属（免费档三表限定，见 fundamentals.rs 同一授权口径）；单个可比失败不拖垮整批，`partial` 标记不完整；24h 缓存已验证命中。 |
| HK ADR/calendar | `hkAdrCalendarAdapter` | — | pending | — | keep | Phase 2 | 港股/ADR 日期与映射链缺失。 |
| PostgreSQL calendar | `postgresCalendarAdapter` | `echo-db::CalendarRepository` | rust-accepted | — | keep | Phase 2–3 | `earnings_calendar` 读写已接（无 RLS，公共参考数据）。 |
| PostgreSQL filings | `postgresFilingsAdapter` | `echo-data::FilingsService`（Finnhub `/stock/filings`）+ `echo-db::FilingsRepository`（新表 `company_filings`，migration 0011） | rust-accepted | echo-data 单测（日期解析/表单白名单）+ live Finnhub+DB 端到端（AAPL 8 条实质公告入库、答案引用 form/日期/URL；0700.HK 港股正确空表退出） | keep | P2 remainder | 仅实质性公告表单（10-K/10-Q/8-K/proxy/registration 等），排除内部人交易表单 3/4/5/144（另一类事实，噪音大）；美股专属（EDGAR 本身不覆盖港股/A股）；24h 缓存已验证命中；`ResearchPorts::load_recent_filings`→`answer_prompt`+`AskResponse.filings` 已接线。 |
| PostgreSQL fundamentals | `postgresFundamentalsAdapter` | — | pending | — | keep | Phase 2–3 | 财务事实、期间、口径、来源、双时间语义未迁移。 |

## 7. DB repositories and tables

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth/users/sessions/invites | `authRepository` | `AuthRepository`, `AuthService` | rust-accepted | auth tests + CI live NOBYPASSRLS | keep | #43 / #45 | CI 用 `echo_app` 跑 register/session round-trip。 |
| Companies | `companyRepository` | `CompanyRepository::{search,ensure,by_ticker}` | rust-accepted | repository/API + resolve | keep | #43 / Phase 2 | search/ensure 已有；`/api/ask` 验证成功后会 ensure。 |
| Market snapshots | quote repositories | `MarketRepository`, `QuoteService` | rust-accepted | market/quote tests | keep | #43 | 需要真实供应商 contract/canary。 |
| Watchlist | `watchlistRepository` | `WatchlistRepository` | skeleton | repository/API + CI live | keep | #43 / #45 | 基础 track/list/untrack；不能替代 rules/desk。 |
| Portfolio positions | `portfolioRepository` | `PortfolioRepository` | skeleton | repository/API + CI live | keep | #43 / #45 | CRUD 已有；enriched/review/snapshot 仍缺。 |
| Preferences | `userPreferencesRepository` | `PreferencesRepository` | rust-accepted | repository/API + CI live | keep | #43 / #45 | 通知偏好已落地。 |
| Notifications | `notificationsRepository` | `NotificationsRepository` | rust-accepted | repository/API tests | keep | #43 | 去重咽喉存在。 |
| Research sessions | `researchSessionsRepository` | `ResearchSessionRepository` | rust-accepted | repository/API + CI live + 真库端到端（多轮续问同一行）| keep | #43 / #45 / P3-4 | 多轮续问同一行已接线（`session_id` 归位 + `turn_count`/`thread_json` 累加）；facts/guard 版本链仍缺。 |
| Scheduler state | scheduler repository | `SchedulerStateRepository` | skeleton | schedule tests + CI live + `try_claim`/`record_run` 真库端到端（见 P4-1） | keep | #45 / P4-1 | 有运行记录 + claim/lease（`locked_until`/`locked_by`，migration 0012）；失败游标和 status API 仍缺。 |
| Operations/rules/snapshots | worker repositories | `OperationsRepository` | skeleton | activity tests | keep | #43 | Worker 内部读取存在；公开 API 与后台 RLS 仍不足。 |
| LLM audit | `llmAuditRepository` | partial DB implementation | skeleton | unit tests | keep | Phase 1, 3 | stream final 状态和全链路追溯未闭环。 |
| Data-source fields/canary | canary repositories | — | pending | — | keep | Phase 2 | 缺新鲜度、授权元数据、供应商 canary repository。 |
| Feedback | `feedbackRepository` | — | pending | — | keep | Phase 3 | 无 Rust 写入边界。 |
| Documents | `documentRepository` | — | pending | — | keep | Phase 3 | 无安全的上传、解析、存储边界。 |
| Financial/history/HK facts | financials / HK repositories | — | pending | — | keep | Phase 2–3 | 缺 bitemporal 财务、估值及 HK facts repository。 |
| Historical valuation percentile | `historicalValuation` (F-5) | `echo-data::HistoricalValuationService` + `echo-db::HistoricalValuationRepository` | rust-accepted | live FMP+Yahoo+DB round-trip (AAPL 分位 98.28%，0700.HK 诚实拒绝) | keep | Phase 2 | 美股专属（港股 filing EPS 深度不足，见 docs/PLAN.md 勘察结论）；`filingDate` 截止避免未来数据反推历史；`ResearchPorts::load_historical_valuation`→`answer_prompt`+`fact_guard` 已接线；`comp_peers`（同业）见上方 Finnhub peers 行，已接线。 |
| Peers/evidence | peers/evidence repos | `echo-db::PeersRepository` + `echo-db::FilingsRepository`（同业、filings 已接，见上方对应行） | pending | — | keep | Phase 2–3 | 网页证据（Tavily 额度已耗尽，供应商未定）仍无 Rust 读写边界；同业比较、公司公告已迁移。 |
| Profiles/research snapshots/memory | profile/snapshot/memory repos | — | pending | — | keep | Phase 3–4 | 未迁移。 |
| Team/audit/billing | team/audit/billing repositories | — | pending | — | keep | Phase 3 / product | P5 表仍存在；是否继续使用需确认。 |
| Rate limits | `rate_limit_buckets` | `echo-db::RateLimitRepository` + `echo-api` `/api/ask`、`/api/ask/stream` 限流中间件 | rust-accepted | echo-db 单测（含真库 ignored 用例）+ 真库端到端手测（3 次放行第 4 次 429，见 P2-4） | keep | P2-4 | 按用户 + 60s 窗口共享桶；`ECHO_ASK_RATE_LIMIT_PER_MINUTE` 可调；限流查询出错放行。 |
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
| Multi-worker safety | ECS desired count 2–8 | `SchedulerStateRepository::try_claim`（原子 `UPDATE ... WHERE` 抢占） | rust-accepted | `live_scheduler_lease_claim_round_trip`（真库：第二实例抢不到、`record_run` 释放锁、过期租约可被重新抢占） | keep | P4-1 | 15 分钟租约兜底崩溃恢复；ECS desired count 仍需 Phase 5 部署验证多实例真实场景。 |
| Observability | OTEL Terraform config | tracing logs only | blocked | — | keep | Phase 5 | OTLP exporter 未安装。 |
| Research/API rate limiting | WAF/table claim | `echo-db::RateLimitRepository` + ask/ask_stream 中间件 | rust-accepted | 见上方 Rate limits 行 | keep | P2-4 | 见上方 Rate limits 行。 |
| API safety/readiness | production boundary | Origin 校验 + readiness + body 上限 + 限流中间件 + 优雅停机 | rust-accepted | API 单测 + 真库端到端手测 + SIGTERM 真实进程验证 | keep | P2-4 / P5 | `enforce_origin`（缺 Origin 放行、Origin 存在必须在白名单）+ `/ready`（真连 DB）+ `DefaultBodyLimit::max(512KiB)`；`echo-api`/`echo-worker` 均已接 SIGTERM/Ctrl+C 优雅停机（`axum::serve().with_graceful_shutdown`；worker 用 `select!` 只在空闲等待时参与，不打断进行中的活动/租约），真实发送 SIGTERM 验证过日志与进程干净退出。 |
| Build and IaC gates | release CI | `cargo xtask` + live DB (#45) | skeleton | Docker/IaC CI still missing | keep | #45 / Phase 5–6 | 活库进 CI；仍缺 Docker/TF gates。 |
| Production recovery exercise | runbook | — | blocked | no restore/failover rehearsal | keep | Phase 5–6 | 需备份恢复与故障演练。 |

## 10. Summary counts by status

| Status | Count |
| --- | ---: |
| rust-accepted | 34 |
| skeleton | 26 |
| pending | 35 |
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
| 2026-07-22 | 校正两处滞后行：`GET /api/companies/resolve`（P1-3 resolve-first 已接线，pending→rust-accepted）、`POST /api/ask`（P2/P3-4 取数+hard-fail+多轮隔离已完整落地，非 fake ports，skeleton→rust-accepted）。P5 启动前置核对。 |
