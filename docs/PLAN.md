# Echo Research 产品计划与架构底账（v4）

> 更新于 2026-07-16。本文是仓库唯一计划文档，取代 v3 及所有旧版本，可独立阅读，不需要任何前情。
> 定位不变：**只做美股与港股，核心研究对象是两地科技股**；A 股已于 v3 期间退场完毕。
> v4 的变化：v3 路线图（P3 证据收口 → P4 留存 → P5 商业化脚手架）已完成并合入 main，全部废止；新路线图只有两条主轴——**研究质量（RQ）**与**交互体验（IX）**。代码注释里出现的 "P3/P4/P5" 均指 v3 阶段，其结论已吸收进本文。

## 1. 产品定位与永久红线

Echo Research 是面向美股与港股价值投资者的证据优先 AI 研究台。北极星不是回答数量，而是让用户更快形成可复核、可持续追踪、能被新证据推翻的投资判断。

永久红线：

1. 不给买卖指令，正反向措辞都算（"不建议追高买入"也是买卖指令）；只输出研究判断、监控条件和风险检查点，用"赔率偏低/偏高"类纯研究语言。
2. 不编数字；取不到就明确显示"未核到"，近似口径必须标注。不得用"我们没接这个源"冒充"这家公司没有这项数据"，反之亦然。配置了密钥但没有真实调用验证的能力不得展示为"已接通"（配置剧场同样算撒谎）。
3. 私有数据由应用层租户过滤和 PostgreSQL 强制 RLS 双重隔离。
4. 金额、股数、比率与估值不使用二进制浮点：存储用 `NUMERIC`，计算用 Rust 十进制定点（`@echo/finance-native`）；展示边界之外新增浮点金融计算即违规。
5. 密钥只存服务端环境；未获商用授权的数据源不得进入商用路径（`packages/data-plane` 的 `authorization.ts` 强制执行）。
6. 组合净值缺日即断口，不插值、不回填。
7. UI 变更必须通过 375/768/1280 三档视口与双主题实跑。
8. 数据变更必须可恢复；发布采用 expand-contract 与蓝绿方式。
9. 端到端契约唯一：tRPC procedure 的输入与输出都必须挂 zod schema（源在 `packages/contracts`）；前端不得读取契约之外的字段，后端不得返回契约之外的形状。
10. 用户显式删除必须终局生效：删除操作在任何缓存层之后都不得复活；每类删除都要有"删除→刷新→不复活"E2E。

## 2. 唯一运行架构（目标：全栈 Rust）

> 2026-07-20 起，架构目标改为**全栈 Rust**，用绞杀式(strangler)迁移从下方旧 TS 栈过渡。
> 旧栈在对应 Rust crate 达到平价前继续供能，达到平价后即摘除。

```text
目标栈（Rust）
Leptos/WASM ── axum(HTTP/SSE) ── echo-application ── sqlx/PostgreSQL
   echo-web        echo-api          编排 + 领域            echo-db
                                        │
                                        ├── echo-domain      纯领域规则（估值/护栏/意图/衍生，不接触 IO）
                                        ├── echo-worker      后台工作流（业绩复盘 / 证伪巡检）
                                        └── finance-core     十进制定点金融数值内核

迁移期尚存的旧栈（TS，逐块摘除）
React/PWA(apps/web) ── tRPC + Hono SSE(apps/api) ── Temporal(apps/worker) ── Drizzle(packages/db)
```

端与端之间的契约在迁移完成前维持 zod 单一源（`packages/contracts`），axum 侧以同形状 JSON 对齐；
多步任务的可重放语义由 `echo-worker` 承接（旧 Temporal 摘除前并存）；结构化研究数据保留 valid time
与 knowledge time。仓库布局见 [architecture/repository-layout.md](architecture/repository-layout.md)。

### 2b. 全栈 Rust 迁移账本（strangler）

绞杀顺序按"正确性关键 → IO → 前端"推进，每块达到平价并通过门禁后摘除对应 TS：

