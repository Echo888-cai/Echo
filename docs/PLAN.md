# Echo Research 产品计划与验收底账

> 更新于 2026-07-14。本文是仓库唯一计划文档，取代 2026-07-13 版本；旧版的红线、架构与门禁已吸收进来，旧版第 3 节"架构换血完成底账"因与代码实况不符而废止，以本文第 3 节诊断底账为准。生产切流仍须本地验收、GitHub 必需检查和发布演练全部通过并由负责人批准。

## 1. 产品目标与永久红线

Echo Research 是面向港股、美股与 A 股价值投资者的证据优先 AI 研究台。北极星不是回答数量，而是让用户更快形成可复核、可持续追踪、能被新证据推翻的投资判断。

永久红线：

1. 不给买卖指令，只输出研究判断、监控条件和风险检查点。
2. 不编数字；取不到就明确显示"未核到"，近似口径必须标注。
3. 私有数据由应用层租户过滤和 PostgreSQL 强制 RLS 双重隔离。
4. 金额、股数、比率与估值不使用二进制浮点：存储用 `NUMERIC`，计算用 Rust 十进制定点；展示边界之外新增浮点金融计算即违规。
5. 密钥只存服务端环境；未获商用授权的数据源不得进入商用路径。
6. 组合净值缺日即断口，不插值、不回填。
7. UI 变更必须通过 375/768/1280 三档视口与双主题实跑。
8. 数据变更必须可恢复；发布采用 expand-contract 与蓝绿方式。
9. **（新增）端到端契约唯一**：tRPC procedure 的输入与输出都必须挂 zod schema（源在 `packages/contracts`）；前端不得读取契约之外的幻想字段，后端不得返回契约之外的私有形状。本轮排查证明"只校验输入不校验输出"必然导致前后端静默漂移。
10. **（新增）用户显式删除必须终局生效**：删除/移除操作在任何缓存层（React Query、Service Worker、公司画像并集、后台任务）之后都不得复活；每类删除都要有对应的"删除→刷新→不复活" E2E。

## 2. 唯一运行架构

```text
React/PWA ── tRPC + Hono SSE ── Hono API ── PostgreSQL
                                  │
                                  └── Temporal ── worker / filing / backup

packages/domain       纯领域规则、答案与报告编排
packages/application  研究用例编排
packages/contracts    zod 契约单一源（输入 + 输出）
packages/db           Drizzle、双时态财务仓库、强制 RLS
packages/data-plane   授权感知的供应商适配器
packages/ui           品牌与组件
crates/finance-core   十进制定点金融数值内核
```

端与端之间只有 zod 契约；领域包不接触 IO；多步任务由 Temporal 提供可重放语义；结构化研究数据保留 valid time 与 knowledge time。仓库布局见 [architecture/repository-layout.md](architecture/repository-layout.md)。

架构骨架已经就位并真实工作的部分：Hono+tRPC 边界、会话认证与邀请、Postgres 限流、租户 `withTenant` + RLS 迁移、双时态 `market_snapshots`、行情唯一入口 `ensureFreshMarketSnapshot`（15 分钟新鲜窗、外源失败退回旧快照、核不到即 null）、研究会话与公司画像持久化、LLM 调用审计、Temporal workflow/schedule 定义、IaC。

## 3. 现状诊断底账（2026-07-14 全链路排查）

这是本计划的事实基础。旧版声称"架构换血完成、React/PWA 覆盖研究/关注/持仓/画像/通知/引导"，排查结论是：**骨架完成，但研究质量层、数据源层和看盘/持仓的可用性都存在真实断裂**。修复顺序即第 5 节路线图。

### 3.1 已确认缺陷（按用户可感知程度排序）

