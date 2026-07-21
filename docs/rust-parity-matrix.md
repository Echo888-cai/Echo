# Echo Rust 功能平价矩阵

更新日期：2026-07-21  
行为基线：`eb3b766`（`dc4b75c^`）  
结构基线：`dc4b75c`（PR #43 Rust-only）

## 目的

本表是“功能平价是否完成”的唯一底账。结构迁移（Cargo-only）已完成，不等于下列能力已验收。

更新规则：

1. 每个旧能力必须落在本表；未决定项不得标 `rust-accepted`。
2. 状态变更必须附带测试证据或 ADR / 产品决定。
3. 路径可以替换，但能力必须标为：Rust 已验收 / 被统一用例替代 / 产品退役。
4. “删掉旧文件”本身不算完成迁移。

## 状态图例

| Status | 含义 |
| --- | --- |
| `rust-accepted` | Rust 等价实现且有自动测试 |
| `skeleton` | 有代码竖切，但缺关键行为/测试 |
| `pending` | 尚未等价迁移 |
| `replaced` | 被新契约/用例替代，需迁移说明 |
| `retire-candidate` | 建议退役，待 ADR |
| `product-decide` | 保留/替代/退役尚未产品拍板 |
| `blocked` | 被依赖或决策卡住 |

## 1. HTTP / API

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Health | `GET /healthz` | `GET /health`, `GET /healthz` | replaced | API | keep | #43 | 增加 `/health` 别名；尚无 readiness |
| Auth login/register/logout/me | `/api/auth/*` | 同路径 | rust-accepted | API auth | keep | #43 | cookie session + invite |
| Auth invite | `POST /api/auth/invite` | 同路径 | rust-accepted | API | keep | #43 | owner-only |
| Research ask | `POST /api/ask`, `/api/chat` | `POST /api/ask` → `ResearchService` | skeleton | API + application fake ports | keep | parity-foundation | 编排已收口 application；完整取数/hard-fail/客户端事实隔离未完 |
| Research stream | ask SSE | `POST /api/ask/stream` | skeleton | partial | keep | | 仅文本 chunk；缺 meta/guard/final/persist |
| Company search | `GET /api/companies/search` | 同路径 | rust-accepted | API | keep | #43 | |
| Company verify | `GET /api/companies/verify` | — | pending | — | keep | | 任意 ticker 研究前置 |
| Company resolve | `GET /api/companies/resolve` | — | pending | — | keep | | |
| Preferences | `GET/PATCH /api/preferences` | 同路径 | rust-accepted | API | keep | #43 | |
| Feedback | `POST /api/feedback` | — | pending | — | keep | | |
| Parse document | `POST /api/parse-document` | — | pending | — | keep | | |
| Discover | `POST /api/discover` | — | product-decide | — | product-decide | | 旧实现常诚实降级 |
| Report generate | `POST /api/report/generate` | — | pending | — | keep | | 深度报告 |
| Notifications list/unread/read | `/api/notifications*` | 同路径 | rust-accepted | API | keep | #43 | |
| Notification test | `POST /api/notifications/test` | — | pending | — | keep | | |
| Scheduler status | `GET /api/scheduler/status` | worker 内部 | skeleton | schedule unit | keep | | 无 HTTP |
| System status/canary | `GET /api/status` | — | pending | — | keep | | |
| Watch list/track/untrack | watch CRUD | `/api/watch/list|track|untrack` | skeleton | API | keep | #43 | 路径微调 |
| Watch desk/stock | `/api/watch/desk`, `/stock` | — | pending | — | keep | | |
| Events digest | `GET /api/events/digest` | — | pending | — | keep | | |
| Portfolio CRUD | `/api/portfolio` | 同路径 | rust-accepted | API | keep | #43 | Decimal 保留 |
| Portfolio review | `/api/portfolio/review` | — | pending | — | keep | | |
| Portfolio snapshots | `/api/portfolio/snapshots` | worker 写部分 | skeleton | worker | keep | | 缺读 API |
| Company profiles | `/api/company/profile*` | — | pending | — | keep | | |
| Company review / scorecard | `/api/company/review`, `/api/research/scorecard` | — | pending | — | keep | | |
| Research conversations | `/api/research/conversations` | — | pending | — | keep | | |
| Research sessions | `/api/research/sessions*` | 同路径 | rust-accepted | API | keep | #43 | 缺多轮续写 |
| HK financials | `/api/hk-financials*` | — | pending | — | keep | | |
| Membership | tRPC `membership.overview` | — | product-decide | — | product-decide | | |
| Export research | tRPC `exports.research` | — | pending | — | keep | | |
| Chat alias | `POST /api/chat` | — | retire-candidate | — | product-decide | | 可 ADR 退役为 ask |

## 2. Web 页面

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Login/register | `/login` | Leptos auth | skeleton | e2e ignored | keep | #43 | |
| Research chat | `/`, `/research` | Leptos research | skeleton | e2e ignored | keep | | 无 SSE/历史深链/证据卡 |
| Watch desk | `/watch` | 基础列表 | skeleton | e2e ignored | keep | | |
| Stock detail | `/watch/:ticker` | — | pending | — | keep | | |
| Portfolio | `/portfolio` | 基础 CRUD | skeleton | e2e ignored | keep | | 无实时盈亏/复盘曲线 |
| Settings | `/settings` | 通知偏好 | skeleton | e2e ignored | keep | | |
| Membership | `/membership` | — | product-decide | — | product-decide | | |
| PWA | manifest/sw/icon | — | product-decide | — | product-decide | | 恢复或 ADR 退役 |

