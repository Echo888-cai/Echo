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
| 证据平面 | 有新闻/事件输入 | ✅ 日历/历史分位/同业/filings + 网页证据（Exa/Tavily 双供应商）全链接线并 live 验证（含中文源） | §4 P2 |
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
1. `evidence-port` ✅**已接线并 live 验证**（rust-accepted）：`echo-data::EvidenceService`（**双供应商**：
   `EXA_API_KEY` 优先走 Exa `/search`，否则回落 Tavily `/search`；实时无缓存、无新增迁移）→
   `ResearchPorts::load_web_evidence`（意图门控：现状/护城河/竞争/风险/证伪/深研这 6 类定性意图才
   拉；估值/财务质量等数字驱动意图不拉，避免二手噪音与延迟）→ `answer_prompt` 证据块（每条编号+
   标题+来源域名+日期+片段+URL；首行硬性纪律：定性论断须标注来源，证据里的数字**不得**当作已核
   财务数字——绝不解除「无实时财报→禁具体财务数字」封堵，证据也绝不进 `FactsRegistry`）→
   `AskResponse.sources` → Web `SourceCards`（可点击来源卡）。`EXA_API_KEY`/`TAVILY_API_KEY` 带
   consumer 加入 `echo-config`（商用模式拒绝，免费/研究档非商用授权）。供应商失败/未配/额度耗尽一律
   返回空列表诚实降级。2026-07-24 live 浏览器端到端验证：真 Exa 对 AAPL 护城河问题返 5 条新鲜来源
   （含 36氪/21财经/新浪等中文源），答案引用 `[1]`~`[5]` 并把 AI 硬件/供应链风险落到对应来源，Web
   来源卡渲染，护栏 15 核 11 过 0 硬；估值意图 0 源门控正确。**下一步增强**（未做）：证据落库缓存
   （当前每次合格提问实时打一次）、港股中文源专用适配器（Exa 中文提问已能出中文源，但仍应有港股
   一手管道同线的专用源）、把证据也接进对比研究两腿。
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
   429，`/ready` 掉库返 503，跨站 Origin 返 403，见 rust-parity-matrix）。优雅停机 ✅已接，见 §4 P5-1。

### P3 · 报告、记忆、对比（研究资产化）
1. `compare-legs` ✅已接（架构判断已定：**按公司分别验证**，不碰 `merge_facts_registry`——
   两腿全程各自独立 `assemble_facts`/`FactsRegistry`，`ResearchService::compare` 新增编排：
   `build_compare_user_prompt` 拼两个标了名字/代码的独立事实块 + 首行硬性禁止互相借用数字；
   护栏对同一段作答分别跑两次 `verify_answer_numbers`（各用各的 registry），两份 `GuardView`
   独立返回，绝不合并登记表——避免了"腾讯的营收"被当成"苹果营收"合法核对来源的红线污染。
   `POST /api/compare`（`CompareRequest`/`CompareResponse`，`echo-contracts`）不落库、不支持
   多轮（对比会话的持久化/续问形态待产品判断，非本次范围）。真实端到端验证：AAPL vs MSFT
   对比问"利润质量"，模型正确分别引用两家净利润/净利率并显式标注归属公司，两腿护栏各自
   4 项核对、0 hard fail。**已知限制**（`fact_guard.rs` 现有代码，非本次引入）：裸数字的货币
   标签识别窗口只看前 10 字符，当两个不同币种数字在原文中紧邻（<10 字符）出现时，后一个
   数字可能误吞前一个的货币标签——对比研究场景比单公司场景更容易触发；调研时用真实文本
   复现过，已用更长间隔的答案文本绕开，但护栏本身未修（不在本次架构判断范围内，需要时另开
   小 PR：把货币标签窗口从"字符距离"改成"就近原则"或要求标签与数字之间不能跨越另一个数字）。
   ✅ **Web 对比视图已接**（`echo-web::compare::ComparePage`，双 ticker 输入 + 独立双栏渲染，
   两腿的估值/护栏卡片各自独立，绝不混排；真实端到端验证：AAPL vs MSFT 利润质量对比，
   两栏各自 26 项核对/25 soft/0 hard，模型作答正确分别引用双方数字）。**仍未做**：对比会话
   落库/续问（需要先定"对比会话"在 `research_sessions` 单 ticker schema 下怎么存，或要不要
   新表——产品判断，非本次范围）。