| # | Rust crate | 绞杀对象(TS) | 状态 |
|---|---|---|---|
| 1 | `crates/finance-core` | —（原生） | ✅ 定点内核 |
| 2 | `crates/echo-domain::valuation` | `packages/domain/valuation.js` | ✅ 已迁 + 4 项不变量测试绿 |
| 3 | `crates/echo-domain::fact_guard` | `packages/domain/factGuard.js` | ✅ 已迁 + 5 项回归测试绿（符号翻转/中文降幅/股数误判/来源段/币种） |
| 4 | `crates/echo-domain::intent` | `intentClassifier.js` | ✅ 已迁 + 5 项测试绿（9 规则次序/中英双语/深度判定） |
| 5 | `crates/echo-domain::derivations` | `research.ts` 财务衍生(TTM/EPS 年化/margins) | ✅ 已迁 + 4 项测试绿（TTM 桥接 + EPS 年化护栏） |
| 6 | `crates/echo-application` | `packages/application/research.ts` | 🚧 编排+估值+意图已接；DB 行→领域映射(`from_db`)+4 项测试绿；模型网关**非流式核心已接**(`model_gateway`：provider 选择 DeepSeek→OpenAI→通用 / OpenAI 兼容请求体 / 作答提取 / `parse_json_object` / usage 抠取 / `AuditContext` best-effort 落审计，13 项纯函数测试绿)。剩余显式 seam：流式 SSE 增量、活库端到端验证 |
| 7 | `crates/echo-db` | `packages/db`(Drizzle) → sqlx | 🚧 companies/market_snapshots 仓储 + 租户 RLS(`with_tenant`)；`Pool` 上抛，映射已被 api 消费(非死码)。**llm_audit 仓储已接**(`LlmAuditRepository::insert` 走 with_tenant，error_detail 按 char 截 500，3 项测试绿)。**DB 补数/审计写入路径待活库端到端验证** |
| 8 | `crates/echo-api` | `apps/api`(Hono/tRPC) → axum | 🚧 `/health`+`/api/ask` 纯核路径已 curl 端到端验证(意图/定点估值/护栏全绿)；缺行情时经 `AppState.pool` 兜底 DB 快照。**生成路径已接**：草稿缺失且配了 provider 时用领域事实(`answer_prompt`)构造提示词→网关生成→生成答案同过数字护栏；无 provider 诚实回 `answer_source:"unavailable"`(curl 验证:无 key 不假造答案)。**流式 SSE 已接**：`POST /api/ask/stream` 走 `model_answer_stream`(reqwest bytes_stream→`parse_sse_line`解帧→`Coalescer`按24字符合并→mpsc→axum `Sse`)，curl 验证 200/`text/event-stream`、无 provider 干净空流不挂死。剩余 seam：流式路径事后跑护栏并把 factGuard 作收尾事件、`visibleText`剥机器行裁剪、活库(生成+审计)端到端验证 |
| 9 | `crates/echo-worker` | `apps/worker`(Temporal) | 🚧 调度骨架 |
| 10 | `crates/echo-web` | `apps/web`(React/PWA) → Leptos/WASM | 🚧 研究外壳骨架 |

平价门禁：对应 Rust crate 必须通过 fmt/clippy(`-D warnings`)/test + 端到端等价核对（同输入同输出），
且旧 TS 路径的 E2E 断言先切到新栈跑绿，才允许删除旧文件。**新增领域逻辑一律进 Rust，不再加到 JS 侧。**

## 3. 能力底账（2026-07-16 审计）

**已接通且经真实数据端到端验证：**