## 3. Worker / 调度

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 9 cron jobs | Temporal schedules | `echo-worker` 同名活动 | skeleton | schedule unit | keep | #43 | 缺 claim/lease |
| Premarket/afterhours digest | activities | 有实现 | skeleton | — | keep | | |
| Market refresh | activity | quote refresh | skeleton | — | keep | | |
| Portfolio snapshot | activity | 写库部分 | skeleton | — | keep | | |
| Falsifier / earnings / alerts / review | activities | 有实现 | skeleton | — | keep | | |
| Postgres backup | activity | 本地目录 | pending | — | keep | | 未读 S3 bucket；Fargate 盘临时 |
| Deep research workflow | Temporal on-demand | — | pending | — | keep | | |
| Filing ingestion workflow | Temporal + HKEX pipeline | — | pending | — | keep | | |

## 4. 数据适配器

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Finnhub quote | adapter | `echo-data` quote | rust-accepted | quote tests | keep | #43 | 商用授权门保留 |
| Yahoo quote fallback | adapter | `echo-data` | rust-accepted | quote tests | keep | #43 | 非商用 |
| Postgres cached quote | adapter | market repo | rust-accepted | — | keep | | |
| FMP fundamentals | adapter | 配置有、无消费 | pending | — | keep | | |
| FMP search/resolve | adapter | — | pending | — | keep | | |
| Finnhub calendar | adapter | — | pending | — | keep | | |
| Finnhub peers | adapter | — | pending | — | keep | | |
| HK ADR calendar | adapter | — | product-decide | — | product-decide | | 覆盖面有限 |
| Tavily web evidence | adapter | — | pending | — | keep | | |
| Postgres fundamentals/filings/calendar | adapters | — | pending | — | keep | | |
| HKEX filings/buybacks | worker pipeline | — | pending | — | keep | | |

## 5. DB / Repository

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth repos | TS | `repositories/auth.rs` | rust-accepted | CI ignored→opt-in live | keep | ci-postgres | CI 用 `echo_app` NOBYPASSRLS 跑 |
| Workspace watch/portfolio/prefs/sessions/notifications | TS | `workspace.rs` | skeleton | ignored RLS | keep | | |
| Operations / LLM audit / scheduler | TS | `operations.rs` | skeleton | ignored | keep | | |
| Company profiles / snapshots / memory | TS | 表在、仓储缺 | pending | — | keep | | |
| Documents / feedback | TS | 表在、仓储缺 | pending | — | keep | | |
| Evidence / peers / calendar / buybacks / insider | TS | 表在、仓储缺 | pending | — | keep | | |
| Team / billing / audit | TS | 表在、仓储缺 | product-decide | — | product-decide | | P5 |
| Rate limit buckets | 表 + app limiter | 仅表 | skeleton | — | keep | | Rust API 未接 limiter |
| Migrations 0001-0010 | drizzle/sql | `migrations/` | rust-accepted | checksum fixture | keep | | 不可回写；见 fixtures |

## 6. QA / 回归

| Capability | Old surface | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Static intent corpus | `corpus.ts` 275 | `docs/qa/fixtures/intent-routing-corpus.json` | skeleton | `intent_routing_corpus` | keep | parity-foundation | intent 已跑；其余字段 deferred |
| Live probes | `live.ts` 15 | `live-research-probes.json` | pending | catalog only | keep | | 待声明式门禁 |
| Historical baseline | `agent-qa-baseline.json` | fixtures 保留 | rust-accepted | — | keep | | 不作静默删 case |
| Domain unit tests | packages/domain | `echo-domain` | rust-accepted | cargo test | keep | | |
| Browser e2e | Playwright | `echo-e2e` | skeleton | ignored | keep | | |

## 7. 生产 / 基础设施（P0 阻断）

| Capability | Old surface / intent | Rust landing | Status | Tests | Product decision | Owner/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Deploy echo-web | 旧 web | Dockerfile 有、TF 无 | pending | — | keep | | |
| HTTPS / ACM / domain | 生产必需 | ALB 仅 80/8080 | pending | — | keep | | |
| Secrets for model/data | 旧 env | TF 未注入 | pending | — | keep | | |
| Worker single-flight lease | Temporal 语义 | 无 claim | pending | — | keep | | 扩容前 desired=1 |
| S3 backup/restore | 备份意图 | 本地写 | pending | — | keep | | |
| OTLP observability | OTEL 配置 | 仅 tracing 日志 | pending | — | keep | | 无效配置应收口或删除 |
| Readiness probe | — | 仅 liveness | pending | — | keep | | |
| App rate limit | buckets + limiter | 无应用限流 | pending | — | keep | | |
| Docker/TF CI gates | 部分 | 缺 | pending | — | keep | | |

## 8. 汇总（约计）

| Status | Count (approx) |
| --- | --- |
| rust-accepted | 18 |
| skeleton | 22 |
| pending | 35 |
| replaced | 2 |
| retire-candidate | 1 |
| product-decide | 8 |

**结论：** 结构迁移完成；功能平价未完成。下一刀按交接书 PR 顺序推进：活库 CI → typed stream → 公司解析与 fundamentals → … → 生产闭环。

## 变更记录

| Date | Change |
| --- | --- |
| 2026-07-21 | 初版：从 `eb3b766` 提取；恢复 QA fixtures；研究编排开始收口 application |