1. **看盘删不掉、必复活**：`watch.untrack` 只往 `watchlist_prefs` 写 `mode="hide"` 墓碑（`packages/db/src/repositories/watchlistRepository.ts:25`），但整个生产代码没有任何地方读 `getHiddenTickers`；同时 `watchDesk`（`apps/api/src/app.ts:158`）把 watchlist ∪ 持仓 ∪ **全部公司画像** 并集成卡片，而每跑一次研究就会 `upsertCompanyProfile`（`packages/application/src/research.ts:136`）。结果：研究过的公司永久出现在看盘，移除后 refetch 立即复活。
2. **Service Worker 把所有同源 GET 做 cache-first 且永不失效**（`apps/web/public/sw.js:22`）：`/trpc/*` 查询和 `/api/*` GET 一旦被缓存就永远返回旧数据，缓存名 `echo-shell-v1` 从未升级。这是"持仓删了刷新又出现"的直接根因（删除 mutation 成功，但 refetch 被 SW 用旧响应应答），也让一切数据更新在装过 PWA 的浏览器里不可信。
3. **看盘列表前后端契约漂移**：API 卡片返回 `{state, price, changePct, thesis, ...}`，前端 `WatchList.tsx` 读的是 `status`（值域还是 `at_risk` 而非 `atRisk`）、`priceStatus`、`market`、`held`、`spark`、`earnings`、`topEvent`——全部不存在。结果：价格列恒显示"—"，证伪状态恒为"逻辑还在"，港/美/A/持仓/预警筛选全部失效，迷你走势图恒空。`WatchCard` 在 `lib/api.ts:56` 是 `Record<string, any>`，typecheck 拦不住。
4. **个股详情页契约漂移**：`watch.stock` 返回 `{company, profile, market, rules}`，前端 `StockDetail.tsx` 读 `series / fundamentals / events / watchRules`——价格曲线、基本面格子、事件流、证伪规则在详情页全部渲染为空。
5. **数据源"配置剧场"**：`FMP_API_KEY / TAVILY_API_KEY / FINNHUB_API_KEY / ALPHAVANTAGE_API_KEY / TWELVEDATA_API_KEY / EODHD_API_KEY` 在全仓库只有 `apps/api/src/status.ts` 引用，且只用来把设置页显示成"已配置/ok"。没有任何适配器调用这些供应商；行情实际只有 `yahooQuoteAdapter` 一个源。`.env` 注释承诺的"Alpha Vantage → Twelve Data → Finnhub → Yahoo 兜底"和"FMP 解锁真实 EPS/FCF/forwardPE"均未实现。这就是"研究功能数据源接通有问题"的本体。
6. **研究链路极浅**：`runResearch`（`packages/application/src/research.ts`）只拼"现价 + 港/A 本地财务表 + 既有画像主线"三行事实喂给一次 DeepSeek chat 调用，失败则回落到固定模板。美股财务恒为空数组；港/A 财务依赖 filing 工作流入库（本地 Temporal 未跑则同样为空）；无网页证据、无估值、无同业、无财报日历。`newsSnapshot: null`、`factGuard: null` 是硬编码。
7. **领域层 ~3200 行核心资产大半是死代码**：`answerComposer`（956 行）、`valuation`（462 行）、`financialQuality`、`historicalValuation`、`portraitRules`、`researchReview`、`reportComposer`、`eventRules`、`risk` 仍无人调用；生产只用了 `evaluateRule`、scorecard、company-identity，以及（2026-07-14 起）`factGuard`（488 行，`runResearch` 已接回 shadow/soft 模式，见第 5 节 P2）。前端 `AnswerCard.tsx`（787 行）期待的 `evidence / valuation / grounding / analyst / dualQuote / completeness` 等字段研究链路仍不产出，研究卡片实际还是裸 Markdown。
8. **Temporal 是隐性硬依赖**：`reports.generate`（深度报告）和 `/api/hk-financials/ingest` 直连 Temporal（`apps/api/src/temporal.ts`），本地没有 Temporal server 时这两个入口直接失败，没有降级路径，也没有任何 UI 提示原因。
9. **假流式**：`/api/ask` 的 SSE 是把同步算完的全文按 24 字符切片回放（`apps/api/src/rest-routes.ts:43`），首 token 等待时间等于全量生成时间，流式体验是装饰性的。
10. **Rust 内核未接线**：`@echo/finance-native` 没有任何 import 方；服务端盈亏/市值计算用 JS 浮点完成（`apps/api/src/app.ts:112` enrichPosition）。红线 4 当前只在存储层（NUMERIC）兑现了一半。
11. **组合体检半空壳**：`portfolioReview`（`apps/api/src/app.ts:129`）的 `weights / marketExposure / sectorWeights` 硬编码为空，而前端有完整渲染代码——组合权重、市场暴露、行业集中度永远不显示。
12. **引导进度硬编码**：`Onboarding.tsx:29` 的 `researched/watched/held` 全是 `false`，三步引导永远不会打勾。
13. **门禁测不到以上任何一条**：E2E 只测"添加"从不测"删除"，不断言价格真实显示；tRPC 输出无 schema；canary 状态页展示的是 env 配置态而非真实探测。这是缺陷能全部漏网的结构性原因。

