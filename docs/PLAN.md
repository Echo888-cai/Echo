# Echo Research 产品计划与架构底账（v3）

> 更新于 2026-07-15。本文是仓库唯一计划文档，取代所有旧版本，可独立阅读，不需要任何前情。
> 定位调整：**只做美股与港股，核心研究对象是两地科技股；A 股退场**（退场步骤见第 5 节 P3 第一项）。
> 历史修复过程与排查记录不再保留在本文——可复用的结论已固化为第 6 节数据可得性事实表与第 7 节发布门禁；需要考古时看 git log 与已合并 PR。

## 1. 产品定位与永久红线

Echo Research 是面向美股与港股价值投资者的证据优先 AI 研究台。北极星不是回答数量，而是让用户更快形成可复核、可持续追踪、能被新证据推翻的投资判断。

永久红线：

1. 不给买卖指令，正反向措辞都算（"不建议追高买入"也是买卖指令）；只输出研究判断、监控条件和风险检查点，用"赔率偏低/偏高"类纯研究语言。
2. 不编数字；取不到就明确显示"未核到"，近似口径必须标注。不得用"我们没接这个源"冒充"这家公司没有这项数据"，反之亦然。
3. 私有数据由应用层租户过滤和 PostgreSQL 强制 RLS 双重隔离。
4. 金额、股数、比率与估值不使用二进制浮点：存储用 `NUMERIC`，计算用 Rust 十进制定点（`@echo/finance-native`）；展示边界之外新增浮点金融计算即违规。
5. 密钥只存服务端环境；未获商用授权的数据源不得进入商用路径（`packages/data-plane` 的 `authorization.ts` 强制执行）。
6. 组合净值缺日即断口，不插值、不回填。
7. UI 变更必须通过 375/768/1280 三档视口与双主题实跑。
8. 数据变更必须可恢复；发布采用 expand-contract 与蓝绿方式。
9. 端到端契约唯一：tRPC procedure 的输入与输出都必须挂 zod schema（源在 `packages/contracts`）；前端不得读取契约之外的字段，后端不得返回契约之外的形状。
10. 用户显式删除必须终局生效：删除操作在任何缓存层之后都不得复活；每类删除都要有"删除→刷新→不复活"E2E。

## 2. 唯一运行架构

```text
React/PWA ── tRPC + Hono SSE ── Hono API ── PostgreSQL
                                  │
                                  └── Temporal ── worker / filing / backup

packages/domain       纯领域规则、答案与报告编排（不接触 IO）
packages/application  研究用例编排
packages/contracts    zod 契约单一源（输入 + 输出）
packages/db           Drizzle、双时态财务仓库、强制 RLS
packages/data-plane   授权感知的供应商适配器（熔断 + 链式降级 + canary 真探测）
packages/ui           品牌与组件
crates/finance-core   十进制定点金融数值内核
```

端与端之间只有 zod 契约；多步任务由 Temporal 提供可重放语义（本地不可达时降级为内联执行并诚实标注）；结构化研究数据保留 valid time 与 knowledge time。仓库布局见 [architecture/repository-layout.md](architecture/repository-layout.md)。

## 3. 能力现状（2026-07-15 审计）

### 已接通且经真实数据端到端验证

