# Echo Research 技术架构

> 这份文档回答"现在系统长什么样、正在往哪走、为什么这么分层"。产品定位与阶段路线见 [PLAN.md](PLAN.md)（宪法，含 U 轨状态跟踪表）；重构的完整论证与六阶段计划见 [REFACTOR_PROPOSAL.md](REFACTOR_PROPOSAL.md)；单个重大技术决定的取舍留痕见 [adr/](adr/)。这三份互相不重复：这里只讲"结构"，不讲"为什么选这个"也不讲"接下来做什么"。

## 一句话

Echo Research 正处在绞杀者模式重构的中段：**生产流量仍然完全跑在旧底盘上**（`server.js` 单进程 + `src/`），**新底盘已经把大半功能原样搬了一遍**（`apps/` + `packages/`）但还没切流。两套并存不是意外，是设计——任何时刻主干可发布，新旧任一边出问题都能整体切回。判断"某个功能该改哪边"的第一原则：**改用户正在用的那边**（目前是旧底盘），除非任务明确是"新底盘迁移工作"本身。

## 旧底盘（生产在跑的这一半）

```
server.js                      ← 瘦 HTTP 路由 + 静态文件，npm run dev 的入口
echo.db                        ← SQLite（better-sqlite3，WAL 模式，21+ 编号迁移）
src/
├── app.js / styles/           ← 原生 ESM 前端，00-foundation → 07-brand 分层 CSS
├── market.js                  ← 市场识别唯一来源：detectMarket → HK/US/CN + 各源 symbol 拼法 + 币种
├── marketData.js / financialData.js / newsData.js / filingData.js / secFilings.js
│                               ← 按市场路由的数据适配（腾讯/新浪/Finnhub/FMP/CNINFO/HKEX…）
├── db/index.js                ← SQLite 连接 + schema + 迁移器
└── server/
    ├── routes/                ← chat · reports · companies · research · portfolio · watch …
    ├── services/               ← answerComposer · valuationEngine · financialQuality ·
    │                             factGuard · falsifyRules · eventEngine · dataSources ·
    │                             modelGateway · scheduler …
    ├── repositories/           ← 每张表一个 repository，唯一持有 SQL
    └── schemas/                ← 结构化输出校验（agentPanel）
```

单趟研究管线（`POST /api/chat`）：意图分类 → 并行采集（行情/财报/新闻/公告 + 网页证据）→ 估值 → 一次模型调用（超时则本地兜底，永远给判断不说"数据不足"）→ 证据并入决策面板 → 落库。深度研究报告复用同一管线，换一份 prompt。这条管线本身就是 REFACTOR_PROPOSAL §8 说的"诚实的置信度、可证伪的判断"在工程上的落地——每一层降级都是声明式的，不是祈祷。

## 新底盘（正在接管的这一半）

> **技术栈进行中调整**（[ADR-0003](adr/0003-hono-trpc-temporal-pivot.md)，2026-07-13）：`apps/api`/`apps/worker` 下方标的"当前实现"是已验证落地、测试全绿的代码；"计划替换"是一轮不考虑成本、只考虑技术审美的复核后的方向，尚未动工。已验证的模块和契约测试不作废——迁移是逐模块替换底层框架，不是推倒重来，路线表见 ADR-0003。

```
apps/
├── api/     @echo/api    — 当前实现：NestJS 模块化单体，17 个业务模块（auth/chat/research/
│                            portfolio/watch/companies/hkFinancials/discover/events/…），
│                            controller 用 packages/contracts 的 zod schema 做输入校验
│                            计划替换：Hono（HTTP 层，无装饰器仪式）+ tRPC（RPC 契约，直接复用
│                            现有 zod schema 做 procedure input parser，无需独立 OpenAPI 生成步骤）
├── web/     @echo/web    — React 19 + Vite + TS，router.tsx 按路由代码分割（login/research/
│                            portfolio/watch/settings），组件消费 @echo/ui 的 design tokens
└── worker/  @echo/worker — 当前实现：BullMQ 消费者；processor.ts 复用 scheduler.js 的
                             isDue/JOBS 定义，不重新实现调度逻辑，只换"谁来触发"
                             计划替换：Temporal——多步研究管线（深度研究报告生成/filing 抓取/
                             业绩闭环）需要的是可重放、可观测的 workflow 语义，不是"任务失败就整体
                             重试"；纯周期任务是否折进 Temporal Cron Workflow 视实测收益决定

packages/
├── contracts/  @echo/contracts — zod schema 单一源，前后端共享类型 + OpenAPI 生成；
│                                  tRPC 迁移后仍是 procedure input parser 与对外 OpenAPI 的共同源头
├── db/         @echo/db        — Drizzle + Postgres schema（core/auth/financials/portfolio/
│                                  research/notifications），sqlite-to-postgres.ts 做 ETL
├── data-plane/ @echo/data-plane — 供应商适配器矩阵：Quote/Fundamentals/Filings/Calendar 四个
│                                   端口 + 授权元数据路由 + qualityGuard（见 ADR-0001）
└── ui/         @echo/ui        — design tokens（tokens.css/tokens.ts），从旧底盘的
                                   00-foundation.css 机械提取，数值逐字节一致
```