- **行情**：多源适配器链（Finnhub → Yahoo）+ 熔断降级；唯一入口 `ensureFreshMarketSnapshot`（15 分钟新鲜窗、失败退旧快照、核不到即 null）。港股实际只有 Yahoo 一路真实覆盖（见第 7 节）。2026-07-20 数据源收口：删除 Twelve Data（免费档仅美股、与 Finnhub 完全重复）与 Alpha Vantage（25 次/天、末位兜底贡献为零）两个适配器及其环境变量。
- **财务**：美股走 FMP `stable`（三表 + TTM 比率，含真实 trailing PE）；港股走一手 HKEX filing 解析管道（`hkFilingsPipeline`，含场内回购翌日披露、公司自报 FCF 解析）。
- **财报日历**：美股 Finnhub `/stock/earnings`（含 last_* 已报告字段）；港股经人工核实的 HK→ADR 映射表（9 支，`hkAdr.ts`）查 ADR 日历。
- **研究链路**：`answerComposer`（意图分类路由段落结构，中英双语）+ `reportComposer`（深度报告与对话回答共享取数、分开渲染）+ 同业可比（`comp_peers`，24h TTL，倍数可比上限过滤离群值——**锚点与提示词两个出口都过滤**，2026-07 修复了"防线只在锚点生效、离群倍数仍经散文到达用户"）+ 对话内对比（`compareWith` 真实取两家数据）+ 用户上传资料进事实块。
- **估值区间**（bear/base/bull）：只在有可信口径（真实 TTM PE / FCF / 年化 EPS / 可比锚点）时给。**没有就诚实不给**——2026-07 删掉了两条"以现价为中心"的兜底（`base` 恒等于现价、赔率恒为 1.27），它们对每家公司都输出同一个赔率，是典型的编数字。港股因此在 FMP 港股三表（第 6 节 ②）到位前多数不给估值区间，这是诚实的代价，不是回归。
- **防幻觉**：`factGuard` full 模式（拦截 + 定向重答闭环，审计写入 `fact_guard_audit`）；报表币种与报价币种分离；EPS 一律 TTM 年化后才允许反推 PE（`deriveAnnualEps`，缺数据标 `epsAnnualized: false` 并禁用相关方法）。
- **网页证据层**：Tavily 搜索适配器已接通，密钥未配时诚实降级。
- **证伪闭环**：研究落判断快照（记分卡）→ `replaceFalsifierRules` 登记价格线与基本面线 → worker 巡检触发通知 → 业绩复盘 workflow 骨架；`position_alert` / `review_reminder` 已接 Temporal 调度；静默时段在 `insertNotification` 唯一咽喉处拦截。
- **真流式**：`/api/ask` SSE 真实转发 provider delta（按 ~24 字符合并）；管线阶段事件驱动等待提示；用户可随时中止（`AbortController` 贯穿，中止不触发兜底重跑）。
  **首 token 未达标**：2026-07-17 实测 p50 3069ms、10 条抽样中 5 条超过 3s 门槛（`npm run qa:agent:live` 可复跑）。瓶颈是同业（Finnhub）与网页证据（Tavily）串在模型调用之前，属 IX-1 未完成项，不要再把"< 3s"当已达成。
- **门禁**：冻结表 CI 门禁 `check:frozen`（写入方零调用=表永远空；读取方零调用=数据白采，双向拦截）；**死请求字段门禁 `check:dead-fields`**（契约里有、生产零读取方=功能对用户不存在且不报错——2026-07 抓到 `compareWith`/`documents` 两条）；退役栈门禁 `check:retired`；契约输出 schema；删除闭环 E2E；canary 真探测驱动状态页。
- **智能分析回归**：`npm run qa:agent`（257 条语料跑真实生产函数，秒级）/ `npm run qa:agent:live`（15 条真实数据全链路抽样，含红线与死链路探针）。方法论见 [qa/methodology.md](qa/methodology.md)。

**已建 schema 但等消费方（全部在 `check:frozen` ALLOWED 记账，接回即解冻）：**

- 研究记忆：`research_facts` / `research_questions` / `review_dates`（→ RQ-3）。
- 历史估值分位、内部人交易两张表（→ RQ-5 / RQ-9，等数据源）。
- 反馈队列读取、FactGuard 硬失败明细、LLM 用量明细（→ IX-4 / RQ-4）。
- 团队 / 审计 / 计费 / 字段级来源登记（→ 第 5 节外部依赖，暂不排期）。

**已知诚实缺口**：模型额度（`ECHO_DAILY_MODEL_CALLS` 等）目前只在设置页展示用量与"已超限"状态，调用路径尚未强制拦截——接支付计费（第 5 节）时一并强制，不单独排期。

## 4. 路线图：研究质量（RQ）× 交互体验（IX）

两条主轴并行推进，每一项都必须用真实数据端到端验证后才算完成（只改接线会"成功"写入空值——见第 7 节冻结表模式）。

