# Echo Research 主计划 v3：兑现闭环 Follow-through Audit（2026-07-06）

> **这是什么**：Echo Research 的**唯一权威计划文档**（v3）。取代 v2（Product + Research Terminal Gap Audit，其全文与全部验收记录见 git history 中的本文件）。v2 规划的全部 P1/P2 项——G-1/G-1.5/G-2/G-3（数据可信度底座 + 财报日历 + 估值同业锚）、R3 + 估值叙事强化（数字级防幻觉护栏）、R5+P2（组合联动 + 证伪通知回链）、E4（llm_audit）、R7（研究记分卡/自动复盘）——已全部完成并验收。
> **怎么来的**：用户要求以**专业投资研究员视角**重新审视产品还缺什么、应该深化什么，产出新的总计划。本文档是这次审计的产出：一句话论点（§0）→ 证据基础（§1）→ 逐条 gap（§2）→ 建议路线（§3）。审计方法承接 v2：结论以 file:line 为证，不凭印象。
> **给谁看**：任何接手的人（人类或新 AI 会话）。自包含，不需要先读其他文档。
> **状态**：§2/§3 是审计当时的建议路线，现已按此路线走完；§5 状态表的 F 轨（F-1…F-5）全部完成，仅剩顺手项（研究历史 FTS）与明确缓做项待对齐。

---

## 0. 一句话论点（接手先读这条）

经过 v1/v2 两轮，Echo 的**判断生产线已经可信**：研究时的每个数字有锚（同业倍数/财报日历/分析师目标价）、有护栏（factGuard 数字级校验）、有观测（canary/llm_audit/数据健康面板）、有留痕（画像 + 研究快照 + 记分卡）。**但判断的跟踪线只有价格一根**——研究桌的价值靠"判断被后续事实检验"来复利，而现在：财报日历知道下一份财报什么时候来（G-2），财报来了之后却没有任何自动复核；证伪条件里只有价格线是活的，基本面证伪（"毛利率跌破 40%"）写下来就死了；输出契约向用户承诺"回购金额""股东回报评分"，供数却基本缺失；宪法要求的估值"历史区间"锚仍是空白。v2 的 R1 曾写道："没有日历，'等财报验证'是一句永远没有下文的话"——**G-2 给了这句话一个日期，v3 要给它下文**。这就是 F 轨（Follow-through，兑现闭环）。

---

## 0.5 当前产品能力地图（2026-07-06，v2 收官时点）

> 压缩版。逐项验收细节见 git history 中的 v2 PLAN §5 与 git log。

- **研究生产线**：统一入口 `/api/ask`（意图路由 + 受控对比规划器）→ 并发拉数（行情/财报/新闻/公告/评级/分部/区间回报，`dataSources.js` 全超时降级）→ stage-aware 估值引擎（盈利股 PE/Forward PE/FCF/DCF/同业倍数多法交叉，亏损股 EV/Sales + 同业分位；脏数据护栏多处）→ 结构化决策面板（评级/估值条/证伪/溯源/置信度，置信度有事实锚定护栏）→ 两段式模型调用（搜索分诊 → SSE 流式回答）。
- **研究锚点**：财报日历（Finnhub，港股经 ADR 映射，无映射诚实标缺）；估值同业锚（Finnhub peers，按阶段分桶，<2 家不硬凑）；分析师一致预期（评级分布 + 目标价锚）。
- **防幻觉**：宪法级研究纪律（`src/prompts.js`）+ factGuard 数字级校验（`factGuard.js`，正文每个财务数字核对事实登记表，目前 shadow 模式）。
- **跟踪与主动性**：scheduler 5 任务（港/美盘前速报、持仓触线、证伪巡检、复盘提醒）+ 通知中心 + Telegram；证伪命中可回链到当时的研究会话。
- **研究资产**：SQLite 单库（20 表）——会话/画像/判断事件/研究快照（R7）/组合/watch 规则/证据缓存；记分卡有样本成熟度门槛（不足则诚实降级）。
- **数据管道**：港美一手（SEC 8-K 结构化抽取 + HKEX PDF 三表管道）+ 多源降级行情/财报/新闻。
- **可观测**：`npm run canary`（真实数据全管道探测落库）+ `hk-coverage`（654 支港股一手覆盖率）+ llm_audit（每次 provider 尝试一行）+ 设置页健康面板。
- **工程底座**：CI（lint + typecheck 0 error + 415 条测试）+ `PRAGMA user_version` 迁移器（当前 006）+ 前后端全模块化（无框架、无构建）。

---

## 1. 审计方法与证据基础

研究员视角审读了以下材料（结论都以 file:line 为证）：

- **跟踪链路源码**：`falsifyRules.js`（证伪规则解析/巡检全文）、`researchReview.js`（R7 复盘计算全文）、`scheduler.js`（5 个任务定义）、`earningsCalendar.js` + `earnings_calendar` 表结构（PRAGMA 实查）、`companyPortrait.js`。
- **研究生产线**：`dataSources.js` 全文（8 路并发拉数清单）、`valuationEngine.js`（PE 法自身锚实现）、`prompts.js`（宪法八条 + 输出契约 + 评分规则）、`factGuard.js` + `chatOrchestrator.js` 的接入点。
- **数据面**：`financialData.js`（回购/股本相关字段的真实供数情况、Finnhub 年度序列）、`secFilings.js`（EDGAR 通道现状）、`db` 20 表清单。
- **v2 遗留判断**：§2.5/§3.5 记录在案的 P3/P4 项（FTS/移动端/缓存/名单/onboarding/R6/EA-6/P8 商业化），逐条复核有无新信号。

