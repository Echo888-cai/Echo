# Echo Research 终局计划（2026-07-13 · 唯一计划文档）

> **这是什么**：Echo Research 的**唯一**计划。它取代此前全部计划、分轨、候选池和决策草案；历史只存在于 git，不再进入当前仓库的认知表面。
> **怎么来的**：2026-07-13，决策者定调：清空所有分轨与候选池，以技术专家 + 金融分析专家 + 产品专家三重视角合议出一个最终方案；不设成本约束，不分短期长期，只以**极致技术美感**与**极致用户体验**为准则。所有决策已拍板（§3），没有"待定"。
> **给谁看**：任何接手的人或 AI 会话。自包含。执行就按 §4 的 1→7 顺序走，每一步有独立验收。

---

## 0. 一句话论点

Echo Research 的价值在**领域核心**（估值交叉验证、factGuard 防幻觉、三市一手财报管道、证伪闭环）与**品牌气质**（安静的研究札记），不在底盘。此前为了稳妥养了两套底盘并存（生产在旧、新底盘搭骨架），复杂度已经开始反噬心智。本计划只做一件事：**把灵魂完整搬到一个十年不用换血的底盘上，然后把旧底盘连同一切过渡态整体删除**——1→6 步完成换血，第 7 步在干净的地基上做金融纵深与商业化。任何时刻主干可发布，领域逻辑只搬家不重写。

---

## 1. 产品是什么（不变的灵魂）

面向港美 A 三市价值投资者的 **AI 研究台**：一条连续的研究对话，判断先行、证据溯源、诚实置信度；研究沉淀为公司画像与判断快照；证伪条件不是一句话而是被自动核对的规则——"以判断状态盯盘"是行情软件和通用 AI 都给不了的差异化。

四项核心资产（重写 = 毁灭价值，只许搬家）：

1. **一手财报管道**：CNINFO（A 股 91% 覆盖）/ HKEX PDF 抽取 / SEC EDGAR + Form 4。
2. **判断生产线**：valuationEngine（多法交叉验证）· financialQuality · falsifyRules（结构化证伪）· factGuard（每个数字对账）· answerComposer · eventEngine（事件分级去噪）。
3. **研究记忆**：会话 / 画像 / 判断快照 / 记分卡 / llm_audit / fact_guard_audit——未来回测与专有模型语料的地基。
4. **品牌**：牛皮纸暖底 + 墨色 + 陶土主色 + 具名缓动曲线的静谧动效；`packages/ui` design tokens 是它的工程形态。

北极星指标：每周主动打开 ≥3 天的用户比例；辅助：盘前速报点开率。

---

## 2. 终局架构（唯一目标形态）

```
apps/
├── web      React 19 + Vite + TanStack Query/Router + @echo/ui
│            唯一前端；PWA（离线壳 + 推送）；SSE 流式研究对话
├── api      Hono + tRPC，无状态 ×N
│            鉴权/限速/CSRF 是普通中间件函数；对外 REST/OpenAPI 由 tRPC 适配层导出
└── worker   Temporal worker
             深度研究管线 / filing 抓取解析 / 业绩闭环 = 可重放的 Workflow
             盘前速报 / 备份 / 证伪核对 = Cron Workflow；一手管道代码住这里

packages/
├── domain     TypeScript 领域门面：身份/意图/证伪/factGuard/答案编排/事件分级
│              零框架依赖，只表达业务规则；所有金融数值经 finance-core，不自行算钱
├── contracts  zod schema 单一源 → tRPC procedure input + OpenAPI 导出 + 契约测试
├── db         Drizzle + PostgreSQL：结构化 schema、NUMERIC、RLS 兜底、
│              双时态财务仓库（valid_time + knowledge_time，重述不覆盖）
├── data-plane 供应商适配器矩阵：Quote/Fundamentals/Filings/Calendar/News 端口
│              + 授权元数据路由（未授权源商用环境不可选）+ 质量守卫入库检查
└── ui         design tokens + 组件；品牌资产的唯一来源

crates/
└── finance-core  Rust 金融数值内核：Money/Currency/Ratio、估值、组合与回测原语
                  rust_decimal、无二进制浮点、黄金向量；经原生绑定只暴露窄 API

基础设施：托管 Postgres（HK 区，多可用区 + PITR）· Temporal Cloud ·
对象存储（备份/文档）· OTel 全链路 → 托管可观测平台 · IaC · CI/CD
```