### 主轴一 · 研究质量（RQ）——每个数字都可核对，每个判断都可证伪

| # | 事项 | 依赖 |
| --- | --- | --- |
| RQ-1 | **引用可打开率校验**：网页证据 URL 逐条真实探测，打不开不进答案；每条证据带来源、发布时间、获知时间 | 无（Tavily 已接） |
| RQ-2 | **数字级可追溯全覆盖**：每个核心数字展示来源、口径、有效时间、获知时间与新鲜度；"未核到/口径冲突/来源过期"进统一待办 | 无 |
| RQ-3 | **研究记忆接线**：研究管线自动提取事实/未决问题/复核日期入 `research_facts` 等三表；解冻 `researchMemoryRepository` 全部条目 | 无 |
| RQ-4 | **factGuard 真实流量校准**：full 模式误报率/拦截率看板；设置页 FactGuardCard 消费 `getRecentHardFails` | 无 |
| RQ-5 | **历史估值分位**：美股先行（FMP 5 年年度 EPS + Yahoo 月度价格）；港股待 filing 回补 ≥5 个财年后解锁 | 美股无；港股回补是数据工程 |
| RQ-6 | **业绩复盘跑通完整财报季**：预期/实际/surprise 同屏 + 披露后 30 分钟第一版复盘（更高频轮询或 webhook） | 无 |
| RQ-7 | **港股 ADR 溢价**：逐条人工核实 9 家 ADR 比例后接 `dualQuote`；从价格反推是推断不是核实，禁止 | 人工核实 |
| RQ-8 | **财务深度**：应收/存货字段扩管道；季度→年化沿用 `epsAnnualized: false` 诚实标记模式 | 无 |
| RQ-9 | **一致预期与内部人交易**：同业锚加入分析师一致预期；美股内部人交易接入；港股用披露易权益披露自建 | **需采购**（第 6 节 ①③④） |
| RQ-10 | **管理层口径变化跟踪**：同一公司跨期 filing 的关键口径（FCF 定义、分部划分）变化显式提示 | 无 |

退出指标：引用可打开率 ≥ 99%；关键数字证据覆盖率 ≥ 95%；factGuard 硬失败误报率 < 5%；业绩复盘对真实日历跑通一个完整财报季；研究记忆在第二次研究同一公司时命中率 ≥ 80%。

### 主轴二 · 交互体验（IX）——把单次研究变成低摩擦的持续资产

| # | 事项 | 依赖 |
| --- | --- | --- |
| IX-1 | **流式体验打磨**：阶段事件全覆盖（取数/核对/成文）、骨架屏、失败恢复与断线续读。**剩余重点是首 token 延迟**：实测 p50 3069ms、5/10 超 3s，瓶颈是同业（Finnhub）与网页证据（Tavily）串在模型调用之前，需结构性改动（并行取数 / 证据后置补充）。中止能力与流式增量渲染已于 2026-07 完成 | 无 |
| IX-2 | **研究记忆浮现**：公司页与对话开场自动浮现上次结论、未决问题、下次复核日期（消费 RQ-3） | RQ-3 |
| IX-3 | **通知纪律**：日/周摘要只推有新证据/近证伪/即将披露的变化；通知有用率打点进核心看板 | 无 |
| IX-4 | **反馈闭环 UI**：答案内标记"数字错误/来源失效"，进可追踪队列（解冻 `listFeedback`），处理结果回流用户 | 无 |
| IX-5 | **全页面视觉复检**：375/768/1280 × 双主题逐页实跑；空态、加载态、错误态补齐；动效统一 | 无 |
| IX-6 | **导出体验**：Markdown 导出（已有）→ 带证据链与水印的 PDF | 无 |

退出指标：完成一家公司"提问 → 证据 → 估值 → 证伪 → 跟踪"的中位时间下降 40%；核心流程完成率 ≥ 70%；通知有用率 ≥ 70%；次周留存持续增长。

**取舍规则**：同一时间窗内 RQ 与 IX 冲突时，修复用户已能感知的断裂 > RQ > IX；任何新需求先过第 9 节优先级原则。

