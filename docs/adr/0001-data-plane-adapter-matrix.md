# ADR 0001 — 数据平面供应商适配器矩阵（R-4 第一片）

**日期**：2026-07-13
**状态**：已实施（部分范围，见下方"未决"）
**背景**：docs/REFACTOR_PROPOSAL.md §4.5 + §5 R-4 行

## 背景

REFACTOR_PROPOSAL.md 把"供应商适配器矩阵"列为 R-4 的核心交付：每个数据供应商一个适配器，实现统一端口，携带授权元数据，路由器按"授权允许 → 数据质量 → 延迟"选源，未授权源在商用环境自动不可选。

R-4 完整范围还包含"商用数据源接入替换腾讯/新浪"——这需要先完成数据商询价、签约（方案 §6 商业化前置闸门、§7 决策清单 D6），是产品决策而非工程决策，本片不做，也不应该做：在没有真实合同条款（配额、redistribution 权限、SLA）之前设计出的"商用适配器"字段只会是猜的。

## 决定

1. **新建 `packages/data-plane` 包**，落 Quote/Fundamentals/News/Filings/Calendar 五个端口接口；本片实现 Quote/Fundamentals/Filings/Calendar 四个，News 因为 legacy `getNewsSnapshot(company)` 签名和其余四个（纯 ticker 入参）不同，留类型占位到有第二个新闻适配器时再定形状。
2. **每个适配器包一层现有函数，不重写抓取逻辑**：`legacyFreeQuoteAdapter` 包 `src/marketData.js` 的 `getMarketSnapshot`（Tencent/Sina/Finnhub/TwelveData/EODHD/AlphaVantage/Yahoo 多源竞速+串行兜底），其余三个同理包 `financialData.js`/`filingData.js`/`earningsCalendar.js`。这些函数已经在生产环境和 `scripts/canary.js` 里被真实调用验证过；重新实现等于造一份未经测试的第二份行情代码，风险远大于收益。
3. **授权元数据是显式字段，不是 licenseTier 的隐含推导**：`AdapterAuthorization.commercialUseAllowed` 单独存在，因为一份商业合同完全可能标了"仅限研究用途"或"禁止再分发"这类条款——路由器只读这一个字段，不去猜。
4. **路由器对"选不出源"的处理是显式抛错，不是静默退回未授权源**：`selectAdapter()` 在 `commercialMode: true` 且没有已授权适配器时返回 `null`，调用方必须处理这个 `null`／`NoAuthorizedAdapterError`。这是方案里"合规从人为纪律变成类型系统约束"的具体实现——今天矩阵里只有一个 `unlicensed_free_tier` 适配器，所以商用模式下任何请求都会被拒绝，这是**预期行为**，不是 bug。
5. **数据质量守卫是新逻辑**：现有代码只处理"抓取失败"（`providerStatus: "missing"`），从不校验"抓取成功"的响应是否合理。`qualityGuard.ts` 补上量纲（price > 0）、币种存在性、时效性（`asOf` 可解析、未过度陈旧）、异常跳变（单日涨跌幅 > 40% 标记、changePercent 与 price/previousClose 隐含值对不上标记）几类检查。用真实港股/美股/A股数据跑 `verify.ts` 时，这套检查当场抓到一个真 bug（见下）。

## 副产品：修复了一个真实 bug

`src/marketData.js` 的 `fetchTencentQuote()` 对腾讯行情接口的时间戳字段做了错误假设：以为总是 `"YYYY/MM/DD HH:MM:SS"`（HK/US 确实是这个格式），但 A 股（CN）返回的是无分隔符的 14 位紧凑格式 `"YYYYMMDDHHMMSS"`。原代码直接做字符串替换再拼 `+08:00`，对 14 位格式生成的是一串不可解析的垃圾（`Date.parse()` 结果是 `NaN`）。`buildSnapshot()` 只在 `asOf` 本身是 falsy 时才兜底成"现在"，一个格式错误但非空的字符串会原样透传——也就是说**所有 A 股行情的 `asOf` 字段从上线以来实际上从未被正确解析过**，只是因为没有代码校验过它的有效性，所以从没触发过任何报错或告警。已在 `tencentAsOf()` 里按 14 位数字 vs 带斜杠两种格式分支处理，三次真实请求验证修复有效，`npm run test`（smoke）通过。

这是"数据质量守卫"这类基础设施投入的典型收益——不是为了防将来的假想问题，是当场照出了一个已经活在生产里、只是从没人打开灯看过的真问题。

## 未决 / 明确排除的范围

- **商用数据源接入**（Wind/恒生聚源/东方财富 Choice / HKEX 授权分销商 / Polygon 等）：卡在方案 §7 决策清单 D6，需要询价后由两位创始人拍板；本片只是把"接入后应该长什么样"的架子搭好（新增一个适配器 + 注册进 registry，路由逻辑不用改）。
- **一手管道迁入 worker**（cnFilingsPipeline.js / hkFilingsPipeline.js 物理搬到 `apps/worker` 自己的 src 下）：调研发现这两个管道**已经在 R-2 完成的 worker 分离里于运行时跑在 apps/worker 进程中**（`apps/worker/src/processor.ts` 的 `processJob()` 真实执行 `scheduler.js` `JOBS[].run()`，包括这两个管道的调度任务）——R-4 checklist 里这条更多是"代码物理位置该不该搬进 apps/worker 自己的包"的归属问题，不是运行时缺失。这两个文件加起来 1300+ 行、被 `filingData.js`/`dataSources.js` 等多处引用，牵涉 `src/db`/`src/server/repositories` 的深层依赖，贸然搬迁对当前功能没有增益、但有真实的引用断裂风险——留给有独立时间预算、能完整跑一遍集成测试的会话专门做。
- **News 端口的真实适配器**：见上方"决定 1"。

## 影响

- `packages/data-plane` 是新增依赖，目前没有任何现有代码（`apps/api`、`src/server/*`）调用它——它是独立可验证的架子，不是已切流的路径。下一片如果要让它产生实际效果，需要挑一个真实调用点（例如 `apps/api` 的某个 controller，或 `scripts/canary.js`）接进去，而不是继续只用 `verify.ts` 自证。
- 不影响任何现有 API 响应或前端行为（`marketData.js` 的 bug 修复除外——修复后 A 股行情的 `asOf` 会是真实时间而不是不可解析的字符串，任何读取该字段做 `new Date()` 的下游代码会从"Invalid Date"变成正确日期，是纯粹的修复，不是行为变更）。