领域核心（valuationEngine/factGuard/falsifyRules 等纯函数）保持 TypeScript，Rust/WASM 化明确列为远期选项——只有量化回测变成真实路线图项才启动，不是预防性投入（ADR-0003 §4）。

新底盘的每一层都是"搬家不重写"：`apps/api` 的 controller 结构和旧 `src/server/routes` 一一对应；`packages/data-plane` 的适配器包一层现有抓取函数，不重新实现行情/财报逻辑；`apps/worker` 复用 `scheduler.js` 的 `JOBS` 注册表，只是换了触发机制（BullMQ repeatable job 代替 60s 轮询）。这是 REFACTOR_PROPOSAL §1.2"结构的必然性"的具体执行：换底盘不等于推倒重来。

## 数据层：现状与目标

| | 现状（生产） | 目标（新底盘） |
|---|---|---|
| 存储 | SQLite `echo.db`，单文件，WAL | 托管 Postgres，多可用区 + PITR |
| Schema | `src/db/index.js` 里手写 SQL + 编号迁移 | Drizzle schema（`packages/db/src/schema/*`），迁移文件可审查的纯 SQL |
| 精度 | JS number（浮点） | NUMERIC + decimal 语义（金融数值不该用浮点，见 REFACTOR_PROPOSAL §4.3） |
| 财务事实的时间语义 | 覆盖式更新，重述抹掉旧值 | 双时态（`valid_time` + `knowledge_time`），财报重述追加新知识版本，不覆盖 |
| 多租户 | 应用层 `user_id` 过滤（红线 18） | 应用层过滤 + Postgres 行级安全兜底 |

一手数据管道（CNINFO 巨潮资讯网 / HKEX 披露易 PDF 抽取）物理上已经搬进 `apps/worker/src/pipelines/`（见 ADR-0002），但它们背后的 repositories 和 DB 连接还留在 `src/`——数据平面的存储层真正归属要等 Postgres 化（新底盘的 `packages/db`）落地后才有最终形态，现在是过渡态，不是终态。

## 数据平面：供应商适配器矩阵

`packages/data-plane` 把"每个数据源一个适配器 + 授权元数据 + 质量守卫"做成类型系统约束（ADR-0001 的完整决策记录）：

- **端口**：Quote / Fundamentals / Filings / Calendar 四个统一接口，News 因签名不同暂留占位。
- **授权路由**：`selectAdapter()` 按"授权允许 → 数据质量 → 延迟"选源；商用模式下没有已授权适配器就显式抛错，不静默退回免费源——合规从人肉纪律变成代码路径。
- **质量守卫**：`qualityGuard.ts` 校验量纲、币种、时效性、异常跳变，在数据"抓取成功但内容离谱"这个此前完全没人查的缝隙里当场抓到过一个真实生产 bug（A 股行情时间戳解析错误，见 ADR-0001）。
- **商用数据源接入**（替换腾讯/新浪免费源）明确未做，卡在 REFACTOR_PROPOSAL §7 决策清单 D6，需要询价签约后才有真实字段可填——这是产品/商业决策，不是本层的技术缺口。

## 前端：设计语言

两套前端共享同一套品牌气质，只是承载形式不同：

- **色彩语言**：暖纸底（`--bg: #f0eee6` 牛皮纸/oat）+ 暖墨（`--ink: #141413`）+ 陶土主色调（`--blue: #bf5c3e`，变量名沿用历史但语义是 book-cloth clay，不是蓝）。深色模式是同一套暖色语言的暖炭底版本，不是简单反色。
- **字体**：展示用衬线（Iowan Old Style/Charter/Songti SC）承载"研究札记"的气质，正文无衬线保可读性。
- **动效**：`--ease-spring`/`--ease-out` 等具名缓动曲线，不是随手写的 `ease-in-out`。
- **来源**：`packages/ui/src/tokens.css` 是从旧底盘 `src/styles/00-foundation.css` **机械提取**的（数值逐字节一致，禁止在提取时"顺手优化"），新旧两套 UI 因此像素级共享同一套视觉身份，不会出现"新版换了个马甲"的观感断裂。

旧前端（`src/app.js`）是单文件原生 ESM，两个路由（研究室/设置），事件委托驱动交互，localStorage 存研究状态。新前端（`apps/web`）是组件化的 React + TanStack 生态，路由和状态管理都类型化，但视觉上是同一个 Echo。

## 测试与验证

- `npm test`（根目录）：40+ 个编号 phase 测试文件，跑在旧底盘上，是当前唯一的门禁基线。
- 各 `apps/*` 有自己的 `npm test`（`apps/worker` 用 `node:test`，`apps/api`/`apps/web` 见各自 package.json）。
- `npm run canary`：真实数据源体感检查（不进 CI，退出码恒 0，是体检报告不是门禁）。
- 新旧两套后端目前没有共享的契约测试跑在同一份数据上——这是 REFACTOR_PROPOSAL R-0"契约测试覆盖全部端点并在旧实现上全绿"要补的部分，`packages/contracts/src/contract-tests/` 已有雏形。

## 部署与协作

运维手册（VPS 部署、systemd、Caddy、异地备份）见 [DEPLOY.md](DEPLOY.md)；双人协作与 GitHub 分支/PR 机制见 [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md)。这两份是操作手册，不是架构说明，所以没有并入本文档。