## 5. 外部依赖清单（等合同/基础设施，不排进当前主轴）

这些是商业化前提，依赖外部签约或采购，完成一项划掉一项；对应代码脚手架（团队/审计/计费/字段级来源登记 schema 与 repository）已就位并在 `check:frozen` ALLOWED 记账。

1. **港股商用行情源替换**（商业化第一阻塞）：现港股行情唯一真实源 Yahoo chart `commercialUseAllowed=false`，商用切流前必须换成已授权源（见第 6 节 ①）。
2. 托管 PostgreSQL、Temporal Cloud、对象存储、OTel 与告警在预生产完整接通；蓝绿切换、恢复、故障与降级联合演练（Terraform 已备，见 system-overview）。
3. `npm run test:load` 预生产实测并发研究、长报告、披露高峰与供应商限流。
4. 团队空间前端、细粒度权限 UI、共享模板与评论。
5. 支付集成与账单管理；密钥轮换与最小权限审计；渗透测试、隐私政策、数据处理协议与法务发布审查。

退出指标：RPO ≤ 24h、RTO ≤ 2h、核心 API 可用性 ≥ 99.9%；商用路由零未授权源；租户隔离与权限测试全绿。

## 6. 数据源配置清单（已有 / 缺失 / 在哪买）

> 判定标准：仓库里有真实适配器 + canary 探测通过才算"已有"；只有环境变量没有适配器不算（那是配置剧场，已在治理中清除）。价格以官网现价为准，下表只给采购入口。

### 已有（免费档即可运行）

| 能力 | 源 | 说明 |
| --- | --- | --- |
| 美股行情 | Finnhub → Yahoo 链 | `FINNHUB_API_KEY` 官网自助申请，已接熔断降级；Twelve Data / Alpha Vantage 已于 2026-07-20 收口删除 |
| 港股行情 | Yahoo chart 接口 | 免费无密钥；**不可商用**，商用前必须换源（第 5 节第 1 项） |
| 美股三表 + TTM 比率 | FMP `stable` 免费档 | `FMP_API_KEY`；免费档限额低，重度使用建议升级 |
| 财报日历（美股） | Finnhub `/stock/earnings` | 免费档可用 |
| 财报日历（港股） | HK→ADR 映射（自建，9 支人工核实） | 零采购 |
| 同业可比（美股） | Finnhub `/stock/peers` + `/stock/metric` | 免费档可用；港股 403 |
| 港股财务 | HKEX 一手 filing 解析管道（自建） | 零采购，护城河资产 |
| 网页证据 | Tavily 搜索适配器 | `TAVILY_API_KEY`，免费档 1000 次/月，超出需付费（见下） |
| 模型网关 | DeepSeek → OpenAI → 任意 OpenAI 兼容网关 | 密钥在各平台充值购买 |

### 缺失（需采购或配置，按优先级）

| # | 能力 | 推荐渠道 | 链接 | 备注 |
| --- | --- | --- | --- | --- |
| ① | **港股商用行情**（商业化第一阻塞） | EODHD All-World 或更高档 | <https://eodhd.com/pricing> | EOD 全球覆盖便宜；港股实时/延迟需在其上加交易所授权费 |
| | | iTick（港股实时 API 转售商） | <https://itick.io> | 亚太行情起家，个人/商用分档 |
| | | HKEX OMD 官方授权 vendor 名单 | <https://www.hkex.com.hk/Services/Market-Data-Services> | 终极正路：任何"可商用展示"都要落到 HKEX display license |
| ② | **港股三表 API**（补充自建 filing、解锁 5 年回补） | FMP Premium/Ultimate | <https://site.financialmodelingprep.com/pricing-plans> | 实测免费档港股三表返回 "Premium Query Parameter"，付费即解锁 |
| ③ | **一致预期 / 目标价**（RQ-9 同业锚） | Finnhub 付费档 | <https://finnhub.io/pricing> | 免费档无 analyst estimates |
| ④ | **内部人交易**（RQ-9，解冻 `insiderActivityRepository`） | 美股：Finnhub 付费档或 FMP | 同上两条 | 港股走披露易权益披露自建：<https://di.hkex.com.hk>（免费一手） |
| ⑤ | **网页证据付费配额**（RQ-1 上量后） | Tavily 付费档 | <https://www.tavily.com> | 免费 1000 次/月耗尽后按量付费 |
| ⑥ | 美股行情升级（可选，非阻塞） | Polygon.io | <https://polygon.io/pricing> | 仅当免费链路新鲜度/限额不够时再买 |
| ⑦ | 模型额度 | DeepSeek 平台 / OpenAI 平台 | <https://platform.deepseek.com> / <https://platform.openai.com> | 预算护栏 `ECHO_DAILY_COST_USD` 已内置 |

