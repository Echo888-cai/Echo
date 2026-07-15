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

- [x] 行情多源：Finnhub / Twelve Data / Alpha Vantage 已实现为 `packages/data-plane/src/adapters/{finnhub,twelveData,alphaVantage}QuoteAdapter.ts`，接入 `registry.ts` 的 `liveQuoteAdapters`。真实调用三家免费档确认过覆盖边界：Finnhub 与 Twelve Data 免费键完全没有 HK/CN（`0700.HK`/`600519.SS` 直接返回"无权限"或"需付费计划"）；Alpha Vantage 的 HK 相关 SYMBOL_SEARCH 命中只有法兰克福/伦敦/美股 ADR 挂牌，不是 HKEX 原始代码——三者 `supports()` 因此如实只声明 US，HK/CN 仍只有 Yahoo 一路真实覆盖，不是"多源覆盖假象"。qualityRank：Finnhub(1)/Twelve Data(2)/Yahoo(3)/Alpha Vantage(4，25 次/天配额最紧，仅作最后兜底)。`router.ts` 新增 `selectAdapterChain`，`registry.ts` 的 `fetchLiveQuote` 按序尝试整条链，配合新增的 `circuitBreaker.ts`（连续 3 次失败熔断 5 分钟）在某源故障时自动降级到下一个，而不是把单源故障直接暴露为整条链路失败——之前这条降级路径完全不存在（`fetchLiveQuote` 只取 router 选出的单一适配器，失败就是失败）。真实回测：AAPL 命中 finnhub；把 `FINNHUB_API_KEY` 改成假值后自动降级到 twelvedata；0700.HK/600519.SS 始终落在 yahoo。`canary` 真探测：`packages/data-plane/src/canary.ts`（`npm run canary`）对每个已注册适配器发真实请求并写入 `canary_runs`，`apps/api/src/status.ts` 的 `market` 状态改为从这些真实探测结果推导（此前硬编码 `status:"ok"`），实测输出"4/4 行情源探测成功"。踩过一个真实坑：`canary.ts` 一开始把 `registry.js` 放在静态 import，导致其模块顶层读取 `process.env.FINNHUB_API_KEY` 时 `.env` 还没被 `loadRootEnv()` 加载（ES 模块 import 提升早于本文件顶层代码执行）——只探测到 yahoo 一个源；改成沿用 `apps/api/src/server.ts` 已有的模式（`loadRootEnv()` 后 `await import()` 动态加载）后四个源全部探测成功。仍待做：网页证据（Tavily，已尝试实现，见下方"暂停"记录）尚未接入，`hasWebSearch` 在 status.ts 里仍是装饰性的 env-key 判断。
- [x] 财务基本面：`packages/data-plane/src/adapters/fmpFundamentalsAdapter.ts` 接入 FMP `stable` API（美股三表 + TTM 比率），注册进 `registry.ts` 的 `fundamentalsAdapters`（仅 `FMP_API_KEY` 已配置时）；`runResearch`（`packages/application/src/research.ts` 新增 `getUsFinancials`）美股分支不再恒为 `[]`，改为真实调 `getFundamentals`，失败或未配置降级为 `[]` 而非整体报错。真实探测确认过 FMP 免费档边界：legacy v3 端点已退役（200 状态但报"Legacy Endpoint"错误体），改用 `stable` API；`profile`（quote 级）对 HK/CN 也有真实数据，但三张报表端点（income/cash-flow/balance-sheet-statement）对非美股一律返回"Premium Query Parameter"——因此 `supports()` 如实只声明 US，HK/CN 财务继续由一手 filing 管道提供，FMP 从不冒充覆盖不到的市场。真实回测（AAPL）验证并修了一个由本项改动首次激活的估值 bug：`displayValuation` 此前从未见过非空的美股 `financialsData.eps`（因为美股财务此前恒为空），一旦真数据接入，`valuation.js` 里 `pe = price / financialsData.eps` 这条兜底路径就被触发——`eps` 是单季度值而非年化，对苹果这类有季节性的公司算出 158x 的荒谬 PE（真实 trailing PE 约 38x）。修法是让 `fmpFundamentalsAdapter` 额外拉 `ratios-ttm` 拿 FMP 自己算好的真实 trailing PE（`priceToEarningsRatioTTM`），经 `toDomainSources` 接到 `marketSnapshot.pe`，价内 `valuation.js` 优先用它而不是拿季度 EPS 反推——回测确认修复后估值带的 `keyAssumptions` 从"PE 158x"变为"PE 38.3x"。港/A 股同一逻辑位置的 `financialsData.eps`（来自 filing 季度行）此前也确认存在同款 bug：0700.HK 用 Q1 累计 eps=6.433 直接反推 PE 算出约 70.9x，而腾讯真实 trailing PE 常年在 18-25x 区间。已修复：`research.ts` 新增 `deriveAnnualEps`，用已抓取的最近 4 期 filing 历史（`本期累计净利润 + 上一完整财年净利润 - 去年同期累计净利润` = 真实 TTM 净利润）把 filing 的累计 eps 按同比例缩放成年化值，缺上一财年数据时诚实标记 `epsAnnualized: false` 而不是硬猜；`valuation.js` 的三处 PE 相关方法（兜底 PE 带、主 PE 方法、同业 PE 锚点、forward PE）全部加上 `epsAnnualized !== false` 门槛，只在 eps 是真年化值时才用它反推或相乘 PE。真实回测：0700.HK 与 600519.SS 修复后估值带的 `keyAssumptions` 均显示"PE 18.3x"（此前分别约 70.9x 和类似倍数的虚高值）。
- 网页证据：Tavily 适配器 + 引用可打开率校验（打不开的链接不进答案）；证据条目带来源、时间戳、获知时间。2026-07-14 尝试接入时发现 `TAVILY_API_KEY` 已超出套餐用量（真实调用返回"exceeds your plan's set usage limit"），按"真实调用验证优先于 mock"的原则未在没有真实响应可验证的情况下写死适配器，暂停在此——`.env` 里也没有 `SERPAPI_API_KEY` 作为退路。恢复配额或换新 key 后可继续。
- [x] 财报日历（美股 + 港股 ADR 映射）：`packages/data-plane/src/adapters/finnhubCalendarAdapter.ts` 接 Finnhub `/calendar/earnings`（真实探测确认端点不带 `from`/`to` 参数会静默返回空数组而非报错，端点本身只覆盖美股，HK 返回和行情/财务同款"无权限"），注册进 `registry.ts` 的 `calendarAdapters`。过程中发现 `postgresCalendarAdapter` 读的缓存表里已有几行 0700.HK/600519.SS 的"经 ADR 映射查到"数据，但 `upsertEarningsCalendar` 全仓库没有任何调用点——是此前某次未提交的临时脚本写入的冻结脏数据，永远不会刷新。核实后确认"HK 股票查其美股 ADR 代号的 Finnhub 财报日历"这条链路本身是真实可用的（用 `TCEHY` 查询会返回打着 `700.HK` 标签的真实条目，日期与冻结的旧数据一致），值得做成正式适配器而不是只清理数据：新增 `hkAdrCalendarAdapter.ts`，内置一张手工维护、每条都用真实 Finnhub 调用逐一核实过的 HK→ADR 映射表（Tencent/Alibaba/美团/小米/京东/平安/比亚迪/汇丰/中国移动共 9 支）；FMP 的 `profile` 端点没有 adr/underlying 字段（实测港股与 ADR 两份 profile 除公司名外无共享字段），`search-name` 按名字模糊匹配会把 TCEHY 和无关的 TCTZF 一起吐出来，两者都不可靠，因此没有做自动发现，只做小范围人工核实表，条目错配的代价（自信地给错日期）比"未核到"更糟。`registry.ts` 的 `getNextEarnings` 从单一 `selectAdapter` 改成 `selectAdapterChain` 逐个尝试直到拿到 `ok`：`hkAdrCalendarAdapter` 在端口层面只能声明整个 HK 市场都"支持"，未映射的港股会在它内部正确落到 `missing`，链式回退保证仍能继续尝试 `postgresCalendarAdapter`而不是直接判定整条链失败。同时给 `postgresCalendarAdapter` 加了 14 天新鲜度上限——这张表没有任何写入方，`fetched_at` 永远不会再变，超龄的 `ok` 行会被判定为 `missing` 并带上说明，而不是无限期地把一次性快照当成实时数据展示。真实回测：0700.HK/9988.HK 现在命中 `hk-adr-finnhub`（分别通过 TCEHY/BABA），日期与预期估值一致；未映射的港股（如 1234.HK）正确回退到 postgres 缓存的 `missing`；600519.SS（A 股无 ADR）不受影响，仍是诚实的 `missing`。同业（comp_peers）尚未接入，同样只在装饰性 env-key 判断里。
- [x] status/settings 页改为展示 canary 真实探测结果与最近成功时间；"配置了但探测失败"必须可见。`canary.ts` 此前只探测行情适配器（`market:*`），FMP 财务与 Finnhub/HK-ADR 财报日历适配器虽已接通却从不被探测，状态页只能退回 env-key 判断；现改为按能力分组（`market`/`financials`/`earnings`）逐个真实调用，`registry.ts` 新增 `listExternalFundamentalsAdapters`/`listExternalCalendarAdapters`（只暴露真正走网络的第三方适配器，探测 postgres 缓存适配器等于探测自己的库，会把缓存读伪装成供应商可用）。`status.ts` 的 `financials`/`earnings` 卡改由真实探测推导并在失败时点名未通过的源；真实回测：把 `FMP_API_KEY` 改成假值后，财务卡从"ok / FMP 已配置"变为"limited / 0/1 财务源探测成功；未通过：财务 · FMP"（这正是旧实现永远看不见的状态）。`news`/`comp_peers`/`web_evidence` 三张卡此前读 FINNHUB/ALPHAVANTAGE/TWELVEDATA 键就报 ok，但这些键只注册了**行情**适配器，仓库里根本没有新闻/同业/搜索适配器——已如实改为"未接通（P1 待办）"，不再用兄弟能力的密钥冒充存活证明（红线 2）。顺带修了三个真实 bug：①`npm run canary` 打印完 "complete" 后永不退出（postgres 连接池吊住事件循环），人肉 ctrl-C 无感，但计划中的定时/CI 探测会一直挂到超时——补 `closeDatabase()`，现 6.8s 正常退出；②设置页每一行的"最近成功 {时间}"恒为空：`getSourceHealthSummary` 的窗口函数列以 Postgres 文本形式返回（`2026-07-15 10:02:37.254059+08`），前端 `notifWhen` 交给 `Date.parse` 的是空格分隔 + 两位时区偏移（`+08` 而非 `+08:00`），V8 一律判 NaN → 静默显示空白，正是本条要求的"最近成功时间"——在产生该格式的 `status.ts` 边界归一化为 ISO（而非放宽共享格式化函数）；③canary 健康面板在"状态来自真实数据调用，不是配置检查"的标题下，给 `网页证据层`/`同业可比` 这类**根本没有适配器**的能力常年打 ✓ 最近成功——它们是某个已删除的旧 canary 实现写入、再无写入方刷新的冻结脏数据（与 P1 财报日历那批同款），现按当前真实探测的 `capability:adapter` 源过滤，面板只剩 7 个真被探测的适配器。设置页"最近一批探测"取的是 `rows[0]`（按 source 名排序的第一个，不是最新一批），已改为取真实最新时间。
- 为每个核心数字展示来源、口径、有效时间、获知时间和新鲜度；建立"未核到/口径冲突/来源过期"统一待办。

