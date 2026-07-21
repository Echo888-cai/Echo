# Echo Rust 重构续作交接书

更新日期：2026-07-21

## 0. 给接手 AI 的一句话结论

仓库的“运行时语言切换”已经完成：`main` 已经是 Cargo-only，TypeScript、JavaScript 和 Python 运行栈已删除；但“旧产品能力在 Rust 中完整等价实现”尚未完成。当前更准确的状态是：**Rust 单栈骨架和一条基础研究竖切可运行，完整研究数据链、旧 API/UI 平价、关键集成测试和生产部署闭环仍需继续实现。**

不要继续使用旧的 `rust-core-io-wiring` 分支。PR #43 已 squash 合并为 `main` 的 `dc4b75c`，该分支与 `origin/main` 文件树完全一致、提交历史不同。续作应执行：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/rust-parity-foundation
```

需要追溯被删除能力时，以 `dc4b75c^`（提交 `eb3b766`）为迁移前行为基线，只读取历史实现，不恢复 Node/React/Python 运行时。

## 1. 已确认的当前状态

### 1.1 Git 与语言

- Rust-only 重构已经通过 PR #43 合并到默认分支 `main`。
- 当前 GitHub Languages API 已显示主语言为 Rust；统计为 Rust 382,582 bytes，另有 HCL、CSS、PL/pgSQL、Dockerfile 和 HTML。
- 当前跟踪文件中有 37 个 `.rs`，没有 `.ts`、`.tsx`、`.js`、`.jsx` 或 `.py`。
- 用户截图里的 TypeScript 53.1% / JavaScript 24.0% / Rust 7.8% 是 #43 合并前或 Linguist 尚未刷新时的旧统计，不代表当前 `main`。

### 1.2 已真实跑过的门禁

2026-07-21 在 Rust 1.85.0 上执行 `cargo xtask check` 成功：

- `cargo fmt --all -- --check`：通过。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `cargo test --workspace`：81 个测试通过。
- Leptos/WASM `trunk build --release`：通过。
- 仍有 4 个关键测试被忽略：API 活库认证、DB 调度状态、DB workspace/RLS、真实浏览器 E2E。

因此当前可以证明“编译、静态检查、纯单测、WASM 构建通过”，不能据此证明“真实 PostgreSQL、多租户、浏览器、外部数据、生产部署全部通过”。

### 1.3 已实现并可复用的 Rust 基础

| 区域 | 当前可复用实现 | 结论 |
| --- | --- | --- |
| 工程 | Cargo workspace、统一依赖、Rust 1.85、xtask、CI 基本门禁 | 已完成基础化 |
| 金融内核 | `finance-core` 的 Decimal 金额/比率/盈亏/估值 | 核心可用 |
| 领域规则 | 意图、估值、财务衍生、数字事实护栏 | 核心可用，覆盖面仍需对照旧 QA |
| 模型网关 | DeepSeek/OpenAI-compatible 非流式与 SSE 解帧、基础审计 | 部分完成 |
| 认证 | scrypt 密码、邀请注册、opaque cookie session、基础用户角色 | 基础可用 |
| API | axum 健康检查、研究、认证、基础自选/持仓/偏好/通知/历史 | 基础竖切可用 |
| DB | sqlx 连接、编译迁移、租户事务、部分 workspace/operations repository | 部分完成 |
| 行情 | Finnhub/Yahoo quote、Decimal 映射、质量门、进程内熔断、写库 | 基础 quote 可用 |
| Worker | 9 个 cron 定义、到期判定、状态表、活动函数 | 有实现，但生产并发和备份有阻断项 |
| Web | Leptos 登录、研究、基础自选、基础持仓、通知偏好 | 基础页面可用 |
| 容器 | API、Worker、Web 三个 Dockerfile | 能构建不等于已部署 |

## 2. 为什么还不能称为“完整 Rust 重构”

### 2.1 研究主链仍是骨架

- `echo-application/src/research.rs` 明确自称“骨架”，目前主要 re-export 领域意图，没有统一的 `ResearchService` 用例编排。
- 关键取数、估值、模型、护栏和落库仍集中在 `echo-api/src/lib.rs`，API 边界过重，application 层没有真正接管用例。
- Web 发送 `AskRequest::minimal`，不会提供财务字段；服务端当前只会自动补行情快照，不会从 DB 或外部源自动补完整财报、同业、网页证据、公告和业绩日历。因此真实 Web 研究通常只有价格/PE 等少量事实。
- `FMP_API_KEY`、`TAVILY_API_KEY` 已进入配置结构，但当前 Rust 数据层没有实际消费相应 fundamentals/search/evidence 适配器。
- 请求仍允许客户端直接提交财务数字；正式研究链不应把未验证的客户端数字当作可信事实。
- 对比意图仍会被识别，但当前请求和事实组装只有一个 ticker，没有已隔离的第二家公司完整事实腿。

### 2.2 流式链路没有闭环

- `/api/ask/stream` 只发送纯文本 chunk，没有类型化的 `meta/delta/final/guard/error` 事件。
- 流完成后没有执行数字护栏终检，也没有保存完整研究会话；源码注释已经明确把这两项标为下一段 seam。
- Leptos 研究页调用的是非流式 `/api/ask`，没有消费 SSE，所以用户实际上看不到已实现的流式能力。
- 非流式返回会把带 hard fail 的生成文本连同护栏结果一起交给客户端；需要定义隔离、重试或拒绝策略，不能只做标记。
- 当前每次研究保存为独立 turn，Web 不加载历史会话，也没有可靠的多轮上下文、conversation continuation 和取消传播。

### 2.3 旧产品/API 能力只迁移了一部分

迁移前 Rust+旧栈基线中有 44 个 REST 契约路由，当前 axum 只覆盖约 20 个路由。下列能力未等价迁移，或只剩表/Worker 内部逻辑：

- 公司 verify/resolve 与任意名称到 ticker 的验证闭环。
- `/api/status` 与供应商 canary/数据新鲜度状态。
- feedback、document parse、research export。
- chat/discover/report generate 的独立契约或等价统一研究模式。
- events digest、HK financial ingestion/read。
- notification test、scheduler status。
- watch desk、stock detail、watch rules 管理。
- portfolio enriched positions、review、historical snapshots。
- company profiles/list/review/delete、research scorecard。
- research conversations、画像编辑、研究记忆。
- onboarding progress、团队、审计、计费/会员等 P5 能力。

不能机械地要求路径永远保持不变，但每个旧能力必须在平价矩阵中被标成以下三者之一：

1. Rust 等价实现并有测试；
2. 被新统一用例替代并有迁移说明；
3. 经产品决定明确退役并有 ADR。

“删掉旧文件”本身不能算该能力已完成迁移。

### 2.4 Web 目前是基础版，不是旧体验平价

- 没有 SSE 流式展示、取消、重试和阶段反馈。
- 没有研究历史加载/继续、深链接、前进后退状态同步。
- 回答按普通 `<p>` 展示，没有安全 Markdown、引用/证据卡、来源跳转和复杂决策面板。
- 自选只有增删列表，没有 desk、股票详情、规则与事件。
- 持仓只有基础 CRUD，没有实时市值、盈亏、风险检查、组合复盘和历史曲线。
- 设置只有通知偏好，没有邀请管理、反馈、导出、画像/会员等旧页面能力。
- 旧 PWA manifest、service worker、icon 和离线策略已删除，尚未明确“恢复还是正式退役”。
- `echo-web` 没有组件测试；当前浏览器 E2E 只有一个 ignored 流程。

### 2.5 数据库和测试覆盖不足

- 旧栈有大量 repository；当前 Rust 只实现 auth、workspace、operations、market、scheduler 和 LLM audit 的一部分。
- `documents`、`feedback`、`company_profiles`、`research_snapshots`、`web_evidence`、`comp_peers`、`earnings_calendar`、`watch_rules`、team/billing/audit/research memory 等表缺少完整 Rust 读写边界。
- CI 的 PostgreSQL service 只执行迁移；3 个活库/RLS 集成测试仍 `#[ignore]`，不会自动验证真实 SQL。
- 迁移前的 agent QA 语料和 live QA 门禁被删除，当前 81 个测试不能替代原先的研究质量回归集。
- Worker 的全局 `tracked_tickers` 直接读取启用 FORCE RLS 的租户表，需要用受控的后台权限/函数或逐租户事务验证，不能依赖部署数据库用户碰巧拥有 BYPASSRLS。