### 3.2 结论

产品的骨架（认证、租户、持久化、行情快照、页面框架）是真实的，但"证据优先的研究台"这一层——数据源、证据、估值、防幻觉——目前处于**未接线**状态，且三个核心页面（研究、看盘、持仓）各有一个用户立刻能撞上的可用性断裂。下一步不是加新功能，而是按 P0→P2 把已有资产接回主链路。

## 4. 发布门禁

### 本地与 CI 必须全部通过

```bash
export DATABASE_URL=postgresql:///echo_dev
npm install
npm run db:migrate
npm run lint
npm run check:retired
npm run typecheck
npm run lint:rust
npm test
npm run test:e2e
npm run build --workspace @echo/web
npm run db:recovery-drill
```

同时满足：

- 仓库扫描不存在已退役入口、文件数据库依赖、迁移兼容层或提交的密钥与构建产物。
- 全新 PostgreSQL 数据库可迁移、首次启动并完成私有数据写入。
- GitHub 必需检查为绿色，契约、E2E、Temporal 故障恢复与 PostgreSQL RLS 测试均通过。
- 备份可在隔离数据库恢复，关键表数量、约束和强制 RLS 保持一致。
- **（新增）契约门禁**：`watch.desk`、`watch.stock`、`portfolio.list`、`ask` 的输出必须通过 `packages/contracts` 的 zod 输出 schema 校验；前端类型从契约推导，禁止 `Record<string, any>` 直连页面。
- **（新增）删除闭环 E2E**：看盘移除、持仓删除、研究会话删除三条流程都必须包含"删除 → 强制刷新 → 不复活"断言，并在注册了 Service Worker 的 preview 构建下跑一遍。
- **（新增）canary 真探测**：`npm run canary` 对每个已配置数据源做真实调用探测，状态页只展示探测结果，不展示配置态。
- 生产切流前完成数据授权核对、密钥配置、容量验证（`npm run test:load` 对预生产实跑）、回滚和蓝绿切换演练。

## 5. 路线图（严格按 P0 → P4）

### P0 · 可用性止血（当前迭代，不做完不允许做任何新功能）

目标：用户报告的三类断裂（研究数据源、看盘 bug、删除复活）全部闭环。

- [x] **修看盘删除复活**：`watchDesk` 构造 ticker 并集后应用 `getHiddenTickers` 墓碑过滤；画像/持仓并入的卡片同样受墓碑过滤，移除持久生效。涉及 `apps/api/src/app.ts`、`packages/db/src/repositories/watchlistRepository.ts`。
- [x] **修 Service Worker 缓存策略**：`/api/*` 与 `/trpc/*` 一律 network-only（离线返回明确错误，不返回旧数据）；静态资源改 stale-while-revalidate；`CACHE` 升级到 `echo-shell-v2` 并在 activate 时清旧缓存。涉及 `apps/web/public/sw.js`。
- [x] **修看盘列表契约**：`packages/contracts/src/watch.ts` 新增字段精确的 `watchCardSchema`（`status`/`priceStatus`/`market`/`held`/`returnPct`/`earnings`/`spark`/`topEvent`），`watch.desk` 挂输出 schema 并补齐字段，前端 `WatchCard` 类型从契约推导（`apps/web/src/lib/api.ts`）。
- [x] **修个股详情契约**：`watch.stock` 按 `stockDetailSchema` 返回 `series`（`market_snapshots` 历史，新增 `listRecentMarketSnapshots`）、`watchRules`（已求值的证伪结果）、`events`（HK/CN 走 filings 适配器，其余显式空数组）、`fundamentals`（未接通显式 `status: "unavailable"`，P1 接 FMP 后填充）。
- [x] **Temporal 本地开发路径**：新增 `npm run temporal:dev` 启动脚本；`reports.generate` 在 Temporal 不可达时降级为内联 `runReport` 并标注 `engine: "inline-fallback"`，前端 toast 提示；`/api/hk-financials/ingest` 同样不再裸 500，返回明确的 503 说明。
- [x] **组合体检补全**：`portfolioReview` 用真实持仓算出 `weights / marketExposure / sectorWeights`（近似 USD 汇率仅用于展示权重，不进入任何 NUMERIC 记账路径），契约同步收紧为字段精确 schema。
- [x] **引导进度接真状态**：新增 `preferences.onboardingProgress`（纯 DB 计数，不含行情/LLM 调用），`Onboarding` 三步从真实研究会话数、watchlist、持仓推导。
- [x] **门禁同步落地**：`tests/e2e/core-flow.spec.ts` 新增看盘移除、持仓删除的"删除 → 刷新 → 不复活"断言；`portfolio.review`/`watch.desk`/`watch.stock` 均已挂 tRPC 输出 schema。契约测试、DB/RLS 测试、Rust 测试、Playwright E2E、Web build、恢复演练本轮全部本地跑绿。