- **行情**：多源适配器链（Finnhub → Twelve Data → Yahoo → Alpha Vantage）+ 熔断降级；唯一入口 `ensureFreshMarketSnapshot`（15 分钟新鲜窗、失败退旧快照、核不到即 null）。港股实际只有 Yahoo 一路真实覆盖（见第 6 节）。
- **财务**：美股走 FMP `stable`（三表 + TTM 比率，含真实 trailing PE）；港股走一手 HKEX filing 解析管道（`hkFilingsPipeline`，含场内回购翌日披露）。
- **财报日历**：美股 Finnhub；港股经人工核实的 HK→ADR 映射表（9 支，`hkAdr.ts`）查 ADR 日历。
- **研究链路**：`answerComposer`（意图分类路由段落结构）+ `reportComposer`（深度报告与对话回答共享取数、分开渲染）+ 估值区间（`valuation.js`，bear/base/bull）+ 同业可比（`comp_peers`，24h TTL，倍数可比上限过滤离群值）。
- **防幻觉**：`factGuard` 事实登记表交叉核对模型正文（shadow/soft 模式，审计写入 `fact_guard_audit`）；报表币种与报价币种分离；EPS 一律 TTM 年化后才允许反推 PE（`deriveAnnualEps`，缺数据标 `epsAnnualized: false` 并禁用相关方法）。
- **证伪闭环**：研究落判断快照（R7 记分卡）→ `replaceFalsifierRules` 登记价格线与基本面线 → worker 巡检触发通知 → 业绩复盘 workflow 骨架。
- **真流式**：`/api/ask` SSE 真实转发 provider delta（按 ~24 字符合并防止前端主线程阻塞），首 token < 3s；管线阶段事件驱动等待提示。
- **红线兑现**：持仓盈亏/市值走 Rust 定点内核；通知偏好在 `insertNotification` 唯一咽喉处检查；SW 对 `/api/*`、`/trpc/*` network-only。
- **门禁**：冻结表 CI 门禁 `check:frozen`（写入方零调用=表永远空；读取方零调用=数据白采，双向拦截）；契约输出 schema；删除闭环 E2E；canary 真探测驱动状态页（配置态不算存活证明）。

### 未接通（按优先级，对应第 5 节路线图）

- **网页证据层**：无搜索适配器。"证据优先"定位当前最大的名不副实处，P3 头号项。
- ~~earnings_calendar 无写入方~~（2026-07-15 已接通：`packages/application/src/earningsCalendar.ts` 镜像 compPeers 模式成为唯一写入方，研究链路取日历时 24h TTL 写穿；`last_*` 字段来自 Finnhub `/stock/earnings`（美股直连、港股经 ADR 映射，无 revenue 字段如实置 null）；真实回测 AAPL/0700.HK 落库、1234.HK 诚实 missing 不写脏行；业绩复盘 workflow 与 F-2 记分卡自此有活数据）。
- **factGuard `full` 模式**：拦截+定向重答未实现，现等同 soft。
- **历史估值分位**：美股可做（FMP 5 年年度 EPS + Yahoo 月度价格）；港股需先把 filing 回补到 ≥5 个财年。
- **FCF / 财务质量红旗**：港股走"解析公司自报 FCF"路径（见第 6 节，不自行推导）；应收/存货字段需扩数据管道。
- **港股 ADR 溢价**：需逐条人工核实 9 家 ADR 比例后才能接 `dualQuote`（见第 6 节）。
- **两类通知不存在**：`position_alert`/`review_reminder` 设置页开关已标注"未接通"。
- **AnswerCard 字段**：`evidence / grounding / analyst / dualQuote / completeness` 等待上述数据源。
- **死代码待清账**：`risk.js`、`eventRules` 的新闻分类部分——随对应数据源接回，或明确移入 retired，不允许第三种状态。
- **A 股全链路待删**：见 P3 第一项。

## 4. 商业化护城河底账

新需求与资源分配以此为准绳：投入优先流向护城河项，商品化能力只做到"够用且诚实"。

**是护城河的（按强度排序）：**

1. **港股一手数据管道与数据可得性 know-how**。实测证明 Finnhub/Twelve Data/FMP/Alpha Vantage 的免费与常规付费档对港股行情、财务、日历、同业全线"无权限/Premium/仅 ADR"。美股数据是商品（谁都能买 FMP），港股科技股（腾讯/阿里/美团…）只能靠一手 HKEX filing 解析、回购翌日披露、人工核实的 ADR 映射——"每份 PDF 列数都变、每家 FCF 定义都不同"这类脏活正是竞品不愿做的；第 6 节事实表本身就是排他性资产。
2. **防幻觉工程栈**。factGuard 事实登记表 + 冻结表 CI 门禁 + "未核到"诚实语义 + 输出 zod 契约，构成"数字可核对的研究输出"——通用 LLM 包壳产品没有这一层，且它随每个已修误报持续变深。
3. **证伪闭环与研究资产沉淀**。用户的判断历史、证伪规则与命中率是随时间增值且不可迁移的私有数据，是留存钩子也是数据飞轮。
4. **双时态底座**（valid time + knowledge time）。"当时知道什么"可审计，是机构/合规场景的准入能力。