### 2.6 生产部署存在 P0 阻断项

- Terraform 只创建 API 和 Worker ECS service，没有部署 `echo-web`，也没有同源 `/api` 路由。
- ALB 只有 HTTP 80/8080，没有 HTTPS listener、证书、域名和安全 cookie 的完整生产闭环。
- Terraform 没有把模型和数据供应商密钥注入 API/Worker；生产 API 会回 `unavailable`，Worker 也拿不到付费数据源。
- Terraform 设置了 `ECHO_BACKUP_BUCKET`，但 Worker 根本不读取该变量；备份只写本地相对目录。Fargate 本地盘是临时的，而且非 root 用户可能无权创建默认 `/backups`，当前“备份到 S3”没有发生。
- Worker service 默认 2 个实例并可扩到 8 个，但调度没有 claim/lease/advisory lock；多个实例可能同时执行同一 job。
- `echo-observability` 只输出 tracing 日志，没有安装 OTLP exporter；Terraform 注入的 OTEL endpoint/headers 当前不生效。
- PostgreSQL `rate_limit_buckets` 表仍在，但 Rust API 没有应用层 rate limiter；Terraform 描述“defense-in-depth alongside app limiter”与现实不符。
- API 缺少明确的 CSRF/Origin 防护、请求体上限、昂贵研究接口的配额门、readiness 检查和优雅停机验证。
- 没有 Docker build/smoke CI，也没有 Terraform fmt/validate/plan 门禁和生产恢复演练。