四个结构性的干净（技术美感的定义，验收时对照）：

1. **领域规则零框架、数值内核强类型**——`packages/domain` 不碰 IO，`finance-core` 不接受 JS `Number` 金额；
2. **契约单一源**——端与端之间只有可 diff 的 zod schema，没有口头协议；
3. **数据资产双时态**——系统永远记得"当时知道什么"，判断可复盘、可回测；
4. **失败有形态**——每层降级行为声明式（诚实说"未核到"，不编数字），被测试演练过。

---

## 3. 已拍板决策（全部终审，不再讨论）

| 决策 | 结论 | 一句话理由 / 被否决项 |
|---|---|---|
| 语言 | **TypeScript 产品/控制面 + Rust 金融数值内核** | React、API、工作流、供应商与 LLM 需要迭代速度；金额、比率、估值、组合和回测需要十进制定点、强类型与跨运行时确定性。否决全栈 Rust（产品层收益不足），也否决 JS `Number` 承载金融计算 |
| HTTP/RPC | **Hono + tRPC** | fetch-standard、零装饰器仪式、zod 直接复用、端到端类型推导；**否决 NestJS**（三套装饰器概念表达同一件横切逻辑，与"领域核心零框架"矛盾）——NestJS 版 `apps/api` 已于 2026-07-13 删除 |
| 编排 | **Temporal（Temporal Cloud）** | 多步研究管线需要"从失败步重放"的 durable workflow 语义；**否决 BullMQ**（只有整任务重试）——BullMQ 壳已删除；不自托管 Temporal Server（不设成本约束时托管是更高可靠性） |
| 数据库 | **托管 PostgreSQL + Drizzle**，AWS RDS 香港区（ap-east-1）多可用区 | RLS 兜底多租户、NUMERIC 承载金融数值、PITR；Drizzle 迁移是可审查纯 SQL；否决 Prisma / ClickHouse / 继续 SQLite（单机文件锁 + 无 RLS 是终局天花板） |
| 前端 | React 19 + Vite + TanStack Query/Router + zustand（少量本地态） | 类型化契约直连 tRPC；否决 Next.js（登录后应用无 SEO 诉求，SPA+CDN 更简单稳定） |
| 移动端 | **PWA 是唯一移动形态** | 研究札记场景 = 深度阅读，PWA（离线壳+推送+桌面图标）完整覆盖；**否决原生 App/Expo** |
| 领域核心载体 | `packages/domain` TypeScript 规则门面 + `crates/finance-core` Rust 内核；Node 走窄原生绑定，浏览器只消费服务端结果 | Rust 只占领正确性收益最高的数值边界；不在浏览器复制估值实现，不以 WASM 制造第二执行语义。迁移采用黄金向量双算，等价后删旧实现 |
| 服务形态 | 模块化单体（api/worker 两个部署单元） | 否决微服务：可预见规模内单体+清晰模块边界更稳定 |
| 行情数据商采购顺序 | A 股 **东方财富 Choice**（备选恒生聚源）；美股 **Massive（原 Polygon.io）Business**；港股优先 **Twelve Data Venture/Enterprise 延迟或 EOD 授权档**；美股标准化基本面优先 **Intrinio US Fundamentals**；自有一手管道永远是财报事实源与交叉验证层 | 免费/个人档只留非商用 beta；Massive 已有质量优先适配入口，只有合同明确允许 display/commercial 才可把授权标记切为真 |
| AI 平台 | modelGateway 独立模块：多供应商路由 + 每用户预算 + 语义缓存；黄金评测集（100–300 题）回归评分 | llm_audit / fact_guard_audit 既有积累直接成为评测基建 |
| 部署 | 香港区托管云 + IaC；蓝绿发布；expand-contract 迁移法；每月恢复演练 | 环境是代码，不是某台服务器上的手工记忆 |

---

## 4. 执行计划：1 → 7（严格顺序执行，每步独立验收）