**不是护城河的（不追加超出"可用"的投入）：** 多源行情路由与熔断、美股基本面、PWA/UI 本身、模型调用与提示词模板。

**商业化含义**：目标客群是美股与港股科技股的严肃个人投资者与小型机构；定价锚在"可审计的证据链与证伪跟踪"，不是"AI 问答"。最大商业化阻塞是港股行情唯一源 Yahoo 不可商用（见 P5 第一条）。

## 5. 路线图（严格按 P3 → P5；P0–P2 已完成并合入 main）

### P3 · 市场聚焦与证据收口

**第一项：A 股退场（纯减法，先做完再做证据层）**

A 股链路是港股链路的平行副本，删除不触碰港股/美股逻辑。按 expand-contract 分两个 PR：

1. **下线 PR（可回滚）**：契约 `marketEnum` 收窄为 `["US","HK"]`；前端 `market.ts` 的 CN 识别、看盘 `cn` 筛选、详情页"A股"标签、组合"A股暴露"行下线；`research.ts` 的 `getCnFinancials` 分支与 `isFirstPartyFiling` 正则收窄为 `.HK`；worker 的 `cnFilingsPipeline.js`、`ingestCnFilings` activity 与 workflow 分支删除；data-plane 各适配器 `supports()` 与 `authorization.ts` 注释去 CN；status 页 CN filing 卡移除；测试基准票 `600519.SS` 全部换成 `0700.HK`/`AAPL`；`check:frozen` 的 ALLOWED 清账。
2. **收缩 PR（破坏性，单独审批）**：`cn_financials`、`cn_filing_ingest_log` 备份后 DROP。
3. **存量用户数据纪律**：用户看盘/持仓里已有的 `.SS`/`.SZ` 条目**不静默删除**（违反红线 10 的精神），UI 标注"已停止覆盖"，不再提供行情与研究；用户自行删除后按正常删除闭环处理。

预估规模：约 600–800 行删除、20–25 个调用点修改、1 个破坏性迁移。

**证据收口（护城河基建）**

- 网页证据层接通：换有真实配额的搜索源（Tavily 续费或 SerpAPI/Brave）；引用可打开率校验（打不开不进答案）；证据条目带来源/时间戳/获知时间；回填 `AnswerCard` 的 `evidence/grounding/completeness` 与 answerComposer 的对应端口。
- earnings_calendar 真写入方：接 Finnhub `/stock/earnings`，救活 `postgresCalendarAdapter`、业绩复盘 workflow 与记分卡的 `postEarnings`/`epsBeatRate`。
- 港股 filing 历史回补至 ≥5 个财年，解锁历史估值分位与年度 EPS 序列；美股分位先行（注意 Yahoo 商用限制，见 P5）。
- 公司自报 FCF 解析（第 6 节路径）；季度→年化沿用 `epsAnnualized: false` 的诚实标记模式。
- 港股 ADR 溢价：逐条人工核实 9 家 ADR 比例后接 `dualQuote`；先修正 answerComposer 里"ADR 口径数据更全"的过时措辞（我们的一手 filing 比 ADR 准）。
- 数字级可追溯：每个核心数字展示来源、口径、有效时间、获知时间与新鲜度；"未核到/口径冲突/来源过期"统一待办。
- factGuard soft→full：拦截+定向重答闭环；settings 的 FactGuardCard 随真实流量出数。
- 死代码清账：`risk.js`、`eventRules` 新闻分类部分接回或移入 retired。

退出指标：A 股零残留（全仓库 `\.SS|\.SZ|CN` 市场分支零命中）；引用可打开率 ≥ 99%；关键数字证据覆盖率 ≥ 95%；业绩复盘对真实日历跑通一个完整财报季。