关键前提结论（影响 gap 定级）：v2 已两次验证"研究时锚点 + 代码级护栏"路线的正确性（G-3 同业锚被真实使用、factGuard shadow 抓到多类真实误报并修复）；R7 证明"快照留痕"成本低、价值兑现快。**这些经验共同指向：下一程的最大杠杆不在再加一种研究时数据，而在把已存下来的判断接上后续事实。**

---

## 2. Gap 清单（三视角，每条含七要素）

> 字段约定：**问题 / 为什么重要 / 用户价值 / 工程风险 / 建议优先级 / 需要真实数据验证? / 预计工作量**。
> 优先级：P1 = 建议下一程就做；P2 = 第二程候选；P3 = 记录在案等时机；P4 = 明确缓做。
> 编号承接 v2：研究员视角从 R8 起，产品视角从 P6 起，工程视角从 E8 起。

### 视角一 · 专业投资研究员（R：判断被检验了吗）

**R8 · 业绩闭环缺失——日历知道"什么时候来"，没人核"来了之后怎么样"** ★
- **问题**：`earnings_calendar` 只存下一次业绩日的**预期**（`eps_estimate`/`revenue_estimate`，表结构 PRAGMA 实查无任何 actual 字段；`earningsCalendar.js:42` 的字段清单同样只有 estimate）。scheduler 的 5 个任务（`scheduler.js:200-204`）没有一个在业绩日**之后**触发。R7 复盘只核价格几何（`researchReview.js:48-58`：`withinBand`/`towardBase` 都是价格 vs 估值带）。于是输出契约的第一问"现在到底有没有预期差？"（`prompts.js:75`）永远只在研究当时被回答一次，"预期 vs 实际"从不被系统核对。
- **为什么重要**：研究桌的节奏围绕业绩日组织。业绩日**前**的提醒已有（G-2 联动证伪规则条数），业绩日**后**的"实际 vs 预期 → 判断复核 → 画像更新"是研究员最高价值的例行动作——beat/miss 幅度直接决定"预期差"判断是否兑现。这也是 R7 记分卡从"价格对不对"升级到"逻辑对不对"的必经之路。
- **用户价值**：高。每个财报季对每只覆盖标的自动兑现一次；通知"你 3 个月前的判断刚被财报检验：收入 beat 4%，你的证伪线未触发"是产品身份承诺的直接兑现。
- **工程风险**：低中。同一个 Finnhub `/calendar/earnings` 端点查过去窗口即返回 `epsActual`（需实测免费档 actual 字段覆盖度，尤其港股经 ADR 映射后的可得性）；港股无 estimate 时降级为"新一期一手 filing 到货 → 与上期趋势对比"（HKEX 管道现成）。
- **优先级**：P1 ｜ **真实数据验证**：需要（actual 字段免费档覆盖实测）｜ **工作量**：≈2-3 天。

**R9 · 基本面证伪条件是死文本——证伪闭环只对价格成立** ★
- **问题**：`falsifyRules.js` 只解析两种规则（`:44` `price_below`、`:57` `price_above`），其余一律返回 null。研究正文里高频出现的基本面证伪（"云业务增速低于 20%""毛利率跌破 40%"）只以原文文本存在 `watch_rules`/研究快照里，`falsify_watch` 巡检永远不看它们；R7 的 `falsifierStatus` 也只复用价格规则（`researchReview.js:62`）。
- **为什么重要**：价格证伪是最弱的证伪——价格波动不等于逻辑破坏，用价格线当唯一活规则，实际是在用"跌了没"替代"逻辑坏了没"。研究员真正的证伪线大多是基本面口径；现在这些线写下来就死了，"证伪条件"这个产品核心概念只兑现了一半。
- **用户价值**：高。证伪监控从"止损提醒"升级成"逻辑体检"。
- **工程风险**：中。关键取舍：**不做自由文本→结构化的事后解析**（误报路线，v2 R3 的教训是数字模式匹配的边界很硬），改为**研究时让模型直接输出结构化字段**（`{metric, op, threshold, 原文}`，结构化输出校验层现成——`schemas/` 已有），旧数据保持文本兜底不硬迁。核对时机挂 R8 的业绩后复核——只有新财报到货，基本面数字才会更新，平时巡检没有意义。
- **优先级**：P1（排 R8 之后，共用触发时机）｜ **真实数据验证**：需要（结构化证伪的真实模型输出质量）｜ **工作量**：≈2-3 天。

**R10 · 股东回报向用户承诺了评分，供数却基本缺失**
- **问题**：事实数据表承诺"回购金额"（`prompts.js:100`），评分规则写明"有公告或交易所披露，才能评股东回报"（`prompts.js:115`）——但真实供数只有 Yahoo 现金流的单期 `repurchaseOfStock`（`financialData.js:169`，best-effort，多数时候 null）+ 分红历史。港股回购公告（HKEX 每日回购报告，免费一手）、美股内部人交易（EDGAR Form 4，免费，`secFilings.js` 的 EDGAR 通道现成）、股本变化/SBC 摊薄趋势，全部没有供数源。结果是"股东回报"维度长期停在"暂不评分"。
- **为什么重要**：资本配置是研究员判断管理层的核心透镜；**港股尤其**——回购是腾讯/汇丰/友邦这批港股大票最重要的股东回报形式，恰是本产品主打市场。这是继一手财报之后港股侧最有价值的一手数据维度。
- **用户价值**：高（港股尤甚）。｜ **工程风险**：中（两个新数据源，逐源实测覆盖度与字段稳定性；HKEX 回购报告是结构化程度较高的披露，风险低于 PDF 三表）。
- **优先级**：P2 ｜ **真实数据验证**：必须（HKEX 回购端点 + EDGAR Form 4 免费档实测）｜ **工作量**：≈2-3 天。