**采购纪律**：买任何一档前，先用免费/试用档对目标票池发真实请求核实字段确实存在（第 7 节事实表全部来自实测，供应商宣传页不算数）；适配器授权元数据 `commercialUseAllowed` 只在拿到书面授权后翻真，router 的 `commercialMode` 默认关闭，商用切流时才显式开启。

## 7. 数据可得性事实表（全部为实测结论，勿重新推导、勿凭直觉推翻）

| 事项 | 实测结论 |
| --- | --- |
| Finnhub / Twelve Data 免费档 | 美股行情可用；港股直接"无权限/需付费计划"。Finnhub `/stock/peers`、`/stock/metric` 美股可用、港股 403；`/calendar/earnings` 只覆盖美股，不带 `from/to` 参数会静默返回空数组。Twelve Data 适配器已于 2026-07-20 删除（与 Finnhub 完全重复），事实保留备考 |
| Alpha Vantage | 无 HKEX 原始代码（SYMBOL_SEARCH 只命中法兰克福/伦敦/ADR 挂牌）；25 次/天，只配美股末位兜底。适配器已于 2026-07-20 删除，事实保留备考 |
| FMP `stable` | 美股三表 + TTM 比率可用（用它的 `priceToEarningsRatioTTM`，勿拿季度 EPS 反推 PE）；港股三表一律"Premium Query Parameter"；legacy v3 端点已退役（200 状态但返回错误体）；`profile` 无 ADR/underlying 字段，`search-name` 模糊匹配不可靠 |
| Yahoo chart 接口 | 港股行情唯一真实源；`range=5y&interval=1mo` 免费给 61 个月度历史点、无需密钥；**`commercialUseAllowed=false`，商用前必须换源** |
| HK→ADR 映射 | 只能人工核实维护（`hkAdr.ts`，9 支，每条经真实 Finnhub 调用核实）；自动发现两条路径都不可靠，错配代价（自信地给错日期）比"未核到"更糟 |
| ADR 比例 | 每家不同（腾讯 1:1，阿里 1:8），必须去存托银行/官方披露逐条核实；从价格反推是推断不是核实，禁止 |
| 港股 capex/FCF | 简明现金流量表只给"投資活動耗用淨額"（不是 capex）；非 GAAP 摘要表列数每份都变、权责制、本期在首列；各家 FCF 定义不同（腾讯含媒体内容与租赁负债扣减，按 OCF−capex 算差 14%）。**正确路径：解析公司自报 FCF**（"自由現金流為人民幣 567 億元"），一手事实、公司自己背书；注意億/百萬单位混用与季度→年化 |
| EPS 年化 | filing 给的是累计值，直接反推 PE 会虚高 2–4 倍（曾给腾讯算出 70.9x，真实 18–25x）；必须 `deriveAnnualEps` TTM 年化，缺上一财年数据时标 `epsAnnualized: false` 并禁用所有 PE 反推/相乘方法 |
| 历史估值分位 | 价格免费（Yahoo 5y 月度）；瓶颈是年度 EPS 深度——美股 FMP 给 5 年可直接做，港股 filing 表现存仅 1–3 期，需回补 |
| 同业倍数 | 必须设可比上限（PE 100x / EV-Sales 50x）过滤离群 peer（曾因 TTM 盈利趋零的 peer 把锚点中位数抬到 366x）；先过滤可定价再截断数量。**防线必须在领域层的每一个出口上都成立**：2026-07 实测发现上限只在锚点生效，提示词的"同业对照"清单仍把被排除的 BIDU 647.5x 原样打印并授权模型引用，于是"百度PE 647.5x"照样经散文到达用户——数字换条路就绕过了防线 |
| 估值兜底 | **禁止任何"以现价为中心"的估值带**（`base = 现价`、`bear/bull = 现价×常数`）。它读起来像估值，实际是把现价换了个说法：公司信息被代数约掉，赔率恒为常数（实测 1.27，对每家公司都一样），而且越是缺数据的标的越会落到兜底、于是越"有"估值。2026-07 已删除两处（`displayValuation` 的「PE 区间」与 `computeValuation` 的「简单 PE」），缺口径就诚实 `cannotValueReason` |
| 冻结表模式 | 本仓库头号缺陷类型："写好了没人调"不报错、不告警、只是永远不生效。`check:frozen` 双向拦截（写入方零调用/读取方零调用）；接回任何冻结资产必须用真实数据端到端验证，只改接线会"成功"写入空值。**同一个病还有别的形态**：①死请求字段（契约里有、前端发、后端零读取——`compareWith`/`documents` 各静默数月，UI 还在承诺功能存在）由 `check:dead-fields` 拦截；②死防线（领域层算对了、在渲染/提示词边界被丢弃，见上方"同业倍数"）；③同义反复（函数返回了"数字"，但它只是输入的常数变换，见上方"估值兜底"）。这三类单元测试全绿、类型全过、CI 干净，只有"拿真实问题跑真实链路再读输出"抓得到——`npm run qa:agent:live` |