### P4 · 留存工作流（把单次研究变成持续资产）

- 证伪"温度计"：距阈值、数据时点、触发历史可解释展示（`evaluateRule` 已有 `distancePct` 基础，纯前端+编排工作）。
- 业绩期驾驶舱：预期/实际/差异/管理层口径变化/下一证伪点同一视图；披露后 30 分钟内出第一版复盘（workflow 骨架已有，等 P3 的真日历数据）。
- `position_alert` / `review_reminder` 两类通知真正建出来。
- 研究记忆自动沉淀：已确认事实/未决问题/观点变化/待复核日期；日/周摘要只推有新证据、接近证伪或即将披露的变化。
- 提醒强度/静默时段/来源偏好可调；反馈闭环（标记数字错误/来源失效）进可追踪队列。
- 新手引导、示例公司、空状态与失败恢复打磨；UX/动效/视觉质量是一等验收维度。

退出指标：完成一家公司"提问 → 证据 → 估值 → 证伪 → 跟踪"的中位时间下降 40%；核心流程完成率 ≥ 70%；通知有用率 ≥ 70%；次周留存持续增长。

### P5 · 发布准备与商业化

- **第一优先：港股商用行情源替换**。港股行情目前唯一真实覆盖是 Yahoo chart 接口，`commercialUseAllowed=false`——商业化前必须换成有授权的源（港交所 OMD 转售商、EODHD、iTick 等），否则商用路由里整条港股行情线会被 `authorization.ts` 正确地拒绝。数据供应商商用授权清单、字段级来源登记随此项一起做。
- 托管 PostgreSQL、Temporal Cloud、对象存储、OTel 与告警在预生产完整接通；蓝绿切换、恢复、故障与降级联合演练。
- `npm run test:load` 预生产实测并发研究、长报告、披露高峰与供应商限流，校准伸缩阈值与 WAF 限速（IaC/限流/WAF 见 [architecture/system-overview.md](architecture/system-overview.md)）。
- 团队空间、细粒度权限、共享模板、评论与审计日志；可控导出（Markdown/PDF、证据清单、观点变更记录、合规水印）。
- 套餐、用量、成本归因、预算上限与账单管理；密钥轮换与最小权限审计；渗透测试、隐私政策、数据处理协议与法务发布审查。
- 发布负责人、回滚阈值、事故分级与用户通知模板。

退出指标：RPO ≤ 24h、RTO ≤ 2h、核心 API 可用性 ≥ 99.9%；商用路由零未授权源；租户隔离与权限测试全绿；删除/导出请求可审计；法务与安全清单签署。

## 6. 数据可得性事实表（全部为实测结论，勿重新推导、勿凭直觉推翻）