## 3. 完整实现路线图

所有阶段都必须在独立小 PR 中完成。每个 PR 都要更新平价矩阵、增加测试、跑全门禁；不得先堆一个无法审查的大重写。

### Phase 0：建立不可自欺的迁移底账

目标：先定义“完全”的含义，再继续写代码。

任务：

1. 从 `dc4b75c^` 提取旧 REST/tRPC 路由、页面、Worker job、repository、数据适配器和 QA 语料，创建 `docs/rust-parity-matrix.md`。
2. 每项记录：旧行为、Rust 落点、状态、测试、是否产品退役、负责人/PR。
3. 恢复旧 agent QA 语料为语言中立 JSON/YAML fixture，并由 Rust test runner 消费；不要恢复 TS runner。
4. 把当前 `docs/PLAN.md` 的“完成”状态改成“结构迁移完成 / 功能平价状态”，避免继续把骨架记成完成。
5. 固定现有 API JSON 快照与数据库迁移 checksum；已有 `0001`-`0010` 不回写，新变更只加 `0011+`。

验收：

- 每个旧能力都能在矩阵中找到，未决定项不能标完成。
- Rust QA runner 能运行恢复后的离线语料，并记录当前基线，不允许静默删 case。
- README、PLAN、架构文档对当前能力的描述与代码一致。

### Phase 1：把研究链真正收口到 application

目标：API 只做 HTTP，研究用例由 `echo-application` 统一编排。

任务：

1. 定义 `ResearchService`、`ResearchPorts` 和强类型 `ResearchFacts`；编排顺序固定为解析主体 → 取数 → 质量/授权门 → 衍生/估值 → 提示词 → 生成 → 护栏 → 持久化。
2. 把 `assemble_facts`、`db_fill`、prompt/model/guard/session save 从 `echo-api` 移入 application 用例。
3. 正式请求只接受问题、主体/会话和显示选项；客户端提供的事实只能进入显式 debug/test 边界，不能与可信供应商事实混用。
4. 增加 `CompareResearchFacts { primary, peer }`，两家公司使用隔离 registry；比较答案可以引用两边事实，但不能交叉污染。
5. 实现多轮 conversation：保存 user/assistant turn、主体解析结果、事实版本、来源与 guard；历史只能帮助代词承接，不能把旧数字注入新事实。
6. 定义 hard fail 策略：生成文本若硬失败，最多受控重试；仍失败则返回结构化事实和“生成内容未通过校验”，不得作为已验证答案展示。
7. 将 provider 配置从 `model_gateway` 的直接 `std::env` 读取迁入 `echo-config` 并显式注入。