**R11 · 历史估值分位仍是空白——宪法第五条只兑现了一半**
- **问题**：宪法估值纪律要求说明"与历史区间和同业是否匹配"（`prompts.js:40`）——同业已兑现（G-3），历史没有。PE 法的自身锚仍是自参照机械带（`valuationEngine.js:323-325`：`pe*0.7 / pe / pe*1.3`），同业倍数法只是并行多了一条腿，"当前 PE 处于自身近 N 年什么位置"依然无人能答。
- **为什么重要**："贵不贵"的两个对照系，横向（同业）有了，纵向（自己历史）没有；对腾讯这类没有同阶段可比、或行业整体重估过的标的，纵向分位反而是更有信息量的锚。
- **可行路径（免费档，v2 曾判"拿不到"，现在有两条腿）**：① Finnhub `/stock/metric` 已返回年度 EPS/salesPerShare 序列（`financialData.js:330-331` 在用）× 历史收盘价 → **近似**逐年 PE → 当前分位（美股先行，近似口径显式标注）；② `market_snapshots` 每次研究都在落库真实 PE（`dataSources.js:156`），自沉淀序列随使用变长，是精确口径的长期来源。港股两条腿都缺时诚实标"未核到"。
- **用户价值**：中高 ｜ **工程风险**：中（近似口径必须防"假精确"，见 §4 新增红线）。
- **优先级**：P2 ｜ **真实数据验证**：需要（年度序列覆盖长度实测）｜ **工作量**：≈1-2 天。

**R6（承接 v2）· 管理层指引结构化** —— 维持 P3。R8 用一致预期（`epsEstimate`，已在库）以约一成的成本覆盖"预期 vs 实际"的大部分价值；指引数字的 PDF/电话会抽取仍是高风险低确定性路线，继续等真实使用反馈。

### 视角二 · 产品体验（P：信任承诺兑现到哪一步了）

**P6 · factGuard 停在 shadow，且没有升档的依据积累机制** ★
- **问题**：默认 shadow（`chatOrchestrator.js:30`），命中结果只有 `console.log`（`:58`）+ 单轮会话 meta（`:466`）——**没有跨轮聚合留痕**。"先观察真实误报率再升档"的计划里，"观察"没有数据可看：没人翻 console 历史，误报率无从统计，护栏会无限期停在 shadow。v2 §5 R3 行记录的残留误报类别（同业对比中他司数字巧合反号、假设性情景 vs 事实）也因此无法量化收敛。
- **为什么重要**：shadow 模式的 factGuard 对用户而言等于不存在；防幻觉是产品第一信任支柱，最后一步（用户可见的守护）没有兑现。而 F 轨接下来每一步（surprise%、回购金额、历史分位）都在**提高正文真实数字密度**，风险敞口在扩大。
- **用户价值**：高（soft 模式的低调提示是"诚实"品牌的直接可见证据）。
- **工程风险**：低。留痕复用 llm_audit 模式（一张表 + 永不抛错的写入）；升档决策按落库数据来。
- **优先级**：P1（F 轨第一步，理由同 v2"R3 在叙事强化之前"）｜ **真实数据验证**：本身就是（真实研究流量的误报率）｜ **工作量**：≈1 天（留痕 + 汇总视图 + 达标后默认 soft）。

**P7 · 研究历史全文检索（v2 的 P3，升级为 P2）**
- **变化**：v2 判"等沉淀"。现在 sessions/snapshots/portraits 三层留痕成体系、R7 让"研究是可复盘资产"叙事成立——资产在涨，检索入口还是没有，"我研究过哪些液冷相关的票"依然无解。SQLite FTS5 纯本地可落地。
- **优先级**：P2（可作任意一程顺手项）｜ **真实数据验证**：不需要 ｜ **工作量**：≈1 天。

**P4/P5（承接 v2）· 移动端余项 + onboarding** —— 维持 P3/P4，本轮无新信号。

### 视角三 · 工程与数据（E：资产安全与底座）

**E8 · "可复盘资产"没有任何备份**
- **问题**：产品的核心资产——研究会话/画像/判断事件/快照——全部在单文件 `luvio.db`（含 WAL），没有备份任务、没有导出/导入命令。一次磁盘故障或误删 = 资产清零。R7 之后"研究资产"的叙事价值变高了，裸奔的代价同步变高；且 §4 红线 9 已把"用户数据不可破坏"立为原则，备份是这条原则的另一半。
- **优先级**：P2（成本极低，建议第一程顺手带上）｜ **真实数据验证**：不需要（但要验证备份可恢复）｜ **工作量**：≈0.5 天（scheduler 每日 `VACUUM INTO` 滚动保留 N 份 + 手动导出/导入命令）。

**E6/E7（承接 v2）· 缓存统一 / curated 名单可配置** —— 维持 P3，无新信号。

---

## 3. 下一阶段建议路线（待用户对齐后开工）

**建议下一程 = F 轨：兑现闭环（Follow-through）**，五阶段，每阶段独立可验收：

