# Echo 改进计划 · 对标并超越 Honeclaw（执行模型交接书）

> 更新：2026-07-21。本文由架构审查产出，交给后续执行模型（Sonnet 级）按小 PR 逐条落地。
> 阅读顺序：先读本文 §0 约束，再读 `CLAUDE.md`、`docs/PLAN.md`，需要能力级明细时查
> [rust-parity-matrix.md](rust-parity-matrix.md) 与 [RUST_REFACTOR_HANDOFF.md](RUST_REFACTOR_HANDOFF.md)。
> 本文只做三件事：**对标结论、清理清单、按优先级重排的执行切片**；与交接书冲突时以本文优先级为准。

## 0. 执行模型硬约束（每个 PR 都适用）

1. Cargo 是唯一工程入口；禁止引入 Node/Python/手写 TS 运行时。
2. 金额/股数/比率/估值只用 `rust_decimal::Decimal` + NUMERIC；缺数用 `None`，禁止 0 占位、陈旧回填、跨公司混数。
3. 分层红线：规则→`echo-domain`；用例→`echo-application`;DB→`echo-db`；外部 HTTP→`echo-data`；env→`echo-config`；`echo-api`/`echo-worker` 只做边界与调度。
4. 迁移 `0001`–`0010` 冻结（checksum 在 `docs/qa/fixtures/migration-checksums.json`），新变更只加 `0011+`。
5. 每 PR 一个能力切片，目标 diff ≤ 500 行；交付前必跑：
   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   cargo check -p echo-web --target wasm32-unknown-unknown
   cargo xtask web
   ```
6. 不以删测试、降 QA 阈值、扩 DB 权限、关 RLS 换绿灯；"能编译"不等于"能力完成"。
7. 动到平价能力时同步更新 `rust-parity-matrix.md` 对应行。
8. 产品范围有歧义时标 blocked 并向用户要"保留/替代/退役"决定，不要自行猜。
9. "写好了没人调"是本仓库头号历史缺陷（frozen-table pattern）：任何新能力必须当 PR 内接通真实调用方并用真数据端到端验证，否则不算完成。

## 1. 对标结论：Honeclaw vs Echo

Honeclaw（B-M-Capital-Research/honeclaw，Rust 74% + SolidJS，742 star，v0.14.1）核心能力：
持仓监控（止盈止损触发）、公司研究档案（Markdown 长期记忆）、定时分析（盘前简报/财报复盘）、
多端触达（Web/macOS/Discord/Telegram/Lark/iMessage）、纪律型决策检查。其估值内核闭源。

**Echo 已领先的差异化（继续做深，不许丢）：**

- 定点金融内核 + 数字护栏：`finance-core` Decimal 不变量、`fact_guard` 逐数核对生成文本——honeclaw 没有公开等价物。
- 诚实缺数语义：`None`/"未核到"贯穿全链，不臆造。
- 多租户 RLS + 供应商授权/商用合规门 + 双时间财务事实设计。
- 意图路由语料回归（275 case）与可审计的研究链路。
- 港股一手管道规划（护城河，不许砍）。

**Echo 落后的研究能力差距（超越 honeclaw 的主战场，按价值排序）：**

| 差距 | Honeclaw 现状 | Echo 现状 | 落点 |
| --- | --- | --- | --- |
| 证据平面 | 有新闻/事件输入 | 日历/历史分位/同业/filings 已接；网页证据仍 pending | §4 P2 |
| 深度报告 | 有报告工作流 | `/api/report/generate` 未迁移 | §4 P3 |
| 公司档案记忆 | Markdown 长期记忆 | `company_profiles` repository/API 已接（手动编辑）；Web 编辑页/自动沉淀仍 pending | §4 P3 |
| 定时简报触达用户 | 盘前/财报简报直达 IM | worker digest 只写库，无用户触达面 | §4 P4 |
| 多轮对话研究 | 有 | 每次独立 turn，Web 不加载历史 | §4 P1 |
| 流式体验 | SSE 已接 UI | 服务端 SSE 已实现但 Web 不消费 | §4 P1 |

结论：**不抄 honeclaw 的多端分发**（那是渠道优势，不是研究优势）；先把"证据优先 + 护栏 + 定点"
做成 honeclaw 给不了的可信度，再补报告/记忆/简报三件套。

## 2. 清理清单

### 2.1 代码内（执行模型直接做，一个 PR：`chore/cleanup-dead-config-and-infra`）

1. **删除 `infra/terraform/` 整个目录。** 该 AWS ECS 拓扑从未部署成功、与现实矛盾
   （不注密钥、不部署 web、备份 bucket 无消费者，见矩阵 §9），留着只会误导。生产化在 §4 P5 重新设计。
2. **删除 `TAVILY_API_KEY`** 于 `crates/echo-config/src/lib.rs:16,28` 与 `.env.example`——解析了但无任何消费者，
   且账号额度已超（HTTP 432）。P2 接证据供应商时按届时选型重新加入（key 必须与 consumer 同 PR 出现）。
3. **模型 provider 配置收口 `echo-config`：** `crates/echo-application/src/model_gateway.rs:25-47` 直接读
   `std::env`，违反单入口约束；迁入 `echo-config` 显式注入（交接书 Phase 1 任务 7）。同 PR 顺手把
   DEEPSEEK_*/OPENAI_*/MODEL_* 三套 key 归一为"具名预设 + 通用 MODEL_* 覆盖"两层，删掉多余组合。
4. `.env.example` 只保留有 production consumer 的变量；每删一个 key 在 PR 描述里注明原消费者已不存在。
5. 删除已合并的远端分支（`codex/*`）与 `rust-core-io-wiring`。
6. `docker/` 三个 Dockerfile 暂保留，但在 P5 前不得再扩；CI 未 smoke 的镜像不许在文档里描述为"可部署"。

### 2.2 云端与账号（需要用户本人操作，模型不得代办）

- **AWS**：若 terraform 曾 `apply` 过，先在控制台确认 ECS/ALB/RDS/S3 是否有存量资源并销毁，避免持续扣费；确认无资源后再合并删除 terraform 的 PR。
- **Tavily**：额度已耗尽。决定续费、或换 Exa/Brave 等供应商、或暂缓证据平面；未接线前不要配 key。
- **旧栈遗留订阅**：迁移前技术栈（Temporal Cloud、Vercel/Supabase 之类托管服务）若还有账号/订阅，一并注销。
- **本地数据**：`backups/`（本地 pg_dump 产物）与旧数据库 dump 可清；`.env` 含真实密钥，永不入库。

## 3. 已确认 Bug 与交互缺陷（P0，逐条小 PR 修）

1. **并发提问结果错位**（`crates/echo-web/src/research.rs:187-213`）：`submit()` 不检查 `pending`，
   textarea/ticker 的 Enter 在请求进行中仍可重复提交；而 `create_effect` 把任何完成结果写进
   `thread` 最后一条——两问并发时 A 的答案落到 B 的气泡上，A 永远"正在研究…"。
   修法：turn 带唯一 id，action 结果按 id 归位；pending 时禁提交或排队。
2. **浏览器后退失效**（`crates/echo-web/src/workspace.rs:59-65`）：只 `push_state` 没有 `popstate`
   监听，后退/前进 URL 变了页面不变。补 popstate → `set_page`。
3. **答案不渲染 Markdown**（`crates/echo-web/src/research.rs:147`）：模型输出按纯 `<p>` 显示，
   星号井号原样可见。接经消毒的 Markdown 渲染（pulldown-cmark + 白名单 sanitize，禁 raw HTML）。
4. **流式断层——frozen-table 现行实例**：`/api/ask/stream` 类型化 SSE（meta/stage/delta/guard/final/error）
   服务端已完成（`crates/echo-application/src/research.rs:221`），Web 仍调非流式 `/api/ask`
   （`crates/echo-web/src/research.rs:20`），用户只看到静态"正在研究…"。→ §4 P1-1。
5. **研究历史第二处 frozen-table**：sessions 列表/读取/删除 API 已 rust-accepted，Web 完全不调用，
   刷新即丢全部对话。→ §4 P1-2。
6. **强制手输 ticker**：resolve 链（DB→别名→FMP→探活）已上线，composer 仍要求用户自己给
   `AAPL / 9988.HK` 格式代码。应支持输入公司名自动解析 + 候选确认。→ §4 P1-3。
7. **API 安全缺口**（矩阵 §9）✅已接（P2-4）：应用层限流、readiness、Origin 防护、JSON body 上限
   均已接线并真库端到端验证，见 §4 P2-4。
8. **Worker 无 claim/lease**：多实例会重复执行同一 job（矩阵 §5 全 skeleton 根因）。→ §4 P4。
9. **e2e 全 ignored**：`cargo xtask e2e` 需手工起 WebDriver，CI 不跑真浏览器。→ §4 P5。

## 4. 执行路线（按研究能力优先重排；每个 P 内按序出 PR）

### P0 · 清理与止血（本周）
§2.1 清理 PR + §3.1/2/3 三个 bug PR。共约 4 个小 PR。

### P1 · 把已有后端能力接到用户手上（最便宜的体验跃升）
1. `web-typed-stream`：Web 消费 `/api/ask/stream`，展示阶段反馈（组装→生成→核对→落库）、
   打字机 delta、guard 徽标；支持取消（AbortController 传播到模型请求并记审计）与失败重试。
2. `web-research-history`：会话列表侧栏、加载/继续/删除、URL 深链 `/research/:session_id`、
   刷新恢复。
3. `resolve-first-composer`：composer 单输入框，公司名/代码皆可；调 `/api/companies/resolve`,
   多候选弹确认，验证成功才发研究。删除独立 ticker 输入框。
4. `web-polish`：空态/错误态/超时态、移动端断点、键盘可达性。动效与视觉打磨是一等验收维度
   （用户明确要求 UX 顶级），但禁止引入 JS 依赖，全部 Leptos + CSS。

### P2 · 证据优先数据平面（超越 honeclaw 的核心）
1. `evidence-port`：网页证据端口 + 所选供应商适配器（等用户定 Tavily 续费或替代品；供应商失败诚实降级，不重诊断——已知结论勿重推）。
2. `filings-and-calendar`：财报日历（Finnhub）✅已接（`echo-data::CalendarService` +
   `echo-db::CalendarRepository`，24h 陈旧回源，`ResearchPorts::load_earnings_calendar`→Web
   `EarningsBadge`，见 rust-parity-matrix）+ 公告/filings 读模型 ✅已接（`echo-data::FilingsService`：
   Finnhub `/stock/filings`，新表 `company_filings`（migration 0011，首个冻结后新增迁移）+
   `echo-db::FilingsRepository`；只留实质公告表单 10-K/10-Q/8-K/proxy/registration 等，剔除内部人
   交易表单 3/4/5/144；美股专属（EDGAR 本身不覆盖港股/A股）；接入 `ResearchPorts::load_recent_filings`
   →`answer_prompt`（模型可引用 form/日期/URL）→`AskResponse.filings`；真库+真 Finnhub 端到端验证：
   AAPL 8 条入库并被模型引用，0700.HK 正确空表退出，24h 缓存命中）。
3. `peers-and-history`：历史估值分位 ✅已接（`echo-data::HistoricalValuationService`，美股专属，
   FMP 年度 EPS 按 `filingDate` 截止匹配 Yahoo 月度收盘价，避免未来数据反推历史；港股/A股
   诚实返回 `None`，不读表里可能是别口径的陈旧点位冒充支持；接入 `answer_prompt` + `fact_guard`）。
   同业对比事实（`comp_peers`/`PeerAnchor`）✅已接（`echo-data::PeerService`：FMP `stock-peers`
   选可比公司 + `ratios-ttm`/`key-metrics-ttm` 取 PE/EV-Sales，按分位缓存 24h；按公司自身盈利/
   亏损阶段选 PE 或 EV/Sales 口径，接入 `ResearchPorts::load_peer_anchor`→`build_panel`→
   `compute_valuation`/`compute_ev_sales`→`answer_prompt`；真库+真 FMP 端到端验证：AAPL 4/5 家
   可比成分位、RIVN 单点位诚实拒绝成分位，见 rust-parity-matrix）。
4. `api-hardening` ✅已接（`echo-db::RateLimitRepository` 接线 `rate_limit_buckets` + `/api/ask`、
   `/api/ask/stream` 每用户每分钟限流；`GET /ready` 真连库；`enforce_origin` 中间件校验状态变更
   请求 Origin；`DefaultBodyLimit::max` 512KiB 请求体上限；真库端到端验证：3 次放行第 4 次
   429，`/ready` 掉库返 503，跨站 Origin 返 403，见 rust-parity-matrix）。优雅停机仍 pending，见 P5。

### P3 · 报告、记忆、对比（研究资产化）
1. `compare-legs`：`CompareResearchFacts` 双腿隔离取数 + 对比提示词 + Web 对比视图。**blocked**：
   `echo_domain::merge_facts_registry`（同样是"写好了没人调"的冻结代码）按维度（金额/百分比/
   倍数/日期）合并两份 `FactsRegistry`，**不按 ticker 命名空间隔离**——直接拿来做双腿护栏会
   把"腾讯的营收"当成"苹果营收"的合法核对来源，正是架构上明令禁止的"问苹果答腾讯"污染。
   需要先决定护栏怎么在双主体下做隔离核对（按公司分别验证 vs 合并但打标签），这是产品/架构
   判断，不是数据接线，故未做；接手时先读这段注释，不要重新推导。
2. `company-profiles` ✅已接 repository/API（`echo-db::CompanyProfileRepository` + `GET/PUT/DELETE
   /api/profiles[/:ticker]`，真库 tenant-isolation 单测 + live HTTP 验证：建档→部分更新保留
   未传字段→turn_count 按轮次递增→删除不复活）。**仍 pending**：Web 编辑页（产品级 UX 决定，
   未做）；研究会话自动沉淀 thesis/bull/bear 到档案（需先定"从答案抽取什么、怎么抽"的语义，
   产品判断，未做——当前只有手动 PUT 编辑）。
3. `deep-report`：深度报告生成 + 导出；报告只引用 registry 内已核数字。
4. `multi-turn`：conversation 分组、代词承接；历史只帮承接，旧数字不得注入新事实。

### P4 · 主动研究（简报触达）
1. `worker-lease`：`SELECT ... FOR UPDATE SKIP LOCKED` + `locked_until`，job 幂等；完成前 worker 单实例。
2. `digest-to-user`：盘前/盘后简报进通知面板 + 邮件（通知必须过偏好/免打扰/去重咽喉）。
3. `watch-rules`：自选规则（价格/估值分位/事件触发）+ desk 视图 + 触发通知。

### P5 · 生产化与全自动验收
按交接书 Phase 5/6 原文执行（HTTPS、密钥注入、S3 备份恢复演练、OTLP、CI 起真浏览器 E2E、
镜像 smoke）。前提：P1–P4 完成且平价矩阵无 skeleton 主链条目。

## 5. 完成定义

- 平价矩阵研究主链（ask/stream/resolve/fundamentals/evidence/report/profiles）全部 rust-accepted。
- 空库 → 注册 → 输入公司名 → 流式研究（含证据与来源卡）→ 历史继续 → 档案沉淀 → 简报触达，全程真数据端到端可复现。
- `agent-qa` 技能回归：意图路由 0 回退、hard fail = 0。
- 门禁全绿且无 `#[ignore]` 主链测试。