2. `company-profiles` ✅已接 repository/API（`echo-db::CompanyProfileRepository` + `GET/PUT/DELETE
   /api/profiles[/:ticker]`，真库 tenant-isolation 单测 + live HTTP 验证：建档→部分更新保留
   未传字段→turn_count 按轮次递增→删除不复活）。✅ **Web 编辑页已接**（`echo-web::profiles::
   ProfilesPage`，列表+详情编辑表单，thesis/bull/bear/monitors/falsifiers/自由笔记；真库端到端
   验证：编辑 AAPL 档案 thesis 字段，PUT 后 `company_profiles` 表真实落值）。**仍 pending**：
   研究会话自动沉淀 thesis/bull/bear 到档案（需先定"从答案抽取什么、怎么抽"的语义，产品判断，
   未做——当前只有手动 PUT 编辑）。
3. `deep-report` ✅已接生成（`POST /api/report/generate`，`echo-application::ReportService::generate`
   与 `/api/ask` 共用同一条 `assemble_facts`/`build_panel` 取数管线——不是另起一条编排，
   只在提示词与产物形态上分叉：`build_report_prompt` 复用与聊天回答同一份 `facts_block`
   事实格式化，外面套判断优先的固定七段结构（核心判断/赚钱机制与护城河/财务质量/估值与
   赔率/风险与证伪条件/关键监控与下一步/来源），1200-2500 字。模型不可用或输出短于 200
   字（截断/拒答）退化为 `compose_report_fallback`——只用同一份已核事实拼接，不发明业务
   定性描述（Rust 侧研究管线目前不接 company_profiles 定性字段，见下条 P3-2 pending）。
   护栏对最终产出的 markdown（无论模型或本地路径）跑 `verify_answer_numbers`，与聊天回答
   同一份 `FactsRegistry`。落库复用 `PersistResearchSession`，`session_id` 续接同一研究会话。
   真实端到端验证：纯核路径（无 DB/无模型配置）真实 HTTP 调用 AAPL 请求，本地兜底 0.1s
   出带真实数字的完整 Markdown 报告，估值区间正确算出，fact_guard 9 项核对 6 pass/3
   soft/0 hard fail，会话落库返回 session_id。✅ **Web 报告视图/导出已接**（研究页 composer 加
   "深度报告"按钮，复用同一对话 thread 渲染报告卡片；客户端 Blob+`<a download>` 导出 `.md`，
   零 JS 依赖；真实端到端验证：AAPL 深度报告页面渲染完整七段结构，落库归位研究历史）。
4. `multi-turn` ✅已接（`echo_contracts::AskRequest.session_id` + `AskResponse.session_id`；
   `ResearchPorts::load_prior_turns` 读回本会话此前几轮问答，`answer_prompt` 拼一段明确标注
   "仅供代词/实体承接、不得引用其中数字"的历史块，`fact_guard` 仍只用本轮现取事实核数——
   历史绝不进 `FactsRegistry`；`persist_outcome` 用 `session_id` 归位同一行而非插入新行，
   `turn_count`/`thread_json` 按轮次累加；Web 页面级 `current_session_id` 信号在第一轮落库后
   自动续接，后续追问在同一页面自动带 `session_id`。真库端到端验证：连续两轮问答落成同一行，
   `turn_count` 2、`thread_json` 累积两轮问答，未污染其他会话）。

### P4 · 主动研究（简报触达）
1. `worker-lease` ✅已接（`scheduler_state` 加 `locked_until`/`locked_by`，migration 0012；
   `SchedulerStateRepository::try_claim` 用原子 `UPDATE ... WHERE (locked_until IS NULL OR
   locked_until < now())` 抢占——单行 upsert 场景下与 `SELECT ... FOR UPDATE SKIP LOCKED`
   等价，`dispatch` 前先抢锁，抢不到即跳过；`record_run` 完成时同步释放锁，崩溃未释放的锁
   靠 15 分钟租约自然过期兜底。真库端到端验证：第二实例在租约内抢不到、`record_run` 后立即
   能抢到、租约过期后能被第三个实例重新抢占）。