### 1 · 领域核心独立成包

把 `src/server/services/` 里的纯判断逻辑（valuationEngine、financialQuality、falsifyRules、factGuard、answerComposer、eventEngine、companyPortrait、historicalValuation、insiderActivity、earningsCalendar）搬入 `packages/domain`——只搬家不重写，数据经端口注入，规则层不碰 IO。同步建立 `crates/finance-core`：先接管 Money/Currency/Ratio、百分比与估值原语，以相同黄金向量和旧实现双算；原生绑定、跨平台构建和生产回滚线齐备后逐个切换，切一个删一个旧数值实现。

**验收**：`npm test` 全绿（旧底盘行为等价）；`packages/domain` 零运行时依赖；`cargo fmt + clippy + test` 全绿；金融金额/比率路径无 JS `Number` 新增使用；TS/Rust 黄金向量逐项等价。

### 2 · 后端换轨：Hono + tRPC

`apps/api` 以 Hono + tRPC 从零立骨：`packages/contracts` 的 zod schema 直接做 procedure input parser；鉴权（scrypt + 签名 HttpOnly cookie + CSRF）、限速、请求体上限全部平移为组合式中间件；SSE 流式回答保持现有交互契约；对外 REST/OpenAPI 由适配层导出。数据访问暂时继续走现有 repositories（SQLite），本步不动存储。

**验收**：契约测试（`packages/contracts/src/contract-tests/`）对新旧两个后端同绿；跨用户隔离用例在新后端全通；`apps/web` 全线改走 tRPC 类型化调用。

### 3 · 数据底盘：PostgreSQL + Drizzle

repositories 以 Drizzle 重写（`packages/db` schema 已有底子）：金额/股数/比率全部 NUMERIC + decimal 语义；私有表 RLS 兜底（应用层 user_id 过滤照旧，双保险）；财务事实进双时态仓库（重述追加新知识版本，不覆盖）；JSON-in-TEXT 列结构化。`sqlite-to-postgres.ts` ETL 幂等可重放，新旧库双跑对比等价后，SQLite 退役。

**验收**：ETL 后新旧库各跑契约测试输出等价；RLS 越权查询在数据库层被拒（专项测试）；一次 PITR 恢复演练成功。

### 4 · 编排：Temporal

三条多步管线 Workflow 化——深度研究报告生成、filing 抓取→PDF 抽取→结构化入库、业绩后闭环核对（actual vs 共识 vs 证伪线）；周期任务（盘前/盘后速报、每日备份、触线检查）转 Cron Workflow。60s 轮询 scheduler 与"任务失败整体重试"的时代结束：失败从失败那一步重放，全流程可观测。

**验收**：故意在管线第 N 步注入失败，验证从第 N 步恢复而非从头重跑；Temporal UI 能看到每条研究管线的完整轨迹；旧 scheduler.js 退役。

### 5 · 体验完全体：React + PWA

`apps/web` 补齐并超越旧前端全部能力：研究对话（SSE 流式 + 结构化答案卡 + 证据溯源 + 数据接地条 + 置信度 + 估值区间条）、发现层（筛选器/宏观）、持仓、看盘、画像、通知中心、onboarding、反馈、设置、分享图导出；PWA（离线壳 + 推送 + 安装引导）。UX 打磨是验收维度而非可选项：空状态全检、动效克制且可关（具名缓动曲线）、暗色主题同一暖色语言。

**验收**：旧前端功能清单逐项对照全覆盖；三档视口（375/768/1280）× 双主题实跑走查；Lighthouse PWA 检查通过；核心链路（研究→关注→持仓→通知）真实账号全通。

### 6 · 切流与旧底盘退役

生产流量切到新底盘（api + worker + web）；确认稳定后**整体删除** `server.js`、`src/`、根 `index.html`、全部 `tests/phase-*.mjs`。测试体系重建为三层：`packages/domain` 单测 + 契约测试（唯一后端）+ Playwright e2e（核心链路）。部署收敛为 IaC + 蓝绿发布 + OTel 全链路 + SLO 仪表盘（API 可用 99.9%、首 token P95 < 3s、管道日更成功率 99%、RPO ≤ 5min、RTO ≤ 30min）。