## 8. 发布门禁

本地与 CI 必须全部通过：

```bash
export DATABASE_URL=postgresql:///echo_dev
npm install
npm run db:migrate
npm run lint
npm run check:retired
npm run check:frozen
npm run check:dead-fields
npm run qa:agent
npm run typecheck
npm run lint:rust
npm test
npm run test:e2e
npm run build --workspace @echo/web
npm run db:recovery-drill
```

同时满足：

- 仓库扫描不存在已退役入口、文件数据库依赖、迁移兼容层或提交的密钥与构建产物；`.env.example` 里每个变量都有真实代码消费方。
- 冻结表门禁：repository 导出函数零生产调用方即失败；例外须在脚本 `ALLOWED` 记账并写明解除条件，重新有调用方后门禁强制删除该条目。
- 契约门禁：核心 tRPC 输出全部过 zod 输出 schema；前端类型从契约推导，禁止 `Record<string, any>` 直连页面。
- 删除闭环 E2E：看盘移除、持仓删除、研究会话删除均含"删除 → 强制刷新 → 不复活"断言，并在注册了 Service Worker 的 preview 构建下跑一遍。
- canary 真探测：`npm run canary` 对每个已注册外部适配器发真实请求，状态页只展示探测结果，不展示配置态。
- 全新 PostgreSQL 数据库可迁移、首次启动并完成私有数据写入；备份可在隔离数据库恢复，关键表数量、约束和强制 RLS 保持一致。
- 生产切流前完成数据授权核对、密钥配置、容量验证（`npm run test:load`）、回滚和蓝绿切换演练。

## 9. 优先级原则与核心看板

所有新需求按以下顺序取舍：

1. 是否修复用户已能感知的断裂（存在时一票否决其他需求）。
2. 是否提高事实正确性、证据可追溯性或风险可见性（RQ 主轴）。
3. 是否缩短核心研究闭环、减少打扰与供应商故障带来的不确定性（IX 主轴）。
4. 是否加深护城河——港股一手数据管道与数据可得性 know-how、防幻觉工程栈、证伪闭环与研究资产沉淀、双时态底座——而不是单纯增加页面和模型调用。
5. 是否能用明确指标和真实用户行为验证。
6. 是否保持唯一架构与唯一契约，不引入第二套 API、数据库、调度器、前端实现或字段形状。

核心看板至少跟踪：证据覆盖率、严重数字错误率、数据源真实命中率、研究完成时间、核心流程完成率、删除闭环回归通过率、通知有用率、次周留存、API 可用性、首 token 时间、单位研究成本和恢复演练结果。