2. `digest-to-user` ✅已接（`echo-worker::activities::digest` 不再是规则计数占位统计，改为
   聚合真实持仓日内异动（`change_percent` 超过阈值的 ticker 列表）+ 有效监控条件数 + 本轮
   触发数拼成的真实简报正文；落库仍唯一经 `NotificationsRepository::insert`——偏好/免打扰/
   去重咽喉不变。邮件是站内通知的镜像通道：`echo-data::EmailService`（`lettre` 异步 SMTP，
   `echo-config::EmailConfig` 显式注入，未配置 SMTP 或收件账号不是邮箱形态时静默降级为
   仅站内通知，不伪造发信成功）只在通知已真正落库后才尝试同步发信。真实端到端验证：
   `cargo test -p echo-worker -- --ignored` 对活库跑通简报/证伪巡检/业绩复盘三个活动，
   真实生成"持仓 N 个，其中 M 个日内异动…"格式的简报正文并落库）。
3. `watch-rules` ✅已接（`echo_domain::RuleKind` 补齐 `valuation_percentile_below/above`
   （复用既有 `HistoricalValuationService`，仅美股，DB 缓存 7 天过期才回源）与 `event_earnings`
   （复用 `review_earnings` 业绩事实落库时机）两类新规则，与既有 price/fundamental 共用同一条
   `check_falsifiers` 核对循环与告警落库路径；`WatchRuleService` 建规则前校验 ticker 已核实
   建档；`POST/GET/DELETE /api/watch/rules` + `GET /api/watch/desk`（聚合关注列表/持仓/规则
   涉及的全部 ticker 各自最新行情、挂载规则、近期触发通知，纯只读聚合不新增写路径）。
   ✅ **Web 台面已接**（`echo-web::workspace::RulesDeskSection`，新增/删除规则表单 + 台面卡片 +
   近期触发列表；真实端到端验证：浏览器对本机 Trunk 开发服务器创建 AAPL price_below 规则→
   台面卡片实时显示→点击删除→活库确认行已消失，全程真实 HTTP 往返、非 mock）。

### P5 · 生产化与全自动验收
按交接书 Phase 5/6 原文执行（HTTPS、密钥注入、S3 备份恢复演练、OTLP、CI 起真浏览器 E2E、
镜像 smoke）。前提：P1–P4 完成且平价矩阵研究主链无 skeleton 条目——2026-07-22 核对通过（`/api/
companies/resolve`、`/api/ask` 此前矩阵行滞后于实际代码，已校正为 rust-accepted，详见
rust-parity-matrix 变更记录）。

1. `graceful-shutdown` ✅已接：`echo-api`（`axum::serve().with_graceful_shutdown`，SIGTERM/Ctrl+C
   停止接受新连接、排空存量请求再退出）与 `echo-worker`（主循环 `tokio::select!` 只在空闲等待
   下一跳时参与停机信号选择，一旦某个 `tick()` 已经开始执行就会跑到完成，不会在活动持有
   worker-lease 的中途被杀死——避免容器滚动更新把租约晾到过期才被下一实例接手）共用同一套
   SIGTERM/SIGINT 信号处理。真实进程验证：`cargo run` 起两个进程，`kill -TERM` 后确认停机日志
   打印、进程干净退出（非僵死/非崩溃）。fmt/clippy(-D warnings)/test(全绿)/wasm check 门禁全过。