退出指标：研究回答中行情/财务/网页证据三类源的真实命中率可度量并在状态页可见；所有"未核到"均有原因和下一步；引用可打开率 ≥ 99%。

### P2 · 研究质量重建（把领域层资产接回主链路）

目标：研究回答从"一次裸模型调用"升级为"多源事实 + 领域编排 + 数字护栏"的证据优先输出。这是产品差异化的本体。

- [x]（部分）`runResearch` 改为经 `answerComposer` 组装多源事实块，意图分类驱动提示词。此前提示词是手写的 4 行 `facts` 字符串（现价 + 财务一行 + 估值一行 + 既有主线），而 956 行的 `answerComposer` 从架构换血起就只在 `index.js` 里被 re-export、无任何调用方。现已接回：`packages/application/src/answerComposition.ts` 用真实端口实例化 `createAnswerComposer`（时钟/档案/意图分类/格式化都注入，领域包仍不碰 IO），`runResearch` 改用 `buildChatPrompt` 生成提示词——它会渲染公司档案（护城河/商业模式/多空/监控项）、真实 filing 财务块、我们自己算的估值区间、下一业绩日和竞品候选，并按 `classifyResearchIntent` 路由到专属段落结构。意图分类规则从旧底盘（`ce58d27:src/server/services/intentClassifier.js`，换血时随旧栈删掉）按新分层重新落位到 `packages/domain/src/intentClassifier.js`（纯规则属领域层）。真实模型回测：问"0700.HK 靠什么赚钱？"命中 businessModel 意图，输出"简单说/拆开看/关键判断/主要风险"专属结构而不是千篇一律的完整研究模板，正文引用真实三表数字（收入 1943.71 亿、净利率 30.4%、经营现金流 1013.51 亿）、真实估值区间与**真实下一业绩日 2026-08-12**（经本轮新接的 `getNextEarnings` → HK ADR 日历，此前研究链路完全没有这个源），factGuard 0 处 hard。顺带把无模型兜底也统一到 composer 的 `researchReplyFromPanel`：原 `deterministicAnswer` 输出的是另一套结构（`## 核心判断`…），即模型调用成功与否会静默改变答案版式，而 E2E 恰好只断言了兜底那套（CI 无模型 key），等于从未覆盖过模型路径；两条路径现在共用同一意图路由与同一段落结构，E2E 断言改为两条路径都产出的"结论"，并分别在有 key（走模型）和空 key（走兜底）下各跑一遍验证。模型正文额外过一遍 `normalizeResearchAnswer` 补齐北京时间前缀与"来源"段（真实回测中模型确实漏掉过整个来源段）。过程中修了两个真实 bug：①`keyDrivers` 的 summary 带句末句号，而 composer 模板自己会追加（`{summary}；同时`、`{status}。{summary}。`），渲染成"净利率 30.4%。。"——模块里本就有 `cleanSentence` 说明契约是"summary 不带句末标点"，改在生产端去掉；②只给 composer 传了 `dataSources.market`，而它按 `dataSources.financials/filings/news/estimates` 决定"还缺什么"段落与推断段能否下强结论——导致每篇回答都在引用了 filing 数字三段之后又宣称"本轮财报三表或公告口径还没补齐"，现按真实覆盖传全能力状态（news/estimates 如实为 missing，港/A 才算一手 filing）。仍待做：网页证据/同业/持仓上下文/对比与双重上市分支仍传 null（依赖 P1 未接通的源）。
- [x] `reportComposer` 承接深度报告：`runReport` 此前只是调 `runResearch` 再把 `content` 改名成 `markdown`——"深度研究"返回的就是用户刚读过的那篇对话回答，两者一字不差。现已拆开：`gatherResearchContext` 抽出共享的取数与 panel 构建（两种产物必须站在同一批数字上，只在渲染方式上分叉），`runReport` 改用 `buildReportPrompt`（判断优先的长文 Markdown：`## 核心判断 / 赚钱机制与护城河 / 财务质量 / 估值与赔率 / 风险与证伪条件 / 关键监控与下一步 / 来源`，1500-3000 字），无模型时由 `reportComposer.composeReport` 用同一份 panel 产出同构的本地报告。报告不过 `normalizeResearchAnswer`——那会在 `# 深度研究` 标题上面插一句"北京时间…最近的状态是："的对话式开场，那是聊天回答的口吻。真实回测：本地兜底 0.6s 出真实数字的完整 Markdown 报告；模型路径 20s 出约 3000 字深度报告，与同一公司的对话回答是两个明显不同的产物。
- [x] factGuard 两类真实误报修复（都由深度报告真实回测抓到，两类都会在 `full` 模式下拦掉正确答案、在 `soft` 模式下告诉用户对的数字是错的）：①降幅词只认写死的双字词名单（`下滑|下降|…`），模型写"同比微降1.1%""同比仅微降0.5%"这种完全正确的中文被当成 +1.1% 判 hard——降/跌/滑 前面可挂任意修饰语（微降/大降/骤降/环比降/略降），穷举不完，改成认词尾的方向字，并补"回升"反例守住不过度匹配；②"符号相反"的判定窗口宽到绝对值 1/3~3 倍，等于宣称"任何落在某个负数事实 3 倍内的正数都是它写错了符号"——模型写"增速超过 3%"这类假设性阈值（不陈述登记表里的任何事实）被拿去跟"今日涨跌幅 =-1.5%"比，2 倍差也算 sameBallpark 直接判 hard；真正的符号错误是照抄同一数字写反方向（1.1 vs -1.06、30.4 vs -30.4）、量级天然相等，故窗口收紧到 1.25 倍，这类假设性数字落回 soft（未核到），符合本模块"宁可漏报不可误报"原则。修复后同一篇报告 hard 从 3 → 0，对话路径同样 0 hard；域测试从 53 增至 56 条。
- [x] `factGuard` 接回输出校验（shadow/soft 模式已实装）：`runResearch` 用行情快照+最新一期财报构造事实登记表（`packages/application/src/research.ts` 的 `applyFactGuard`），对模型正文跑 `verifyAnswerNumbers`，写入 `fact_guard_audit`（此前"空转开关"，`getFactGuardStats` 永远为空的根因）；`FACT_GUARD_MODE` 默认 `shadow`，`soft`/`full`（`full` 的拦截+定向重答暂未实现，行为等同 soft，诚实标注）会在正文追加低调提示。真实模型回测（0700.HK）验证过一次关键 bug：`nativeCurrency` 必须取财报报表币种而非行情报价币种，否则港股通/A+H 这类"报价币种≠报表币种"的公司会把每一条真实引用的财务数字错判成 hard（跨币种换算路径把它们全部拿去和唯一的 HKD 现价比较）；修正后同一份回答从 20/47 处误判 hard 降到 0 处 hard。`valuation` 现已接入登记表（见下一条）；仍待做：同业倍数、历史分位接入登记表；`full` 模式的拦截+定向重答闭环；settings 页面暂无变化，等真实流量积累后 `FactGuardCard` 会自动出数。
- [ ] `factGuard` 覆盖率扩展：登记表接入同业倍数、历史分位后再推进 shadow→soft→full 路径。
- [x] 估值链路起步：`runResearch` 接回 `valuation.js` 的 `displayValuation`，用行情快照 + 最新一期财报算出真实 bear/base/bull 区间喂给模型（写进提示词，禁止模型自行编造倍数），估值数字同时进 factGuard 登记表交叉核对。真实模型回测抓到并修了一个 bug：`computeValuation` 会拿 `company.pe/price/pb` 当兜底，而 `getCompanyByTickerComplete()` 返回的是"约 18x"这类展示格式化字符串（不是数字），落地时把这类字符串当分母算出 NaN——修成只传 `{ticker, currency, sector}` 这三个干净字段，让估值只信任 marketSnapshot/financialsData 里真正是数字的字段，缺数据时诚实返回 `cannotValueReason` 而不是吐 NaN。仍待做：`historicalValuation`（历史分位）、行业估值路由、同业倍数（这些依赖尚未接通的数据源，见 P1）；估值计算目前仍是 JS 浮点（展示边界内的近似口径，未接 `finance-native`）。
- 财务质量红旗：`financialQuality`（盈余质量、现金流质量、应收/存货异常、资本化倾向）进公司画像与回答——数据库财报表暂无应收/存货字段，需先扩数据管道。
- [x]（部分）`AnswerCard` 的 `valuation` 字段：前端 `Valuation`/`ValuationNote` 组件本就存在渲染代码，此前从未收到过真数据；接回估值链路后自动出图，另修了"估值算不出来时静默不显示"的问题（`cannotValueReason` 现在会显示为一条说明，而不是整块消失）。仍待做：`evidence / grounding / analyst / dualQuote / completeness` ——这些字段依赖 P1 的网页证据/同业/分析师一致预期数据源，尚未接通。
- [x] 红线1 提示词加固：系统提示词此前只禁止"给买卖指令"，但真实测试发现模型会用"不建议追高买入"这类反向劝阻规避检测——本质仍是买卖指令。提示词已明确列出禁止的正反向措辞，改用"赔率偏低/偏高""性价比一般，等待更好的验证点"等纯研究语言；直接问"值得买吗？"验证过，回答不再出现买卖劝阻措辞。
- [x] 真流式：`/api/ask` 的 SSE 此前是"算完整段再假装打字机切片回放"（首 token 延迟＝全量生成时间）；`modelAnswer` 现在对 provider 发 `stream:true` 请求，真实解析 OpenAI 兼容的 SSE delta 帧，边生成边转发。真实回测：首 token 2.7s、全量生成 10.4s（此前用户要等满 10.4s 才看到任何字）。上线时被 E2E 抓到一个真实性能回归：provider 的原始 delta 太碎（单次真实调用产生 828 个小分片），逐个转发导致前端每次都重新渲染/解析累积 Markdown，把主线程钉死到"看盘"页面按钮点不动——服务端按 ~24 字符合并再转发（沿用旧版假流式的分片粒度，但现在是真的边生成边合并转发，不是生成完再切）解决，合并后 E2E 全绿。
- [x] `waitPhase` 阶段提示与管线阶段对齐：此前是纯墙钟时间轮播（`WAIT_PHASES` 固定 4 条文案，按 `busyElapsedSeconds()/5` 取下标），文案里"正在检索公开网页证据"这类步骤后端根本不存在，且真正耗时的 factGuard 校验发生在模型生成完之后却没有任何提示。`runResearch`（`packages/application/src/research.ts`）新增 `onStage` 回调，在 `resolving`/`market_financials`/`valuation`/`generating`/`fact_check` 五个真实节点触发；`/api/ask` SSE（`apps/api/src/rest-routes.ts`）新增 `status` 事件转发；前端 `chatStream`（`apps/web/src/lib/api.ts`）解析该事件，`researchStore.ts` 用 `STAGE_LABELS` 映射替换硬编码轮播。真实回测确认五个阶段事件按管线实际顺序到达。顺带在验证时抓到并修了一个真实 bug：`applyChatResult`（`apps/web/src/lib/researchActions.ts`）只在 `newlyWatched` 非空时才刷新看盘缓存，但首次研究新公司走的是 `portrait.created` 分支（toast 显示"已加入看盘"但看盘页缓存从不失效）——这正是 E2E `core-flow.spec.ts` 偶发卡在"等待＋添加按钮"超时的根因，现在只要 `result.portrait` 存在就会 `refreshWatchDesk()`。
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