退出标准：三条删除闭环 E2E 全绿；看盘显示真实价格、涨跌与证伪状态；筛选可用；无 Temporal 环境下研究与报告可用且有诚实标注；用户三个原始报告问题复测通过。

### P1 · 数据源真实接通与证据层

目标：让设置页"已配置"的每一个源都真的在研究链路里产生数据；未接通的显示真实探测状态。

- 行情多源：把 Finnhub / Twelve Data / Alpha Vantage 实现为 `data-plane` 适配器，进授权感知 router（qualityRank 排序、超时熔断、逐级降级到 Yahoo）；每个适配器带真实探测 canary。
- 财务基本面：FMP 适配器（美股三表、TTM、forward PE、EPS/FCF），统一 fundamentals 端口；港/A 以 filing 管道为主、FMP 交叉验证口径；`runResearch` 的美股财务不再恒为空。
- 网页证据：Tavily 适配器 + 引用可打开率校验（打不开的链接不进答案）；证据条目带来源、时间戳、获知时间。
- 财报日历与同业：earnings 端口（Finnhub/FMP），喂给看盘卡片的"财报 {date}"位与业绩复盘工作流。
- status/settings 页改为展示 canary 真实探测结果与最近成功时间；"配置了但探测失败"必须可见。
- 为每个核心数字展示来源、口径、有效时间、获知时间和新鲜度；建立"未核到/口径冲突/来源过期"统一待办。

退出指标：研究回答中行情/财务/网页证据三类源的真实命中率可度量并在状态页可见；所有"未核到"均有原因和下一步；引用可打开率 ≥ 99%。

### P2 · 研究质量重建（把领域层资产接回主链路）

目标：研究回答从"一次裸模型调用"升级为"多源事实 + 领域编排 + 数字护栏"的证据优先输出。这是产品差异化的本体。

- `runResearch` 改为经 `answerComposer` 组装多源事实块（行情、财务、filing、网页证据、画像、持仓上下文），意图分类驱动提示词；`reportComposer` 承接深度报告。
- [x] `factGuard` 接回输出校验（shadow/soft 模式已实装）：`runResearch` 用行情快照+最新一期财报构造事实登记表（`packages/application/src/research.ts` 的 `applyFactGuard`），对模型正文跑 `verifyAnswerNumbers`，写入 `fact_guard_audit`（此前"空转开关"，`getFactGuardStats` 永远为空的根因）；`FACT_GUARD_MODE` 默认 `shadow`，`soft`/`full`（`full` 的拦截+定向重答暂未实现，行为等同 soft，诚实标注）会在正文追加低调提示。真实模型回测（0700.HK）验证过一次关键 bug：`nativeCurrency` 必须取财报报表币种而非行情报价币种，否则港股通/A+H 这类"报价币种≠报表币种"的公司会把每一条真实引用的财务数字错判成 hard（跨币种换算路径把它们全部拿去和唯一的 HKD 现价比较）；修正后同一份回答从 20/47 处误判 hard 降到 0 处 hard。仍待做：把 `valuation`/同业倍数接入登记表（目前只覆盖行情+最新一期财报，估值类数字仍多为 soft）；`full` 模式的拦截+定向重答闭环；settings 页面暂无变化，等真实流量积累后 `FactGuardCard` 会自动出数。
- [ ] `factGuard` 覆盖率扩展：登记表接入估值区间、同业倍数、历史分位后再推进 shadow→soft→full 路径。
- 估值链路：`valuation` + `historicalValuation` 产出估值区间与历史分位，行业估值路由（银行/保险/周期/消费/SaaS/生物科技选法）；估值计算走 Rust 定点内核（`finance-native` 接上真实调用方，兑现红线 4），或在明确的展示边界内标注近似口径。
- 财务质量红旗：`financialQuality`（盈余质量、现金流质量、应收/存货异常、资本化倾向）进公司画像与回答。
- `AnswerCard` 的 evidence / valuation / grounding / confidence 字段由链路真实产出，研究卡片恢复设计时的信息密度。
- 真流式：模型 provider 的 token 流直通 SSE，`waitPhase` 阶段提示与真实管线阶段对齐。
- 为答案与报告建立证据覆盖率、引用可打开率、结论可追溯率评分（`researchReview` 接回）。