| 阶段 | 内容 | 合并的 gap | 预估 |
|------|------|-----------|------|
| **F-1** | factGuard 升档路径：命中落库（复用 llm_audit 模式）→ 设置页/CLI 误报复盘视图 → 误报率达标后默认 `soft` | P6 | ≈1 天 |
| **F-2** | 业绩闭环：`earnings_calendar` 补 actual/surprise 字段 + scheduler 业绩后复核任务（实际 vs 预期 → 通知 + 画像/快照联动）+ R7 复盘接入 beat/miss 维度 | R8 | ≈2-3 天 |
| **F-3** | 基本面证伪条件：研究时结构化输出 `{metric, op, threshold, 原文}` → 落 `watch_rules` → F-2 的新财报到货时自动核对 → 巡检/复盘/通知全链打通 | R9 | ≈2-3 天 |
| **F-4** | 股东回报供数：HKEX 每日回购报告 + EDGAR Form 4 + 股本趋势 → 事实块/股东回报评分/事件流 | R10 | ≈2-3 天 |
| **F-5** | 历史估值分位：年度 EPS 序列 × 历史价近似分位（US 先行、显式标"近似"）+ `market_snapshots` 自沉淀精确口径打底 | R11 | ≈1-2 天 |
| 顺手 | 研究库每日备份 + 恢复演练（E8，建议随 F-1）；研究历史 FTS（P7，可挂任意一程） | E8 + P7 | 各 ≈0.5-1 天 |

**为什么是这个顺序**：
1. **F-1 打头**与 v2"R3 排在估值叙事强化之前"同一逻辑——F-2/F-4/F-5 都会显著提高正文真实数字密度，先把护栏从 shadow 推进到有据可依的 soft，是收窄而不是扩大暴露面；且留痕不做，"观察期"永远没有数据，升档无限期悬置。成本最低（≈1 天），独立于其他阶段。
2. **F-2 是全轨枢纽**：它创造"业绩日后"这个触发时机，F-3 的基本面核对、R7 记分卡的逻辑维度、通知的"判断被检验"时刻全部挂在上面。这是"等财报验证"的下文本身。
3. **F-3 紧跟 F-2**：共用触发时机与通知通道，分开做会重复趟一遍链路。
4. **F-4/F-5 顺序可按兴趣对调**：F-4 对港股用户价值更高但要趟两个新数据源；F-5 更便宜但只影响估值锚。都不阻塞前三个阶段。

**与 v2 方法论的连续性**：真实数据 + fail-safe（actual 拿不到就诚实标缺，不硬凑 surprise）；真实调用验证（两个新数据源逐源实测）；宁可漏报不可误报（结构化证伪走模型研究时输出，不做事后文本解析）；样本不足诚实降级（beat/miss 统计沿用 R7 的成熟度门槛）。

**明确不动的**（本轮复核过、无新信号）：P8 商业化、EA-6 自定义 skill、C1/C2 移动端余项、P5 onboarding、R6 指引结构化、E6 缓存统一、E7 名单可配置。

---

## 4. 明确不做（防后人走弯路，承接 v1/v2 全部红线）

1. **不换前端框架**：vanilla ESM + 事件委托，EA-5 已证明可维护性够用。
2. **不做完全自主 ReAct 循环**：规划步数 ≤3，规则优先。
3. **不做 A 股**：聚焦 HK + US。
4. **不给买卖指令**：合规红线，宪法约束。
5. **不编数字**：取不到就"未核到"，禁止估计范围/反推。
6. **不在没有授权前把腾讯港股行情当商用数据源**（商业化阻断项）。
7. **不做过早抽象**：EA-6 等真实用户；R6 指引结构化等真实使用反馈；E7 名单可配置化等注册表需求。
8. **canary 不进 CI**：CI 保持无 key、不烧配额；真实探测属于本机/scheduler 的职责。
9. **涉及真实用户数据的 schema change 必须走非破坏性 migration**。
10. **（新增）factGuard 升档必须以落库的真实误报率为依据**：shadow→soft→full 每一档都要真实样本支撑，不许拍脑袋直接开 full。
11. **（新增）近似口径必须显式标注**：历史 PE 分位的"年度 EPS × 历史价"是近似，正文与面板都要标"近似口径"；港股拿不到就"未核到"——不许把近似当精确（红线 5 的延伸）。
12. **（新增）股东回报评分只认交易所一手**：HKEX 回购报告 / EDGAR Form 4 / 公司公告；新闻转述不作为股东回报评分依据（宪法来源分级的落地）。
13. **（新增）业绩后复核不做"荐股化"表达**：beat/miss 只陈述事实与证伪线状态，不引申为买卖信号（红线 4 的延伸）。

---

## 5. 状态跟踪表

### 已建成（v1/v2 全部里程碑，压缩记录——逐项验收细节见 git history 中的 v1/v2 PLAN 与 git log）