2. `backup-s3-upload` ✅已接：`echo-postgres-backup` 在本地 `pg_dump` 成功落盘后（本地文件
   仍是备份唯一真源），若配置了 `ECHO_BACKUP_BUCKET`/`ECHO_BACKUP_REGION`/`AWS_ACCESS_KEY_ID`/
   `AWS_SECRET_ACCESS_KEY`（`echo-config::BackupConfig`，四项均非空才算配置完整）则镜像上传
   到 S3——同 email 的镜像通道策略：未配置诚实降级为仅本地备份，配置了但上传失败也不推翻
   已完成的本地备份，只把失败信息写进活动结果字符串。直连 S3 REST API 手签 SigV4
   （`echo-data::BackupStorageService`），没用官方 `aws-sdk-s3`——它的传递依赖
   `aws-sdk-sts` 1.9x 要求 rustc 1.88，高于本仓库 `rust-toolchain.toml`/CI 钉的 1.85，
   工具链升级是跨切片的基础设施决定，不在本次范围内顺带做；SigV4 用工作区已有的
   `hmac`/`sha2`/`hex`（RustCrypto 同源，无新增 MSRV 风险）手工实现，单一 PUT Object
   请求，算法边界小。验证分两层：①签名算法用独立 Python `hmac`/`hashlib` 脚本重算同一组
   固定输入（AKIDEXAMPLE 系列示例凭据），逐字节比对签名密钥与完整 Authorization 头，
   证明两套互不共享代码的实现算出同一结果；②真实端到端跑 `cargo test -p echo-worker --
   --ignored`，对活库真实 `pg_dump` 落盘，验证未配置 `ECHO_BACKUP_BUCKET` 时诚实降级为
   `S3=未配置`（真实 S3 桶/凭据需用户本人在 AWS 侧配置后才能验证上传成功路径，见 §2.2）。
3. `otlp-tracing` ✅已接：`echo-observability::init` 在 `OTEL_EXPORTER_OTLP_ENDPOINT`
   （标准 OTel 环境变量名，明文 HTTP，收集端通常是同网/同机 sidecar；HTTPS 收集端需要
   额外 TLS 后端选型，本次不支持）非空时挂一层 OTLP span 导出，与既有 stdout 日志并行、
   互不替代；未配置时完全不建 `TracerProvider`（不是失败降级，是真正不起任何后台导出
   线程）。用 `opentelemetry_sdk::trace::span_processor_with_async_runtime::
   BatchSpanProcessor`（`experimental_trace_batch_span_processor_with_async_runtime`
   feature）+ `runtime::Tokio`——默认的 `with_batch_exporter` 走独立 OS 线程，会在
   reqwest 底层 hyper 需要 tokio reactor 时直接 panic（"no reactor running"，本地真实
   复现过）。**同 PR 必须接上真实调用方**（frozen-table 教训，只加导出通路没有调用方
   等于没做）：`echo-api` 在路由上挂 `tower_http::trace::TraceLayer`（新依赖）生成每请求
   span；`echo-worker` 在 `dispatch` 加 `#[tracing::instrument]` 生成每作业 span。两处都
   踩了同一个坑并修了：`TraceLayer`/`#[instrument]` 缺省 span 级别是 DEBUG，而生产默认
   `RUST_LOG=info` 会在 span 到达 OTLP 层之前就被过滤掉——本地起真实 OTLP 收集端复现过
   "配了端点但一条 span 都导不出"，已显式把 echo-api 的 `TraceLayer` 调到 INFO 级修正
   （`echo-worker` 的 `#[instrument]` 默认级别本身是 INFO，不受影响）。优雅停机路径
   （P5-1）同步接了 `echo_observability::shutdown()`，退出前排空批处理队列，不丢尾部
   span。真实端到端验证：本地起一个捕获 HTTP POST 的假收集端（Python http.server），
   `echo-api`/`echo-worker` 分别指向它，各自打真实请求/真实作业，SIGTERM 触发 flush 后
   逐字节核对收到的 protobuf 载荷里 `service.name`=`echo-api`/`echo-worker`、span 名
   `request`/`dispatch`，不是自洽测试。
4. HTTPS、密钥注入、CI 真浏览器 E2E、镜像 smoke、S3 备份恢复演练：待续，部分需要用户
   本人操作云账号/证书（见 §2.2）。

## 5. 完成定义

- 平价矩阵研究主链（ask/stream/resolve/fundamentals/evidence/report/profiles）全部 rust-accepted。
- 空库 → 注册 → 输入公司名 → 流式研究（含证据与来源卡）→ 历史继续 → 档案沉淀 → 简报触达，全程真数据端到端可复现。
- `agent-qa` 技能回归：意图路由 0 回退、hard fail = 0。
- 门禁全绿且无 `#[ignore]` 主链测试。