验收：

- axum handler 不再直接组织领域/模型/DB 步骤。
- application 用例可用 fake ports 做无 IO 的成功、缺数、供应商失败、hard fail、比较、多轮测试。
- 任一研究响应都能追溯主体 ticker、facts as-of、provider、guard 和持久化结果。

### Phase 2：补齐证据优先的数据平面

目标：Web 只给问题和公司，也能生成有真实财报与证据的研究。

任务：

1. 实现公司解析链：规范 ticker → DB → 静态别名 → FMP/签约搜索 → 行情验证 → 可选模型候选；“验证成功后才建档”。
2. 实现 fundamentals 端口和 FMP/授权供应商适配器，写入 Decimal/bitemporal 财务事实；从 PostgreSQL 读取最近可用、口径匹配的事实。
3. 实现 filings/公告、Tavily/web evidence、earnings calendar、peers、historical valuation、buyback/insider 等仍在产品范围内的端口。
4. 每个字段携带 source、source URL、valid time、knowledge time、currency、unit、license 和 freshness。
5. 把 adapter 授权与 commercial mode 做成统一门禁；生产 commercial mode 必须至少有一个已授权源，否则启动或 readiness 明确失败。
6. 将熔断/限速/供应商 canary 做成可观察状态；为外部 HTTP 加 timeout、重试预算、并发上限和契约 fixture 测试。
7. 删除真正不用的配置项，保留的每个 key 必须有 production consumer 和测试。

验收：

- 空数据库中研究一个合法美股/港股代码，能够验证建档、取行情、取至少一组财务事实、记录来源并作答。
- 缺数保持 `None/未核到`，禁止跨公司、陈旧占位和零值回填。
- 商用模式不会调用未授权源，并有自动测试证明。

### Phase 3：补齐 DB repository、API 契约与安全边界

目标：迁移前保留的产品能力都有 Rust persistence + HTTP 边界。

任务：

1. 为平价矩阵中保留的 profiles、snapshots、rules、documents、feedback、evidence、peers、calendar、team、billing、audit、memory 等表实现 Rust repository。
2. 所有租户 repository 同时使用事务级 `set_config` 和显式 `user_id`；增加双租户正反向测试。
3. 为 Worker 设计最小后台权限：优先逐租户事务或窄 `SECURITY DEFINER` 函数，不让 API role 获得 BYPASSRLS。
4. 补齐或明确替代旧 44 个 REST 契约，以及旧 tRPC-only 的 export/onboarding 等能力。
5. 使用 Rust 类型生成 OpenAPI，不再维护手写/TS registry；CI 检查 schema drift。
6. 加入统一错误码、request id、JSON body 上限、超时、并发/速率限制、CSRF/Origin 防护和安全 header。
7. 将 `/healthz` 限定为 liveness，新增会检查 DB/必要配置的 readiness；不要让 ALB 把“能监听但完全不能研究”当健康。
8. 对 session、邀请、owner bootstrap、权限升级、删除终局、审计留痕做活库集成测试。

验收：

- 平价矩阵中所有保留 API 都有 contract test、授权测试和数据库测试。
- 两个用户无法通过 list/get/update/delete 或 Worker 路径看到/修改对方数据。
- 昂贵研究端点在直连 API 和 ALB 后都有限流，不只依赖 WAF。

### Phase 4：完成 Leptos/WASM 产品平价

目标：Rust Web 能承接真实用户工作流，而不只是演示页。

任务：