| 轨道 | 内容 | 完成于 |
|------|------|--------|
| P0–P7 + 品牌 + 交互重构 | 工程门禁 / scheduler+通知 / 证伪监控 / 组合体检 / 画像时间线 / 前端模块化 / 发现层 / 港美一手管道 / Echo Research 品牌 | 2026-07-02 ~ 03 |
| EA-0…EA-5 | 统一入口 `/api/ask`、框架注册表 + 工具层、受控规划器、赛道词典 + 可解释排序、对话即容器 + 全标的进看盘、对话为中心前端 | 2026-07-03 ~ 04 |
| B-1…B-7 | 置信度事实锚定、多期财报趋势、对比胜负手、风险雷达去占位、港股一手估值口径、HKEX PDF 复杂版式、web 证据真实实测 | 2026-07-04 |
| D1…D3 | 全量 JSDoc/checkJs 0 error、`user_version` 迁移器、chat 编排内化 | 2026-07-04 ~ 05 |
| E5 + G-1 + G-1.5 | typecheck 进 CI；真实数据 canary + HK filing 覆盖率 + doctor 补检 + 数据健康面板；HKEX 公告抓取改真实端点 | 2026-07-05 |
| G-2 + G-3 | 财报日历（Finnhub + ADR 映射 + 24h TTL + stale-if-error）；估值同业锚（阶段分桶 + 分位数约束 + 前端同业面板，顺带修 `numOrNull`/负负得正两个真实 bug） | 2026-07-05 |
| R3 + 估值叙事强化 | factGuard 数字级防幻觉护栏（shadow 模式，两轮真实样本调阈值）；正文稳定引用真实同业/财报日历锚点（4 轮真实模型输出验证） | 2026-07-05 |
| R5+P2 + E4 | 组合体检三路联动（行业集中度/证伪线临近/财报×证伪）+ 证伪通知回链到研究会话；llm_audit 调用留痕 + 设置页卡片 | 2026-07-05 |
| R7 | 研究记分卡/自动复盘：`research_snapshots` 快照落库 + 复盘计算（样本成熟度门槛、诚实降级）+ 画像页复盘区块 + 设置页记分卡 + 复盘提醒任务 | 2026-07-06 |
| F-1 | factGuard 升档路径 + 研究库每日备份：`fact_guard_audit` 表（`007_fact_guard_audit.sql`）——`chatOrchestrator.applyFactGuard` 每次校验（不只是 shadow 模式的 console.log）都落一行 `{ticker, mode, total, pass/soft/hard 计数, hardDetails}`，`factGuardRepository.getFactGuardStats` 按 14 天窗口聚合 hard/soft 命中率，设置页新增"防幻觉护栏"卡片（`renderFactGuardCard`，达标依据取代人工翻 console）。顺手 E8：`dbBackup.js` 用 better-sqlite3 在线备份 API 每日 03:30 落一份快照（scheduler 新任务 `db_backup`），备份后立刻打开文件跑 `integrity_check` + 抽真实表验证"能恢复"不是纸面承诺，按 `retain=14` 滚动清理旧文件；`LUVIO_BACKUP_DIR` 可覆盖目录。真实数据验证：真实发起一轮 AAPL 研究（DeepSeek 实际作答），确认 `fact_guard_audit` 落了一行真实校验结果（33 处数字校验、1 处 hard 命中——模型提及"折叠屏备货 1000 万部"的手机出货量被误判成金额，跟"现金及等价物"数量级比对判 hard，这正是 v2 已知的"股数/份额误判成金额"边界情形的姊妹案例，记录在案供后续调阈值参考，不在本次修）；设置页卡片截图确认渲染正确（hard 命中率 3%、soft 命中率 42.4%）；`npm run dev` 实测 `db_backup` 任务真实触发，生成的备份文件通过 `verifyBackup` 校验。验证后已清理该临时研究会话（保留 `fact_guard_audit` 真实留痕数据，因为这正是 F-1 要收集的观测资产）。**shadow→soft 的升档暂不动**：14 天窗口刚开始积累，样本量为 1 次回答，红线 10 要求"以落库的真实误报率为依据"，现在还不到时候，留给持续观察。`tests/phase-f1.mjs`（10 项：仓库聚合/永不抛错、chatOrchestrator 集成真实校验落库、scheduler 任务注册、dbBackup 真实备份+校验+滚动保留），`tests/notifications.mjs` 的 JOBS 计数更新到 6，`tests/phase-d2.mjs` 迁移版本断言更新到 7。全套测试/lint/typecheck 干净。 | 2026-07-06 |
| F-2 | 业绩闭环——**方案原设计假设 `/calendar/earnings` 把 `from` 往回推就能拿到已报告的实际值，真实调用验证证明这个假设是错的**：Finnhub 免费档按 symbol 查询 `/calendar/earnings` 只返回未来排期，`epsActual`/`revenueActual` 恒为 null，不管 `from` 设多早。改用专门的 `/stock/earnings?symbol=` 端点（真实返回近几期 `estimate`/`actual`/`surprisePercent`），但**只有 EPS，免费档没有营收实际值来源**——诚实留空（`revenueActual`/`revenueEstimate`/`revenueSurprisePct` 恒为 null），不拿"下一期营收预期"顶替"上一期营收实际"造假。`008_earnings_actuals.sql` 给 `earnings_calendar` 追加 9 个 `last_*` 列（同一行存"下一次"+"最近一次"，不新开历史表）；`earningsCalendar.js` 的 `fetchLastReportedEarnings` 独立请求、失败不拖垮更基础的"下一业绩日"查询；`last_date` 存的是**财季结束日**（fiscal period end），不是公告发布日（免费档没有后者）——scheduler 任务的"是否已提醒过"因此改用 `ticker+year+quarter` 做 dedupeKey，不依赖日期窗口判断新旧（`earningsCalendarRepository.listWithLastReported` 不做日期筛选，全部候选交给 notifier 的 dedupe 去重）。scheduler 新任务 `earnings_review`（每日 07:30）：刷新每只覆盖标的的财报日历 → 有已核到实际值的就通知 beat/miss（EPS 惊喜幅度 + 诚实的"营收：免费数据源无实际值，未核到"）→ 画像时间线补一条 `earnings_report` 事件。R7 记分卡接入：`researchReview.computeSnapshotReview` 新增 `postEarnings`（只在"这份报告晚于快照日期"时才算数，之前就已知的报告不算新事实）；`computeTickerScorecard`/`computeGlobalScorecard` 聚合 `epsBeatRate`（样本 0 时诚实 null，不是 0%——0% 意味着"全 miss"，跟"没数据"是两回事）；公司画像页"研究复盘"每条快照标"财报 EPS ±N%"徽章，设置页记分卡加一行 beat 率。**真实数据验证过程中额外抓到并修复一个范围错误**：`listWithLastReported()` 是全表扫描，scheduler 任务最初直接拿它的结果去通知，导致"只是被随口问过一次下一财报日、从没成为研究对象"的 ticker 也被拉进业绩后提醒——用真实 dev DB（AAPL 有研究快照、0700.HK 只查过财报日历）跑一轮就复现了；修复为按 `listSnapshotTickers()`（有真实研究判断的覆盖范围）过滤 `reported` 列表，并补了回归测试。真实数据验证：AAPL 真实 Q2 2026 财报（EPS 实际 2.01 vs 预期 1.9884，+1.1%）、0700.HK 经 ADR TCEHY 真实核到 Q1 2026（EPS 实际 7.364 vs 预期 7.4078，-0.6%）均通过真实 Finnhub 调用验证并正确入库；浏览器截图确认画像页"财报 EPS +1.1%"徽章正确渲染（绿色，tooltip 显示真实报告日期）；手动触发 `earnings_review` 任务确认通知+画像事件正确产生，验证后已清理临时快照/通知/事件（未污染真实数据）。`tests/phase-f2.mjs`（18 项，含范围过滤的回归测试），`tests/phase-d2.mjs` 迁移版本断言更新到 8（新增 `008_earnings_actuals` 的 9 个列存在性检查），`tests/notifications.mjs` 的 JOBS 计数更新到 7。全套测试/lint/typecheck 干净。 | 2026-07-06 |
| F-3 | 基本面证伪条件：`009_watch_rules_metric.sql` 给 `watch_rules` 追加 `metric` 列（价格规则为 null，基本面规则标注对应指标）。**不做事后文本解析**——模型研究时在正文末尾直接输出机器可读的结构化行（`FALSIFIERS_JSON: [{"metric":"grossMargin","op":"below","threshold":40,"text":"..."}]`，`prompts.js` chat 框架第 6 点指令，白名单仅 6 个可独立核对的财务指标：revenueGrowth/grossMargin/operatingMargin/netMargin/profitGrowth/freeCashFlow），`falsifyRules.extractStructuredFalsifiers` 抽取+校验（非白名单 metric/非法 op/离谱百分比阈值整条丢弃，不硬凑）后**立刻从用户可见正文剥离**（`chatOrchestrator.finalizeChat` 在 factGuard 之前做，防止这行被误判成幻觉数字，也防止泄露到聊天气泡）。`companyPortrait.updatePortraitFromPanel` 新增 `structuredFalsifiers` 参数，与价格线合并写入同一个 `watch_rules` 表；`ruleSignature`（判断变化事件的指纹）同步纳入 `metric`。核对时机绑定 F-2 的财报到货：`earnings_review` 任务对每只有基本面规则的覆盖标的拉一次最新财务，命中就发 `falsify_alert`（复用价格证伪线的通知样式与回链机制）+ `markTriggered`。**真实数据验证中发现并修复一个关键正确性问题**：`evaluateRule`（价格规则核对函数）此前对任何 kind 都会尝试按价格核对，如果不加拦截，基本面规则的阈值（如毛利率 40）会被当成价格核对——阈值/现价的比值可能恰好落在"合理"区间，从而产生一条毫无意义的"距触发 X%"；已在 `evaluateRule` 入口拦截非价格 kind（直接返回 `sane:false`），watchDesk 卡片的"N 条自动盯盘"计数与前端渲染因此自动只统计价格线，基本面条件优雅降级为纯文本展示，未改动前端代码。真实数据验证：真实发起一轮 AAPL"什么情况会证伪"提问，模型真实输出 4 条结构化基本面条件（营收增速/毛利率/经营利润率/净利润增速），确认已从用户可见正文剥离（会话落库内容 grep 不到 `FALSIFIERS_JSON`）、4 条规则正确入库且 `evaluateRule` 护栏生效（`sane:false`，不污染"自动盯盘"计数）；手动运行 `earnings_review` 任务用真实财务数据验证 evaluateFundamentalRule 判定（AAPL 真实毛利率 47.86%，正常阈值 47.5% 不触发；临时改阈值到 50% 后真实触发，`falsify_alert` 通知内容与 `last_triggered_at` 均核对正确）。验证后已清理临时门槛/通知/研究会话，恢复模型给出的真实规则集。`tests/phase-f3.mjs`（27 项，含 `evaluateRule` 护栏的针对性回归测试），`tests/phase-d2.mjs` 迁移版本断言更新到 9（新增 `watch_rules.metric` 列检查）。全套测试/lint/typecheck 干净。 | 2026-07-06 |
| F-4a | 股东回报供数（美股先行）：`010_insider_activity.sql` 新表 `insider_activity`（一行=一只 ticker 近 180 天 Form 4 净买卖汇总，24h TTL）。**真实调用验证推翻了一个初始假设**：`data.sec.gov/submissions/CIK.json` 里 Form 4 指向的 `xslF345X06/form4.xml` 路径是 SEC 生成的**可读 HTML**（渲染给人看的版本），不是机器可读 XML——真正的结构化数据在同目录下不带 `xslF345X06/` 前缀的 `form4.xml`，两条路径只差一段，容易踩坑，已记录在 `secFilings.js` 顶部注释防重复踩坑。`secFilings.parseForm4Xml`（纯函数，正则抽取，不引入 XML 解析依赖）只读非衍生品交易表（衍生品表是期权/RSU，不是真实股票买卖），只统计交易码 P/S（公开市场真实买卖）——排除 M（行权）/F（税务代扣）/A（授予归属）/G（赠与）等薪酬性变动，避免把每次 RSU 归属都算成"增持"。`insiderActivity.js` 挂 24h TTL 读穿透缓存（与 earningsCalendar.js/compPeers.js 同款节奏），只对美股生效（港股无 SEC 备案，诚实返回 missing，H 股一侧留给 F-4b）。挂进 `dataSources.js`（US-only，9s 超时预算，缓存命中是本地 DB 读、首次未命中最多顺序拉 10 份原始 XML）；`financialData.financialsToMarkdown` 新增内部人净买卖事实块（无数据时整段不出现，不写"未核到"占位——避免暗示港股本该有这项数据）。**真实数据验证中发现并修复第二个问题**：真实模型答复引用这项新事实时，factGuard 把正确数字判成 hard——净买卖金额没有登记进事实登记表，"最接近的事实"变成风马牛不相及的"分析师目标价"（数量级差 13068 倍）；交易日期同样未登记，被判"日期不存在"。已在 `factGuard.buildFactsRegistry` 补登记内部人净买卖金额（`pushAmount`）与最近交易日（`pushDate`，不登记股数——股数量级与货币金额量级不同源，混进同一个桶会重演 F-3 前"股数当金额"的误报模式）；登记后日期变成精确匹配，金额从"跟不相关事实比数量级"变成"跟正确事实比"。**残留已知边界**（记录在案，不追加修）：模型用"约 0.96 亿美元"描述一笔净卖出（负值）的**绝对值**幅度时，符号检查仍会判"符号相反"——这是描述量级 vs 描述方向的语义区分，超出数字模式匹配能做的范围，性质与 R3/估值叙事强化已记录的类似边界一致，留给持续 shadow 观察。真实数据验证：真实抓取 AAPL 近 180 天 Form 4（真实解析出 4 位高管——Cook/Levinson/O'Brien/Parekh 等真实姓名、8 笔真实卖出、0 笔买入，净卖出 332,926 股/净值约 9,522.71 万美元）；真实发起两轮 AAPL 提问确认模型正确引用这些真实数字、`fact_guard_audit` 落库验证登记前后的差异。验证后已清理临时研究会话（保留 `fact_guard_audit`/`insider_activity` 真实留痕数据）。`tests/phase-f4.mjs`（17 项：Form 4 解析/聚合纯函数、仓库落库、服务层港股快速 missing + TTL 缓存、事实块条件渲染），`tests/phase-d2.mjs` 迁移版本断言更新到 10（新增 `insider_activity` 表存在性检查）。全套测试/lint/typecheck 干净。 | 2026-07-06 |
| F-5 | 历史估值分位：`011_historical_valuation.sql` 新表 `historical_valuation`（一行=一只 ticker 最近一次拉取的 Finnhub 年度 PE 序列缓存，24h TTL）。**真实调用探测推翻了原计划里"年度 EPS × 历史价格自行重构近似分位"的方案**：Finnhub `/stock/metric?metric=all` 的 `series.annual.pe` 直接给出逐年财年末的 trailing PE 快照——真实验证 AAPL 26 年、TCEHY（0700.HK 经 `market.js` 的 `HK_ADR_MAP` 映射）22 年数据，比自行用年度 EPS 重构价格分位更准确，也更省工作量，因此改为直接消费这条序列，仍如实标注"近似口径"（样本是年度财年末快照，不是逐日分布）。`historicalValuation.js` 把"拉序列"（`getHistoricalValuationSeries`，24h TTL 缓存，命中是本地 DB 读）和"算百分位"（`computeHistoricalValuationPercentile`，纯函数）拆成两个函数——序列几乎不随时间变化、缓存收益最大，但百分位要用调用方当次的实时 PE 现算，不能连同百分位一起缓存 24 小时（那样会让"今天的百分位"用的是"24 小时前的现价"，属于隐藏陈旧）。挂进 `dataSources.js`：序列拉取与 market/financials 等其它数据源一起并发（8s 超时），等 financials/marketSnapshot resolve 后再用 `financialsData.pe`（优先）或 `marketSnapshot.pe` 现算百分位。样本 <5 年或当前 PE 不可用（缺失/≤0）诚实降级为 missing，不硬算。亏损年份（PE≤0）不计入历史分布——跟当前正 PE 比较没有意义。`financialData.financialsToMarkdown` 新增事实块，显式标"近似口径"字样（PLAN 红线11）；无数据时整段不出现。`factGuard.buildFactsRegistry` 直接学 F-4a 的教训——分位数（占比）、历史 PE 区间上下限与中位（倍数）在事实块一出现时就同步登记，不用等真实误报发生了再补。真实数据验证：AAPL 真实拉到 25 年年度 PE 序列（10.0~111.9，中位20.2），当前 PE 37.0 落在第 80 百分位；0700.HK 经 ADR TCEHY 真实拉到 22 年序列（14.6~58.4，中位32.9），当前 PE 16.5 落在第 9 百分位（真实浏览器提问验证：模型正确引用"PE处于历史第9百分位极低区间"，`fact_guard_audit` 落库确认百分位/区间数字全部 pass，无 hard 命中）。验证后已清理临时研究会话（保留 `fact_guard_audit`/`historical_valuation` 真实留痕数据）。`tests/phase-f5.mjs`（11 项：百分位纯函数含边界/样本不足/当前PE不可用降级、仓库落库、事实块条件渲染），`tests/phase-d2.mjs` 迁移版本断言更新到 11（新增 `historical_valuation` 表存在性检查）。全套测试/lint/typecheck 干净。 | 2026-07-06 |
| F-4b | 股东回报供数（港股）：`012_hk_buybacks.sql` 新表 `hk_buybacks`（一行=一份 HKEX"翌日披露报表"（FF305 表格）里核到的真实场内购回：交易日/购回股数/价格区间/总代价，source_url 唯一约束防重复摄取）。**先真实探测再动工**（延续 F-4a"真实调用先行、不假设端点行为"的方法论）：真实用 `hkFilingsPipeline.js` 已有的 `titleSearchServlet` 通道按标题关键词"購回"搜 0700.HK，确认这类公告（腾讯近一年 113 条，频率远高于业绩公告）是标准化的 FF305 表格，真实下载解析两份不同日期的 PDF 验证格式稳定：第二章节"購回報告"给出交易日/购回股数/价格区间/总代价的清晰表格行，第一部分 A 段额外给出"已發行股份（不包括庫存股份）"期末结存数，可作股本趋势的粗线数据源——探测结果比预期更结构化，不需要额外的复杂版式兼容（不同于 B-6 港股 PDF 三表管道踩过的复杂版式坑）。`hkFilingsPipeline.parseBuybackText`（纯函数，正则抽取）只解析第二章节的真实购回行，不解析第一部分 B 段"已购回作注销但尚未注销的股份"（那是累计未注销清单，口径不同，混用会重复统计同一批股份）；`ingestHkBuybacks` 复用与 `ingestHkFinancials` 相同的下载/抽取基础设施，`searchHkexBuybackAnnouncements` 复用相同的 `titleSearchServlet` 端点。`refreshHkBuybacksInBackground` 与财报摄取用独立的 inflight 集合，不互相抢占；24h TTL（回购公告频率远高于业绩公告的 135 天窗口）。`financialData.hkBuybackToMarkdown` 新增事实块：累计购回股数/总代价 + 股本趋势，**显式标注"购回注销有滞后，非即时净股本"**——HKEX 规则下购回股份在正式注销完成前仍计入已发行股份总数，这里能看到的只是"逐次披露间已发行股份数变化"的粗线趋势，不是精确的即时净股本变化（红线11"近似口径必须显式标注"的延伸）。`factGuard.buildFactsRegistry` 同 F-4a 纪律：只登记购回总代价（金额）和最近购回交易日（日期），不登记购回股数/已发行股份总数（股数量级与货币金额不同源，混进同一个桶会重演"股数当金额"的误报模式）。真实数据验证：真实摄取 0700.HK 近 180 天 15 份翌日披露报表（2026-06-01~2026-07-06，0 条解析失败）——累计购回 14,612,100 股，总代价约 64.44 亿 HKD，已发行股份从 9,118,067,827 股降至 9,092,370,719 股；真实浏览器发起"0700.HK 最近回购和估值分位怎么样"提问，模型正确引用全部真实数字（15次回购、64.44亿HKD、股本变化、PE历史分位），`fact_guard_audit` 落库确认新增事实全部 pass，无 hard 命中（当轮 1 处 hard 命中是"今日涨跌幅"符号误判的已知边界类别，与本次新增事实无关，记录在案不追加修）。验证后已清理临时研究会话（保留 `fact_guard_audit`/`hk_buybacks` 真实留痕数据）。`tests/phase-f4b.mjs`（11 项：购回报告纯函数解析、股本趋势解析、仓库落库+唯一约束、事实块条件渲染），`tests/phase-d2.mjs` 迁移版本断言更新到 12（新增 `hk_buybacks` 表存在性检查）。全套测试/lint/typecheck 干净。 | 2026-07-06 |