退出指标：关键数字证据覆盖率 ≥ 95%；已知严重数字错误率 < 0.1%；首 token 时间 < 3s；研究回答中"未核到"来自真实探测而非未接线。

### P3 · 投资研究工作流与留存

目标：从"单次问答"进化为"持续跟踪的研究资产"。吸收原 P2/P3 全部未完成项。

- 业绩期驾驶舱：预期、实际、差异、管理层口径变化和下一次证伪点同一视图；业绩复盘在披露后 30 分钟内出第一版（`earningsReviewWorkflow` 已有骨架）。
- 证伪"温度计"：距阈值、数据时点和触发历史可解释展示（`evaluateRule` 已有 distancePct 基础）。
- A/H 溢价、跨市场可比、股本变化与回购稀释分析。
- 研究记忆自动沉淀"已确认事实、未决问题、观点变化和待复核日期"；日/周摘要只推送有新证据、接近证伪或即将披露的变化。
- 提醒强度、静默时段、来源偏好和研究模板可调；反馈闭环（标记数字错误/来源失效/结论无帮助）进可追踪队列。
- 新手引导、示例公司、空状态和失败恢复打磨：首次用户 10 分钟内完成第一份研究卡。UX/动效/视觉质量是一等验收维度。

退出指标：完成一家公司"提问 → 证据 → 估值 → 证伪 → 跟踪"的中位时间下降 40%；核心流程完成率 ≥ 70%；通知有用率 ≥ 70%；次周留存持续增长。

### P4 · 发布准备与商业化

目标：可信运行 + 团队协作 + 收费。吸收原 P0（发布准备）与 P4 全部内容——发布准备移到功能可用之后，因为在核心功能断裂时演练切流没有意义。

- 托管 PostgreSQL、Temporal Cloud、对象存储、OTel 与告警在预生产完整接通；蓝绿切换、数据库恢复、Temporal 故障和供应商降级联合演练。
- `npm run test:load` 对预生产实测并发研究、长报告、披露高峰和供应商限流，产出真实容量数字并校准伸缩阈值与 WAF 限速（已就绪的 IaC/限流/WAF 见 [architecture/system-overview.md](architecture/system-overview.md)）。
- 数据供应商商用授权清单、字段级来源登记、密钥轮换和最小权限审计；未授权源不得进商用路由。
- 团队空间、细粒度权限、共享模板、评论和审计日志；可控导出（Markdown/PDF、证据清单、观点变更记录、合规水印）。
- 套餐、用量、成本归因、预算上限和账单管理；渗透测试、隐私政策、数据处理协议与法务发布审查。
- 发布负责人、回滚阈值、事故分级和用户通知模板。

退出指标：RPO ≤ 24h、RTO ≤ 2h、核心 API 可用性 ≥ 99.9%；租户隔离与权限测试全绿；删除/导出请求可审计；法务与安全清单签署。

## 6. 产品指标与优先级原则

所有新需求按以下顺序取舍：

1. 是否修复用户已能感知的断裂（P0 未清零前，一票否决其他需求）。
2. 是否提高事实正确性、证据可追溯性或风险可见性。
3. 是否缩短核心研究闭环，而不是单纯增加页面和模型调用。
4. 是否减少打扰、重复劳动和供应商故障带来的不确定性。
5. 是否能用明确指标和真实用户行为验证。
6. 是否保持唯一架构与唯一契约，不引入第二套 API、数据库、调度器、前端实现或字段形状。

核心看板至少跟踪：证据覆盖率、严重数字错误率、数据源真实命中率、研究完成时间、核心流程完成率、删除闭环回归通过率、通知有用率、次周留存、API 可用性、首 token 时间、单位研究成本和恢复演练结果。