**验收**：旧底盘代码从主干消失；CI 三层门禁全绿；一次完整灾难恢复演练成功；SLO 仪表盘上线并有数据。

### 7 · 金融纵深与商业化发布

**金融纵深**（全部建在 `packages/domain`）：

- **盈余质量红旗**（最高优先，一手数据上的最大差异化）：应收/存货增速背离收入、经营现金流长期背离净利润、商誉/净资产占比、大存大贷——"赚得真不真"，不只"赚多少"。
- **估值行业路由**：银行/保险看 P/B、拨备、内含价值；地产/REIT 看 NAV/FFO；强周期看正常化盈利 + P/B 分位（周期顶低 PE 是陷阱）；取不到就诚实说。
- **A/H 溢价**：双重上市溢价率进估值锚（现成数据 + 现成路由）。
- **业绩期视图**：本周财报日历 × 我的证伪线 × 共识预期一屏（素材全现成，纯组装）。
- **证伪线温度计**：距离 + 趋势的渐进预警（毛利率连续三期向证伪线漂移不再沉默）。
- **未决问题闭环**：研究时沉淀"还需核实什么" → 下轮自动带出 → 数据到货提醒。

**商业化**：数据商签约按 §3 顺序落地进适配器矩阵 → factGuard 以落库真实误报率升 soft/full → 订阅计费（微信/支付宝）→ 第三方渗透测试 → 法务意见（研究工具/证券投资咨询边界 + 部署区域合规）→ 公开发布。发布前保持免费邀请制不宣传。

**验收**：红旗/行业路由有黄金问题集回归用例；商用环境授权路由无未授权源可选；渗透测试报告闭环；计费端到端真实走通一单。

---

## 5. 宪法（永久红线，任何步骤不得违反）

1. **不给买卖指令**——只输出研究判断、监控条件、风险检查点。
2. **不编数字**——取不到就"未核到"；近似口径显式标注；股东回报只认交易所一手。
3. **用户资产全私有**——私有表查询缺 user 过滤 = bug 级事故（应用层 + RLS 双保险）；跨用户可见必须是显式产品决策。
4. **涉及真实用户数据的 schema change 必须非破坏性迁移**，迁移前强制备份。
5. **密钥只存服务端环境**——不进日志/库/前端/git；用户不需要也不能配置自己的 key。
6. **未获商用授权的数据源不得出现在商用路径**——由适配器授权路由在类型系统层保证；拿到授权前免费、邀请制、不公开宣传。
7. **factGuard 升档只认落库的真实误报率**，不认手感。
8. **组合净值不造历史**——缺日就是断口，不插值不回填。
9. **UI 改动必须三档视口 × 双主题实跑验收**；动效克制且可关闭。
10. **金融数值不用浮点承载**——存储用 PostgreSQL NUMERIC，计算用 Rust `rust_decimal`；JS `Number` 只许存在于尚未迁完的旧实现和展示边界，且每迁一处必须删除旧实现。
11. **canary 与真实数据体检不进 CI**——CI 无 key、不烧配额。
12. **任何时刻主干可发布**——领域逻辑只搬家不重写；每步有回滚线。

---

## 6. 现状底账（2026-07-13，接手先核对这张表）