| 事项 | 实测结论 |
| --- | --- |
| Finnhub / Twelve Data 免费档 | 美股行情可用；港股直接"无权限/需付费计划"。Finnhub `/stock/peers`、`/stock/metric` 美股可用、港股 403；`/calendar/earnings` 只覆盖美股，不带 `from/to` 参数会静默返回空数组 |
| Alpha Vantage | 无 HKEX 原始代码（SYMBOL_SEARCH 只命中法兰克福/伦敦/ADR 挂牌）；25 次/天，只作美股最后兜底 |
| FMP `stable` | 美股三表 + TTM 比率可用（用它的 `priceToEarningsRatioTTM`，勿拿季度 EPS 反推 PE）；港股三表一律"Premium Query Parameter"；legacy v3 端点已退役（200 状态但返回错误体）；`profile` 无 ADR/underlying 字段，`search-name` 模糊匹配不可靠 |
| Yahoo chart 接口 | 港股行情唯一真实源；`range=5y&interval=1mo` 免费给 61 个月度历史点、无需密钥；**`commercialUseAllowed=false`，商用前必须换源** |
| HK→ADR 映射 | 只能人工核实维护（`hkAdr.ts`，9 支，每条经真实 Finnhub 调用核实）；自动发现两条路径都不可靠，错配代价（自信地给错日期）比"未核到"更糟 |
| ADR 比例 | 每家不同（腾讯 1:1，阿里 1:8），必须去存托银行/官方披露逐条核实；从价格反推是推断不是核实，禁止 |
| 港股 capex/FCF | 简明现金流量表只给"投資活動耗用淨額"（不是 capex）；非 GAAP 摘要表列数每份都变、权责制、本期在首列；各家 FCF 定义不同（腾讯含媒体内容与租赁负债扣减，按 OCF−capex 算差 14%）。**正确路径：解析公司自报 FCF**（"自由現金流為人民幣 567 億元"），一手事实、公司自己背书；注意億/百萬单位混用与季度→年化 |
| EPS 年化 | filing 给的是累计值，直接反推 PE 会虚高 2–4 倍（曾给腾讯算出 70.9x，真实 18–25x）；必须 `deriveAnnualEps` TTM 年化，缺上一财年数据时标 `epsAnnualized: false` 并禁用所有 PE 反推/相乘方法 |
| 历史估值分位 | 价格免费（Yahoo 5y 月度）；瓶颈是年度 EPS 深度——美股 FMP 给 5 年可直接做，港股 filing 表现存仅 1–3 期，需回补 |
| 同业倍数 | 必须设可比上限（PE 100x / EV-Sales 50x）过滤离群 peer（曾因 TTM 盈利趋零的 peer 把锚点中位数抬到 366x）；先过滤可定价再截断数量 |
| 冻结表模式 | 本仓库头号缺陷类型："写好了没人调"不报错、不告警、只是永远不生效。`check:frozen` 双向拦截（写入方零调用/读取方零调用）；接回任何冻结资产必须用真实数据端到端验证，只改接线会"成功"写入空值 |

## 7. 发布门禁

本地与 CI 必须全部通过：

```bash
export DATABASE_URL=postgresql:///echo_dev
npm install
npm run db:migrate
npm run lint
npm run check:retired
npm run check:frozen
npm run typecheck
npm run lint:rust
npm test
npm run test:e2e
npm run build --workspace @echo/web
npm run db:recovery-drill
```

同时满足：

- 仓库扫描不存在已退役入口、文件数据库依赖、迁移兼容层或提交的密钥与构建产物。
- 冻结表门禁：repository 导出函数零生产调用方即失败；例外须在脚本 `ALLOWED` 记账并写明解除条件，重新有调用方后门禁强制删除该条目。
- 契约门禁：核心 tRPC 输出全部过 zod 输出 schema；前端类型从契约推导，禁止 `Record<string, any>` 直连页面。
- 删除闭环 E2E：看盘移除、持仓删除、研究会话删除均含"删除 → 强制刷新 → 不复活"断言，并在注册了 Service Worker 的 preview 构建下跑一遍。
- canary 真探测：`npm run canary` 对每个已注册外部适配器发真实请求，状态页只展示探测结果，不展示配置态。
- 全新 PostgreSQL 数据库可迁移、首次启动并完成私有数据写入；备份可在隔离数据库恢复，关键表数量、约束和强制 RLS 保持一致。
- 生产切流前完成数据授权核对、密钥配置、容量验证（`npm run test:load`）、回滚和蓝绿切换演练。

## 8. 优先级原则与核心看板

所有新需求按以下顺序取舍：

1. 是否修复用户已能感知的断裂（存在时一票否决其他需求）。
2. 是否提高事实正确性、证据可追溯性或风险可见性。
3. 是否加深第 4 节护城河，而不是单纯增加页面和模型调用。
4. 是否缩短核心研究闭环、减少打扰与供应商故障带来的不确定性。
5. 是否能用明确指标和真实用户行为验证。
6. 是否保持唯一架构与唯一契约，不引入第二套 API、数据库、调度器、前端实现或字段形状。

核心看板至少跟踪：证据覆盖率、严重数字错误率、数据源真实命中率、研究完成时间、核心流程完成率、删除闭环回归通过率、通知有用率、次周留存、API 可用性、首 token 时间、单位研究成本和恢复演练结果。