### 待办（本计划 F 轨，待对齐）

| 阶段 | 名称 | 状态 | 备注 |
|------|------|:---:|------|
| 顺手 | 研究历史 FTS（P7） | ⬜ | SQLite FTS5，可挂任意一程 |
| — | P3 级：R6 指引结构化 / C1 余项+C2 PWA / E6 缓存统一 / E7 名单可配置 | ⬜ | 记录在案，等时机（本轮复核无新信号） |
| — | P4 级：onboarding；远期：EA-6 / P8 商业化 | ⬜ | 明确缓做，条件见 §3 |

---

## 6. 怎么跑 + "完成"的定义（速查，承接 v1/v2）

```bash
npm install                 # 只有 better-sqlite3 一个原生依赖
npm run seed                # 建/重置本地 SQLite 种子库
npm run dev                 # http://127.0.0.1:4173
npm test                    # 415 用例（v2 收官时点），必须全绿（EXIT=0）再提交
npm run lint                # eslint（correctness 级）
npm run typecheck           # tsc 全量 0 error（已进 CI，勿回潮）
npm run doctor              # 能力体检；--live 才发网络探活
npm run canary              # 真实数据 canary（全管道探测，落库供设置页健康面板读）
npm run hk-coverage -- --limit=20   # 港股一手 filing 覆盖率增量扫描
# 后端无热重载！改 src/server/** 或 src/*.js 后要重启 node
# 隔离测试：LUVIO_DB_PATH=$TMPDIR/x.db PORT=4199 node server.js
```

**canary 不进 CI**：`npm run canary` / `npm run hk-coverage` 是本机/scheduler 职责（真实调用、消耗配额、需要 `.env` key）。

**一次改动的"完成"= 代码 + 对应测试（进 `tests/`，接入 `npm test`）+ §5 状态表标 ✅ + 一条中文 commit。** 浏览器可见的改动必须实跑验证；涉及外部数据源的改动必须真实调用验证（B-7 教训；F-2/F-4 的新端点尤其）。代码改动走 branch + PR 进 main；纯文档改动可直接 commit main。

**key 都在 `.env`（gitignored）**：GLM / DEEPSEEK / FMP / FINNHUB / TWELVEDATA / TAVILY。沙箱会墙搜索引擎，端到端 web 证据效果要在用户本机验证。