1. 定义类型化 SSE 协议：`meta`、`stage`、`delta`、`guard`、`final`、`error`；服务端只在 `final` 后提交会话。
2. Web 消费流、显示阶段、支持取消/重试；取消要传播到模型 HTTP 请求并正确记录审计状态。
3. 实现会话列表、加载、继续、删除、清空、URL 深链接和浏览器 back/forward。
4. 实现经过消毒的 Markdown、来源引用、证据卡、数据时间、护栏状态和完整决策面板。
5. 补齐公司解析/建议、比较研究、watch desk/detail/rules、组合实时盈亏/review/snapshots。
6. 按产品决定补齐 profiles/scorecard/export/document/feedback/onboarding/invite/team/membership；明确退役的页面写 ADR 并从矩阵关闭。
7. 决定 PWA 是恢复还是退役；若恢复，重新实现 manifest、icon、service worker 更新策略和离线降级。
8. 加入可访问性、键盘、移动端、错误态、空态和超时态测试。

验收：

- 用户能从空库完成注册/登录 → 解析任意合法公司 → 流式研究 → 查看来源/护栏 → 历史继续 → 加自选/规则 → 加持仓 → 看复盘/通知。
- 刷新页面、前进后退、模型失败、供应商失败和 DB 短暂失败均有确定行为。
- Web 不包含第二套金融计算或事实判断逻辑，只展示服务端类型化结果。

### Phase 5：让 Worker 和生产部署真正可用

目标：消除“代码存在但生产不会正确运行”的问题。

任务：

1. 为每个 job 实现原子 claim/lease（例如 `SELECT ... FOR UPDATE SKIP LOCKED` + `locked_until`，或 PostgreSQL advisory lock）；job 必须幂等。
2. 在锁完成前把 Worker `desired_count/max_capacity` 设为 1；锁完成后再验证水平扩容。
3. 修复失败游标语义：区分 last_attempt、last_success、next_retry，指数退避，避免失败后按正常 cron 沉默。
4. 将备份写到受控临时路径、上传 S3、校验对象与加密、清理本地文件；定期在隔离 DB 做 restore drill。
5. 在 Terraform/Secrets Manager 注入模型、行情、证据供应商密钥和 commercial mode；API 与 Worker 按最小权限分别取密钥。
6. 部署 Web（ECS 或 S3/CloudFront），建立同源 `/api` 路由、SPA fallback、缓存策略和 WASM MIME。
7. 增加域名、ACM、HTTPS 443、HTTP 跳转、secure cookie/HSTS；明确可信代理头处理。
8. 真正接入 OpenTelemetry traces/metrics，或删除无效 OTEL 配置；增加 provider、研究阶段、guard、Worker、DB pool 指标。
9. 使用独立 migration task 和最小 runtime DB roles；不要让应用容器自动以 master role 迁移。
10. 固定 Trunk 版本、构建多阶段缓存，CI 构建并 smoke test 三个镜像。

验收：

- 两个 Worker 实例同时运行时，同一 job/调度点只执行一次。
- 备份对象实际出现在 S3，并能恢复成通过 smoke test 的隔离数据库。
- 公网 HTTPS Web 能同源调用 API；生产有模型和已授权数据源，readiness 正确反映依赖状态。
- 日志、trace、metric 能关联同一个 request/research/job id。

### Phase 6：把所有关键验收自动化后再宣布完成

CI 至少包含：

1. fmt、Clippy `-D warnings`、全 workspace test、doc test。
2. 从空 PostgreSQL 执行 `0001`-最新迁移、checksum/drift、重复运行、升级副本验证。
3. 不带 `#[ignore]` 的 auth/RLS/repository/Worker claim 集成测试。
4. WASM check、Trunk release build、Web 组件测试。
5. 自动启动 API、Web、PostgreSQL 和无头浏览器的 E2E；不依赖开发者手工启动 WebDriver。
6. 外部 provider fixture/contract tests；可选 nightly live canary 使用最小额度密钥。
7. 恢复后的研究 QA corpus，质量不得低于迁移前已记录基线；hard fail 必须为 0。
8. 三个 Docker image build + non-root/smoke/health 检查。
9. Terraform fmt/validate/plan 和基础安全扫描。
10. 依赖漏洞、许可证、secret scan；压测研究限流与 SSE 并发。