| 区域 | 状态 |
|---|---|
| 生产（用户在用） | 阿里云 VPS 仍跑稳定旧底盘：`server.js` + `src/` + SQLite；这是受控迁移起点，不会在新底盘未达等价前强切。多用户邀请制 beta、备份、systemd 与 Caddy 已上线（见 DEPLOY.md） |
| `apps/web` | React 外壳 + 登录/持仓/看盘/研究对话/设置五片已落地，未切流 |
| `apps/worker` | 一手 filing 管道（CNINFO/HKEX）住在 `src/pipelines/`，**旧底盘生产代码直接 import 它们**（这是共享资产不是遗留物）；BullMQ 壳已删除，Temporal 落地于第 4 步 |
| `apps/api` | Hono + tRPC 已重生并落下首个纵切：统一鉴权、健康检查、状态与公司搜索同时提供 REST/tRPC；直接复用旧 repository/service，已有协议与越权拒绝测试。完整路由迁移仍属于第 2 步，尚未切流 |
| `packages/domain` | 第 1 步进行中：估值、财务质量、风险、证伪、factGuard、研究复盘、金融格式化、业绩惊喜与历史估值分位已有唯一实现；零运行时依赖、无数据库/HTTP/环境 IO，并有架构边界测试。下一动作继续拆出答案编排、事件分级与画像蒸馏的纯核心 |
| `crates/finance-core` | Rust 数值内核已通过 `packages/finance-native` 的窄 N-API 边界接入生产业绩 surprise 链路；只收发十进制字符串，跨平台原生构建、黄金向量双算、fmt/clippy/test 已进入门禁。倍数估值与每股价值原语已暴露，后续逐条替换旧数值实现 |
| `packages/contracts` | zod 单一源 + OpenAPI 导出 + 契约测试（测试挂在旧 server.js 上跑，第 2 步起双跑） |
| `packages/db` | Drizzle + PostgreSQL schema、双时态财务表、校验和迁移账本、强制 RLS 与 SQLite→PostgreSQL 幂等 ETL 已落地；2026-07-13 在隔离 PostgreSQL 实库完成 32 张共享表行数/主键指纹对账和越权读写拒绝。尚缺托管 RDS、repository 切换与 PITR 演练，因此未切流 |
| `packages/data-plane` | 四端口适配器矩阵 + 授权路由 + 质量守卫已落地（曾当场抓到 A 股行情时间戳真实 bug） |
| `packages/ui` | design tokens 已从旧 CSS 机械提取（数值逐字节一致） |
| 工程治理基线 | 2026-07-13 完成：历史计划/ADR、废弃 NestJS/BullMQ 骨架、一次性脚本、生成物与零引用实现已删除；仓储/服务命名统一；重复 HTTP/时间/意图实现已收敛；路由与公司解析业务边界已纠正 |
| 测试门禁 | `npm test` 自动构建原生 Rust 绑定并覆盖旧底盘、domain、db、Hono/tRPC API、N-API 黄金向量与 Rust workspace；lint 零 warning；旧底盘与全部 workspace 都进入 typecheck；契约测试与 React build 进入 CI |

---

## 7. 怎么跑 + "完成"的定义

```bash
npm install                # 旧底盘唯一原生依赖 better-sqlite3
npm run seed               # 建/重置本地 SQLite 种子库
npm run dev                # 旧底盘 → http://127.0.0.1:4173（后端无热重载，改完重启）
npm test                   # 全量门禁，必须 EXIT=0 再提交
npm run lint && npm run typecheck && npm run typecheck:workspaces
npm run lint:rust && npm run test:rust
npm test --workspace @echo/contracts
npm run build --workspace @echo/web
npm run migrate --workspace @echo/db  # 必须显式提供 DATABASE_URL
npm run test:postgres --workspace @echo/db # 在真实 PostgreSQL 验证 RLS 越权拒绝
npm run etl --workspace @echo/db      # SQLite 只读迁移；幂等可重放
npm run verify --workspace @echo/db   # 行数 + 主键指纹对账
npm run doctor             # 能力体检；npm run canary 真实数据体检（不进 CI）
# 隔离运行：ECHO_DB_PATH=$TMPDIR/x.db PORT=4199 node server.js
# 新前端：cd apps/web && npm run dev
```

**一步改动的"完成" = 代码 + 测试（进门禁）+ 本文档 §6 底账更新 + 中文单行 commit + PR 过 CI。** 浏览器可见改动实跑验证（红线 9）；外部数据源改动真实调用验证；私有数据改动含跨用户隔离用例（红线 3）。

## 8. 执行纪律

- 仓库 `https://github.com/EchoResearchLab/Echo.git`；`main` 保护，所有变更经 PR，CI 全绿才合并。
- 永远只执行当前最小编号的未完成步骤；不另建分轨、候选方案、待决策清单或平行路线。
- 每个步骤只允许一个权威实现；迁移完成即删除旧实现与兼容壳，不保留“以后可能用”的代码。
- 本文档是唯一计划与架构决策来源；如需改 §3 或 §5，直接更新本文，不新增旁路文档。