最终预生产演练：

- 双租户隔离。
- 模型主供应商失败和 failover。
- 行情/财报/证据源缺失或超时。
- Worker 重启、双实例竞争、积压补跑。
- DB 连接耗尽与短暂重启。
- 备份恢复。
- Web/API 蓝绿发布与回滚。

## 4. 推荐 PR 顺序

1. `parity-matrix-and-qa-fixtures`：平价矩阵、恢复 QA fixture、纠正文档。
2. `ci-postgres-integration`：让当前 ignored DB/API 测试进入 CI。
3. `research-service-boundary`：application 用例和 ports，API 变薄。
4. `typed-research-stream`：完整 SSE 事件、guard、持久化、取消。
5. `company-resolution-and-fundamentals`：任意公司解析与真实财务链。
6. `evidence-calendar-peers`：公告/网页证据/日历/同业。
7. `repository-and-api-parity-a`：profiles/watch/portfolio/research。
8. `repository-and-api-parity-b`：documents/export/feedback/team/billing 或退役 ADR。
9. `leptos-conversation-parity`：流式研究、历史、Markdown、证据。
10. `leptos-workspace-parity`：watch/portfolio/settings/剩余页面。
11. `worker-lease-and-retry`：并发安全、幂等、失败重试。
12. `backup-and-restore`：S3 备份及恢复门禁。
13. `web-https-secrets-observability`：完整生产拓扑。
14. `release-gate-and-cutover-audit`：全自动 E2E、QA、故障演练、最终文档。

不要把 3-10 合并成一个 PR。每个 PR 都必须保持主干可运行，并独立说明新增能力与剩余缺口。

## 5. 最终“完成”定义

只有同时满足以下条件，才能把 Rust 重构标为 100% 完成：

- 默认分支没有旧 Node/React/Python 运行路径；Cargo 是唯一工程入口。
- 平价矩阵所有条目均为“Rust 已验收”或“ADR 明确退役”，没有“骨架/待接线/只建表”。
- 迁移前保留的用户流程能在 Leptos Web 完成，且 Web 实际消费类型化 SSE。
- 研究主链会自动解析公司并取得行情、财务和证据；客户端不负责提供可信财务事实。
- 非流式和流式回答都经过同一数字护栏、来源校验和会话持久化。
- 多轮、比较、缺数、供应商失败和 hard fail 有自动回归测试。
- 关键 PostgreSQL/RLS/浏览器/Worker 测试不再被 `#[ignore]` 排除在 CI 外。
- Worker 多实例不会重复执行；失败会重试且可观察。
- Web、API、Worker、迁移、密钥、HTTPS、备份恢复和观测在预生产演练通过。
- 生产 commercial mode 只使用有商业授权的数据源。
- README、PLAN、架构和实际代码一致，不再用“代码落盘/能编译”代替“能力完成”。

## 6. 接手 AI 的执行约束

1. 先读本文件、`CLAUDE.md`、Cargo workspace 和 `dc4b75c^` 的历史行为，再动代码。
2. 不恢复 TypeScript/JavaScript/Python runtime；历史代码只作为行为参考。
3. 金融金额、股数、比率、估值继续使用 `Decimal`；展示边界之外禁止 `f64` 金融计算。
4. 领域规则只进 `echo-domain`；用例进 `echo-application`；HTTP 不复制研究逻辑。
5. 外部数据只经 `echo-data`，持久化只经 `echo-db`，环境配置只经 `echo-config`。
6. 已应用迁移不可修改，只增加新迁移。
7. 不以删除测试、降低 QA 阈值、扩大数据库权限或关闭 RLS 来换绿灯。
8. 不把 mock-only、ignored test、手工 curl 或源码注释当最终验收。
9. 每个 PR 都报告：实现项、未实现项、数据/安全影响、测试证据、回滚方式。
10. 遇到产品范围不明确时，把能力标为 blocked 并请求“保留/替代/退役”决定，不自行悄悄删除。

