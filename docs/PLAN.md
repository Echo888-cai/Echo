# Echo Research 主计划：从"点名一家公司"到"会研究的 Agent"

> **这是什么**：Echo Research 的**唯一权威计划文档**。它同时是两件事——① 面向未来的路线图；② 已建成部分的历史记录。取代此前所有分散的计划文档（MASTER_PLAN / NEXT_PLAN / PROJECT_PLAN / INTERACTION_MODEL_REFACTOR / RESEARCH_QUALITY_GAP_LOG / PLATFORM_BENCHMARK / HANDOFF）。
> **给谁看**：任何接手的人（人类或新的 AI 会话）。**自包含**——不需要先读其他文档就能开工。
> **怎么用**：读 §0 现状 → §1 北极星 → §3 找第一个未做的 EA 阶段 → 按"改法 + 验收"执行 → 更新 §5 状态表 → 一条中文 commit。
> **起草于**：2026-07-03。作者：用户 + Echo（AI 结对）。

---

## 0. 一段话现状（接手先读这条）

Echo 现在是"**单公司深度问答**"这一形态里做得最扎实的：一套宪法级研究纪律（`src/prompts.js` 的 `RESEARCH_DISCIPLINE`）、结构化决策面板（评级/估值条/证伪/溯源/置信度）、估值护栏（`valuationEngine.js` 的 stage-aware + 脏数据抑制）、防幻觉事实块、港美一手数据管道（SEC 8-K 结构化抽取 + 港股披露易 PDF 三表），全都在。工程也立住了：CI + ESLint + `npm run doctor` + 149 条测试、前端已从 3117 行单文件拆成 `src/ui/*` 十二模块、`scheduler` + 通知中心 + Telegram 让它有了主动性。

**但它的形态仍是"被动等你点名一家公司"**：会话表一行绑一个 ticker（`src/db/index.js:98`），路由在前端分流（公司问题走 `/api/chat`，筛选/宏观走 `/api/discover`）。用户要的是一个**会自己规划检索、能在一条对话里研究任意多家公司、能按主题选股、把判断自动沉淀进看盘**的研究员。

**核心洞察：这不是重写，是收敛。** 需要的散件大多已在代码里（见 §2 逐柱证据），要做的是把它们收敛成"**一个统一 Agent 入口 + 一套可复用、可扩展的分析框架注册表**"。

---

## 1. 北极星：一个统一的、会用框架的研究 Agent

把用户的诉求拆成五根柱子，全部进同一个入口，由服务端 Agent 决定调用哪些能力、要不要串起来：

```
用户在一条对话里问任何问题
        │
        ▼   /api/ask（统一入口：意图识别 + 受控规划，规则优先、必要时一步模型出计划）
 ┌──────┼──────────────┬───────────────┬──────────────┐
 ▼      ▼              ▼               ▼              ▼
解析公司  跨标的筛选/选股   多标的对比      宏观短评        网页证据
 │      │(套用分析框架排序) │              │              │
 └──────┴──────────────┴───────────────┴──────────────┘
        │
        ▼  组装回答（面板 / 名单 / 对比表 / 宏观）——每个被触及的公司都：
           ① 可在当前对话里展开成一个"公司分节"
           ② 自动沉淀进看盘（无需刷新）
           ③ 沉淀进长期画像
```

**红线理念**：投研要的是**可靠、可解释、可控成本**，不是炫技的多跳自主。规划器走"规则优先 + 至多一步模型出 JSON 计划 + 步数上限"，不做完全自主的 ReAct 循环。

---

## 2. 五根柱子 × 现状 × 差距 × 可行性

> 每根柱子先说"现在代码里已经有什么"（file:line 为证），再说"差什么"，最后给可行性。这样接手的人知道**在哪块地基上盖**。

### 柱 1 · 连续多公司对话（一条对话问任意公司、可跳转）
- **已有**：`chat.js` 的 `buildOtherHoldings` 能抽出问句里"当前公司之外"的标的并拉真实数据；`compareWith` 支持对话内并排对比；`history` 注入让追问承接上文。
- **差**：会话是"单 ticker 一行"（`db/index.js:98` `research_sessions.ticker`）。换一家公司要么丢上下文、要么另起孤立会话。侧栏按 ticker 列，不是按"一次对话"。
- **可行性**：中。加一个 `conversation_id` 分组列（老会话首跑 `conversation_id = id`，无损迁移），前端侧栏按对话分组、组内列公司。不动作答管线。

### 柱 2 · 判断自动沉淀进看盘（无需刷新）★用户明确强调
- **已有**：`chat.js:369-380` 已经在做"研究过的公司自动 `addToWatch`，并覆盖此前的手动隐藏"。看盘页的真实价格曲线、瘦列表、批量并发刷新都在（`watchDesk.js`）。
- **差**：① 只沉淀**会话主公司**——对话里顺带提到（`otherHoldings`）、对比（`compareWith`）、筛出来（screener）的公司**没有一起进看盘**；② 前端要**手动刷新**才看得到新增，不是实时。
- **可行性**：高。①把 `addToWatch` 从"只加 portraitTicker"扩到"本轮所有被拉过真实数据的 ticker"（几行）；②回答的 `final` 事件里带上"本轮新增看盘 [tickers]"，前端收到即乐观插入看盘列表 / 顶部提示"已加入看盘"。真正的实时。

### 柱 3 · 开放式投资问题，AI 直接答（"还能买吗 / 我能赚吗 / 基本面怎样 / 跟谁比"）
- **已有**：宪法 + `chat` 角色提示词（`prompts.js:156`）已经在回答这些——它要求先给资产阶段、点明"胜负手"、把证伪条件锚到具体数字。`intentClassifier` 已能分持仓判断/估值/风险/长期研究几类意图。
- **差**：这些高频问题没有被做成**一等的"问题模板"**——每类问题应有量身的回答骨架和该调用的框架（"还能买吗"→持仓决策框架 + 赔率；"跟谁比"→对比框架）。现在都糊在一个通用 chat 里。
- **可行性**：高。把常见投资问句归一到几个 `questionKind`，每个绑定一个分析框架（见柱 4）与回答骨架。纯提示词 + 路由工程，无新数据依赖。

### 柱 4 · 主题选股 + 可复用分析框架 ★★这是系统"能成年"最宝贵的资产
- **已有（皇冠明珠其实已经存在）**：`prompts.js` 里的宪法（`RESEARCH_DISCIPLINE`）+ 8 个角色框架（cio / 估值 / 风险 / 多空辩论 / 备忘录 / 组合纪律 …）就是"分析框架"。`financialQuality.js`（`computeFinancialQuality`）能算利润质量分。`discovery.js` 的 `runScreener` 能把中文筛选句解析成 FMP screener 条件。
- **差（两块）**：
  1. **框架焊死在提示词里**：它们是硬编码字符串，不是"可命名、可版本化、可按问题类型选用、将来可被用户自定义"的注册表。这是通往"用户自定义 skill"的必经一步。
  2. **选股太浅**：`SECTOR_MAP`（`discovery.js:24`）只有大行业，**没有"光互联/CPO/液冷/存储"这种赛道**；名单只按市值排，**没有"值得买"的排序口径**。你举的"做光互传的哪些值得买"现在会落空。
- **可行性**：中高，且**回报最大**。分两步：①把框架抽象成 `frameworks` 注册表（`{ id, name, appliesTo, systemPrompt, rubric }`），Agent 按 `questionKind` 选用；②深化选股——赛道子行业词典 + 用 `financialQuality`/估值分位做**可解释排序**（"值得买"= 筛 + 按框架打分排序，每行给一句"为什么它排前面"）。

### 柱 5 · 研究前端重设计 + 用户自定义 skill（远期）
- **已有**：前端已模块化（`src/ui/*`），3-Tab IA（研究/看盘/持仓），结构化组件（估值条/溯源卡/对比表）齐全。
- **差**：IA 仍以"单次研究"为中心。要以"**对话为容器**"重构：一条对话里多家公司并列成卡/分节、看盘沉淀实时可见、选股名单可一键把整批开进对话。用户自定义 skill 是柱 4 注册表落地后的自然延伸（写自己的选股/研究框架）。
- **可行性**：中。纯前端重构 + 柱 1/2/4 的服务端产物驱动。**不引入 React/Vue 全家桶**（沿用 vanilla ESM，见 §4 红线）。

**总可行性判断：绿灯。** 五根柱子里三根（2/3/4-①框架化）是高可行、低破坏的增量；两根（1 会话模型、5 前端重构）是中等工作量的渐进升级。没有任何一根需要推翻现有后端管线或换技术栈。

---

## 3. 分阶段计划（EA = Echo Agent）

> 原则：每阶段可独立浏览器验证、进 `tests/`、单独提交。**先地基后能力，破坏性从小到大。**

### EA-0 · 统一入口 + 服务端意图路由（地基，≈1 天）
- **为什么**：分流现在散在前端；做 Agent 前必须收敛到服务端一处。
- **改法**：新增 `src/server/routes/ask.js` → `/api/ask`，内部先跑 `intentClassifier` 统一判定 `company | screener | macro | compare`，再 dispatch 到现有服务。前端 `sendChat` 改为只调 `/api/ask`，按返回的 `kind` 选渲染分支。旧 `/api/chat`、`/api/discover` 降为内部实现，对外只留一个口。
- **验收**：同一输入框，"腾讯怎么样"/"筛美股半导体 PE<20"/"美股今晚有什么事"三类都从 `/api/ask` 正确分派；`tests/` 加意图分派单测；无回归。

### EA-1 · 分析框架注册表 + 工具层（皇冠明珠的地基，≈2 天）★
- **为什么**：柱 4 的核心。让"框架"从焊死的提示词变成一等公民，才能被 Agent 选用、被用户扩展。
- **改法**：
  1. `src/server/frameworks/`：把 `prompts.js` 的角色框架抽成注册表条目 `{ id, name, appliesTo:[questionKind], systemPrompt, rubric }`（先迁移，不改内容，保证零行为变更）。宪法作为所有框架共享的前缀。
  2. `src/server/services/agentTools.js`：把已有能力包成统一签名工具 `{ name, description, inputSchema, run() }`——`resolveCompany` / `screenStocks`（复用 `runScreener`）/ `researchCompany`（复用 `agentService`）/ `compareCompanies` / `macroRead` / `webEvidence`。
- **验收**：每个框架/工具可单测（`tests/frameworks`、`tests/agentTools`），schema 稳定；`ask.js` 改为经工具 + 框架作答，输出与迁移前逐字节一致（快照对比）。

### EA-2 · 受控规划器 + 问题模板（让 Agent 会串工具、会挑框架，≈2 天）★核心
- **为什么**：柱 3 + 柱 4 的心脏。"美股存储芯片有什么好标的"= `screenStocks(存储)` → 按利润质量排序 → 名单；"英伟达和 AMD 谁赔率好"= `resolve×2 → compareCompanies`；"还能买吗"= 持仓决策框架 + 赔率。
- **改法**：`agentPlanner.js`——规则先行（能确定的直接给计划），不确定时让模型出**一个** JSON 计划 `[{tool,args}]`，校验后顺序执行、聚合。每类 `questionKind` 绑定回答骨架 + 该用的框架（EA-1 注册表）。全程超时 + 工具失败降级（挂了给"已取到的部分 + 诚实缺口"）。**红线**：计划步数 ≤3。
- **验收**：三类复合问题端到端跑通、浏览器可见；计划可在响应里回显（可解释）；模型不可用时规则兜底仍给结果。

### EA-3 · 深化选股：赛道词典 + 可解释排序（把"值得买"做实，≈2 天）
- **为什么**：柱 4 的另一半。现在选股太浅（`discovery.js:24` 无赛道、`:72-73` 忽略股息/增速、只按市值排）。
- **改法**：
  1. **赛道子行业词典**：`SECTOR_MAP` 加"光互联/CPO""液冷""存储/HBM""EDA""设备"等细分（多为关键词 → FMP industry + 已知龙头名单兜底）。
  2. **"值得买"= 可解释排序**：名单用 `financialQuality` 分或估值分位排序，每行附一句"为什么排前面"，而非只按市值。
  3. **compareCompanies**：2–3 个 ticker 并排（估值/利润质量/增速/共识），复用 `answerComposer` 数据块，前端出对比表。
- **验收**："做光互联的哪些值得买"给出带排序理由的名单；"存储芯片龙头对比"给并排表；`tests` 覆盖新解析。

### EA-4 · 对话即容器 + 全标的自动进看盘（会话模型升级，≈2–3 天）★用户明确要
- **为什么**：柱 1 + 柱 2。一次研究里并列多家公司、可跳转；对话里被触及的每家公司自动、实时沉淀进看盘。
- **改法**：
  1. **数据**：`research_sessions` 加 `conversation_id`（可空，默认自身）。老会话首跑 `conversation_id = id`，无损迁移。
  2. **自动进看盘扩面 + 实时**：`addToWatch` 从"只加主公司"扩到"本轮所有拉过真实数据的 ticker"；`final` 事件带"本轮新增看盘 [tickers]"，前端乐观插入、无需刷新。
  3. **前端**：发现层名单/对比里的公司"打开"即在**当前对话**下新增一个公司分节（tab/分节），侧栏按对话分组、组内列公司；跳转不清空其他公司的已研究结果；切分节时 composer 的"当前标的"随之切换。
- **验收**：一次对话里研究腾讯 → 筛光互联 → 打开中际旭创，三者都在侧栏同一对话组下可来回跳、各自保留面板；三家都自动出现在看盘且未刷新页面；刷新后结构不丢。

### EA-5 · 研究前端重设计（以对话为中心，≈2–3 天）
- **为什么**：柱 5。让灵活性在 UI 上兑现。
- **改法**：研究页从"单次问答流"重构为"对话工作台"：多公司卡/分节并列、看盘沉淀实时角标、选股名单"一键整批开进对话"、常见投资问句做成快捷入口（还能买吗/基本面/跟谁比）。纯前端，vanilla ESM。
- **验收**：一条对话内完成"筛赛道 → 批量研究 → 对比 → 自动进看盘"全流程，无需跳页；移动端可用（承接下方 C 轨）。

### EA-6 · 用户自定义 skill（远期，需求验证后再做）
- **为什么**：柱 5 远期。EA-1 注册表就绪后，用户能写自己的选股/研究框架（soul.md 式）。
- **改法**：`user_frameworks` 表 + 一个"框架编辑器"（名称/适用问题/系统提示/评分维度）；Agent 把用户框架并入候选。**做之前先有真实用户在用内置框架**，否则是过早抽象。
- **验收**：留待有真实需求；本条防遗忘。

---

## 3.5 配套并行轨道（不阻塞主线，可穿插）

- **B 研究质量深化**（2026-07-04 起主线，EA-5 完成后用户明确定的下一程）：前端终端骨架已成型，重心转向"研究本身"——事实锚定、财报理解、估值逻辑、公司对比、风险识别、结论置信度，让报告更像专业研究员写的东西。子阶段：B-1 置信度事实锚定护栏（✅，见状态表）；B-2 财报趋势判断（✅，单期同比 → 多期连续趋势/拐点识别，见状态表）；B-3 公司对比升级（✅，并排数据表 → 排序 + 胜负手判断，见状态表）；B-4 风险识别去占位符化（✅，`riskEngine.js` 从死代码变成真正接入的风险雷达，见状态表）；B-5 港股估值口径（✅，一手 HKEX 三表数据从"只当证据引用"接进估值引擎数值字段，见状态表）；B-6 `hkFilingsPipeline` 扩标的（✅，见状态表）；B-7 非沙箱实测 Tavily web 证据（✅，见状态表，抓到裸日期前缀污染搜索查询的真 bug）。B 主线子阶段全部完成。旧编号 B1-B3（web 证据/估值口径/filings 覆盖）并入此列表（B-7/B-5/B-6），不重复维护两份。
- **C 移动端**：C1 `src/styles/` ≤768px 响应式（侧栏抽屉、看盘全宽、composer 固定底、点按区加大）；C2 PWA（`manifest.webmanifest` + service worker，可加桌面/收推送）。**后端一行不动**。
- **D 架构加固**（2026-07-04 起主线，B 主线完成后用户明确定的下一程，明确跳过 C/P8）：B track 期间系统能力涨得快，用户要求先把架构稳定性、类型约束、迁移机制、代码清理和回归测试体系打牢，再继续堆功能，避免技术债累积。现状盘点（Explore agent 调研）：**D1**（JSDoc/`checkJs`）无 `jsconfig.json`，`src/server/`56 文件仅 12 个有 JSDoc、`src/ui/`13 文件 0 个，约 1.4 万行待覆盖，无类型工具依赖；**D2**（DB 迁移器）14 张表分散在 11 个文件里各自 `ensureTable()` 自迁移（`src/db/index.js` 集中 5 张核心表，其余 9 张散在各 repository），无 `user_version` 版本追踪，已有一处手写一次性 backfill（`companyProfiles.js` 的 `backfillLegacyEvents`）；**D3**（工具内化）EA-1 工具层已就绪，`discover.js` 已是薄封装（31 行），但 `chat.js`（652 行）仍有约 400 行编排逻辑（`runChat`/`finalizeChat`/`buildFinalThread` 等 17 个辅助函数）焊死在路由层，工具层目前只能薄封装外层调用、复用不了这段编排。**按风险从高到低排定推进顺序**（不改变 D1/D2/D3 编号，只定执行顺序）：**D2 先做**（✅ 见状态表，用户明确数据库未上生产、可直接清库重来，范围收窄为"只建最终形态"而非"非破坏性迁移旧数据"，成本比原评估更低）；**D3 次之**（✅ 见状态表，`chat.js` 编排逻辑已搬进 `chatOrchestrator.js`，逐字节 diff 核对无行为变化，浏览器实测无回归）；**D1 最后**（🟡 见状态表，第一批已完成——`jsconfig.json`+`checkJs`基建 + dataSources/valuation/research session/watchlist/portfolio/chat orchestration 六类跨模块对象的类型声明，`src/ui/**` 和其余 server 文件留给后续批次，避免一次性大量 annotation 造成噪音）。子阶段状态见状态表。

**注**：D2 完成后用户明确了一条后续规则——从现在起，任何涉及真实用户数据（研究历史/持仓/watchlist）的 schema change 都必须走非破坏性 migration，不再默认清库重来（D2 的"直接清库"是一次性特例，前提是当时数据库未上生产）。

---

## 4. 商业化（P8·需用户逐项对齐，AI 不自行推进商业条款）

> 这一阶段每一步都要用户决策（定价、目标用户、渠道）。这里只列**技术前置**与**护城河判断**。

- **护城河 = 分析框架资产（柱 4）**：结构化决策面板 + 可复用/可扩展的分析框架，是纯文本竞品给不了的。商业化叙事应围绕"**一套会自我沉淀、可被你调教的研究框架**"，而非又一个聊天机器人。用户自定义 skill（EA-6）是付费墙的天然落点。
- **技术前置**（记录在案，到点再做）：
  - **多用户**：现有 portfolio/watchlist/sessions/profiles 无 user 维度。约束：**今后新表一律带 `user_id TEXT DEFAULT 'local'`**；商业化时做一次统一迁移（local→PG 双模式）。
  - **合规阻断项**：港股实时价现走腾讯免费接口（个人可用，**商用无授权**）。商业化前必须换有授权源（iTick / 富途 OpenAPI / LSEG / HKEX 直接授权）。
  - **计费盲区**：`modelGateway` 调用未留痕。需 `llm_audit` 表（provider/model/purpose/token/延迟/状态）+ 单价，才能算清单位成本。
  - **auth / 配额 / 部署 / 监控**：邀请制起步 → 配额钩子 → Dockerfile + 数据备份 → 云部署。
  - **合规文本**："研究参考，非投资建议"已是提示词纪律，要落到 UI 明示。

---

## 5. 状态跟踪表（做完就地更新）

### 已建成（历史，压缩记录——细节见 git log）

| 里程碑 | 内容 | 完成于 |
|--------|------|--------|
| P0 | 工程门禁：CI + ESLint + `npm run doctor` | 2026-07-02 |
| P1 | 主动性：scheduler + 通知中心 + Telegram（misfire 补跑） | 2026-07-02 |
| P2 | 研究→监控闭环：证伪条件→`watch_rules`→巡检命中通知；看盘 fast 刷新 + 筛选/排序 | 2026-07-02 |
| P3 | 组合体检：集中度/无止损/触线/回撤 + 一句话结论 | 2026-07-02 |
| P4 | 画像文档化：`profile_events` 独立时间线 + markdown 主档案 + 公司页画像 Tab | 2026-07-02 |
| P5 | 前端模块化：`app.js` 3117→170 行，拆成 `src/ui/*` 12 模块（零行为变更） | 2026-07-02 |
| 品牌 | Luvio → **Echo Research**：牛皮纸 + 陶土视觉；slogan "Seek signal. Ignore noise." | 2026-07-02 |
| P6 | 发现层：筛选器（FMP screener + 本地池）+ 宏观路由（指数 + 证据 + macro 框架） | 2026-07-02 |
| P7 | 港股一手管道：披露易 PDF 三表抽取 + 8-K 结构化抽取（美股） | 2026-07-03 |
| 交互重构 | 对话内多标的真实数据 + 组合体检 + 宏观路由 + 港美双上市口径 + 裸代码解析补腿 | 2026-06-30 |

### 待办（本计划）

| 阶段 | 名称 | 状态 | 备注 |
|------|------|:---:|------|
| EA-0 | 统一入口 `/api/ask` | ✅ 2026-07-03 | 服务端路由权威 routeAsk(带 company→chat；否则分类 screener·macro)；runChat/runDiscover 抽出复用(EA-1 工具层落点)；前端只改调用 URL、路由逻辑零变更；实测四类分派+SSE final 全通；测试 +12 |
| EA-1 | 分析框架注册表 + 工具层 ★ | ✅ 2026-07-04 | `src/server/frameworks/index.js` 把 `PROMPTS` 9 个角色框架收敛成 `{id,name,appliesTo,systemPrompt,rubric}` 注册表（systemPrompt/rubric 与迁移前逐字节一致，零行为变更）；`src/server/services/agentTools.js` 包 6 个统一签名工具（resolveCompany/researchCompany/screenStocks/compareCompanies/macroRead/webEvidence，均薄包装已有服务，run() 失败返回 `{status:"error"}` 不抛出）；`chat.js` 的 `buildCompareSummary` 导出供工具层复用；测试 `tests/phase-ea1.mjs` +43，`npm test` 全绿 |
| EA-2 | 受控规划器 + 问题模板 ★核心 | ✅ 2026-07-04 | `src/server/services/agentPlanner.js` 落地实际存在的复合问题——"两标的对比"句式（如"英伟达和AMD谁赔率好"）：规则先行识别比较句式 + 拆候选标的 → 逐个 resolveCompany（EA-1 工具层，≤3 步）→ 命中两个不同标的就注入 compareWith，复用既有 runChat/comparison 管道（前端对比表零改动）；ask.js 接入、响应回显 `plan`。已在浏览器实测：本地公司对（腾讯×阿里巴巴）与真实外部标的（英伟达×AMD，经 resolveCompanyFromQuery 网络解析）均正确渲染对比表+模型赔率对比。测试 phase-ea2.mjs +14。**范围裁剪**：模型兜底的 JSON 计划步未做——目前规则已覆盖唯一存在的复合模式，没有真实场景驱动这块，先不做过早抽象；"存储芯片选股排序"这类划给 EA-3（"值得买"排序本就是 EA-3 的活，不重复建）；"还能买吗"式追问已被现有 chat/cio 框架接住，不需要新问题模板 |
| EA-3 | 深化选股：赛道词典 + 可解释排序 | ✅ 2026-07-04 | `discovery.js` `SECTOR_MAP` 新增 5 个细分赛道条目（光模块/光通信、液冷、存储芯片/HBM、EDA、半导体设备），带 HK/US 已上市龙头名单兜底（FMP industry 枚举装不下这些主题词），排在通用大类前保证优先命中；新增 `rankByQuality()`：对候选池前 8 家并发拉财务数据算利润质量分（复用 `financialQuality.js`），按分排序并给每行一句"为什么排这里"，超时兜底降级为原市值/已研究序；前端 `renderScreenerBlock` 加"为什么排这里"列。浏览器实测"帮我筛一下做光互联的美股，哪些值得买"：正确命中赛道→给出 4 家龙头→按质量分降序（75/72/64/61）排列且理由可读。顺带修了一个被此改动曝光的既存 bug：现价列 `Number.isFinite(Number(null))===true` 导致渲染出字面量 "null"，已修正为先判 `!= null`。测试 phase-ea3.mjs +16（纯函数，无网络）。**范围裁剪**：`compareCompanies` 2–3 标的并排表未做（现有 2 标的对比已够用，多标的对比留待有真实需求）；FMP 免费档 screener/batch-quote 普遍 402/403（预先存在的限制，非本次引入），价格/PE 列常显示"—"，已在 notes 里诚实注明 |
| EA-4 | 对话即容器 + 全标的自动进看盘 | ✅ 2026-07-04 | **柱2（自动进看盘）**：`chat.js` 新增 `watchCandidatesFrom()` 纯函数，把"该进看盘的标的"从只认会话主公司扩到主公司+对比对象（compareData）+ 对话里其他持仓（otherHoldings，只算真拉到 summary 的，壳记录排除）；`finalizeChat` 用它算出 `newlyWatched` 差集（此前已在看盘的不重复提示）随响应回传；前端 `applyChatResult` 收到后台刷新看盘 + 对非主公司的新增单独 toast，无需手动点刷新。浏览器实测：问"腾讯和阿里巴巴谁赔率好"（会话主公司是阿里巴巴，腾讯是自动补的对比对象）后，看盘页在未手动刷新的情况下已出现阿里巴巴（此前只有腾讯/NVDA）。测试 phase-ea4.mjs +11。**柱1（对话即容器/会话按对话分组）** 在 EA-5.1 补齐，见下一行 |
| EA-5 | 研究前端重设计（对话为中心） | ✅ 2026-07-04 | 拆成 5 个子阶段推进，每阶段浏览器实测 + 测试全绿。**EA-5.1（会话分组地基，吸收 EA-4 遗留柱1）已完成**：`research_sessions` 加 `conversation_id`（`researchSessions.js` 的 `SCHEMA`/`ensureColumns` 自迁移，老行落空时 `COALESCE` 退化为自身 id，无损）；新增 `listConversations()` 按对话分组、组内按研究顺序列出途经公司；新增只读端点 `GET /api/research/conversations`；前端 `state.js` 加 `conversationId`（换公司不变，仅"新建研究"时重置，与 `sessionId` 的生命周期解耦）；`research.js` 侧栏改按分组渲染（`renderConversationGroup`，单公司组退化成原单行、零视觉噪音）。浏览器实测：新建研究问腾讯→同对话追问阿里巴巴（触发 switch-divider 公司切换）→侧栏正确显示"腾讯最近怎么样？· 2 家公司"分组，组内两行可各自跳转恢复；旧数据（迁移前的历史会话）仍按单行展示，零回归。测试 `phase-ea5-1.mjs` +10。**EA-5.2（全局终端壳）已完成**：侧栏（当前研究快照 + 会话分组历史）从"研究页专属"提升为跨页全局导航——新增 `src/ui/sidebar.js`，把原本焊在 `research.js` 里的 `renderSnapshotCard`/`renderSessionHistory`/`renderConversationGroup`/`renderSessionItem`/`companySubtitle` 整体搬迁（纯移动，逻辑不变）出来，导出 `renderGlobalSidebar()`；`shell.js` 的 `shell(content, { sidebar = true })` 默认把 `.workspace` 网格（侧栏 + 内容列）套在所有页面外层，`research.js`/`watch.js` 零改动享有同一侧栏，只有 `settings.js` 显式传 `{ sidebar: false }` 关闭（设置页与研究上下文无关）。浏览器实测：看盘列表页、个股详情页现在都能在左侧看到"当前在研公司 + 历史对话分组"，点历史项直接跳转恢复对应研究，不用先切回研究页；设置页确认仍无侧栏、研究页布局零回归。测试无需新增（纯前端搬迁，行为不变，既有测试全绿覆盖）。**EA-5.3（公司工作区多标的分节 Tab）已完成**：`research.js` 新增 `renderCompanyTabs()`，取当前 `conversationId` 下 `S.recentSessions` 里的全部成员渲染成一排 Tab（只在同一对话换过 ≥2 家公司时出现，单公司对话不产生视觉噪音），插在 `desk-head` 和对话流之间；点击复用既有 `data-action="load-session"` 机制跳转恢复该公司当时的研究快照，和侧栏嵌套行走同一条路径，只是前置到主内容区，不用先展开侧栏历史才能切公司。浏览器实测：腾讯/阿里巴巴那组对话里 Tab 正确显示两家公司，点"阿里巴巴" Tab 立即切换 desk 标题、正文与激活态，"已恢复历史研究"提示正常。**EA-5.4（上下文面板：看盘+持仓跟随当前标的）已完成**：`sidebar.js` 新增 `renderContextCard(company)`，插在快照卡和历史列表之间——数据全部来自 app.js 启动时已全局加载的 `S.watchDesk`（不发新请求，纯派生），显示当前研究公司的看盘状态（复用 `wd-status`/`wd-intact`/`wd-risk`/`wd-falsified` 既有配色类，零新样式语义）+ 持仓盈亏（`held`/`returnPct` 判断逻辑与 `watch.js` 的 `renderWatchRow` 完全一致）；找不到对应看盘卡片（比如研究还没跑完、尚未自动进看盘）就不渲染，不留半截空壳。浏览器实测：切到腾讯/阿里巴巴 Tab 时侧栏对应显示"看盘状态·逻辑还在""持仓·未持有"，随当前标的切换实时更新。**EA-5.5（收尾）已完成**：移动端浏览器实测——`.workspace` 在 ≤1080px 既有的响应式规则（网格塌成单列，`.sidebar` 用 `order:2` 排到内容下方）对新的全局侧栏、上下文面板、公司分节 Tab 全部自动生效，未发现断裂（研究页/看盘列表页/个股详情页均验证，侧栏含分组历史+上下文面板在内容下方完整可滚动查看）；`npm test` 全程保持 109 用例全绿，`npm run lint` 0 error。**范围裁剪**：真正的移动端专项打磨（触控区加大、侧栏抽屉化等）留给并行的 C 轨（C1），不在本次 IA 重构范围内重复做 |
| EA-6 | 用户自定义 skill | ⬜ | 远期，需求验证后 |
| B-1 | 置信度事实锚定护栏 | ✅ 2026-07-04 | **用户 2026-07-04 定的下一程**："事实锚定/财报理解/估值逻辑/公司对比/风险识别/结论置信度"六块现状盘点（Explore agent 调研）显示：估值引擎、财报质量打分框架本身扎实（`valuationEngine.js` 亏损股 EV/Sales 护栏、`financialQuality.js` 7 维打分都在），但**置信度是虚的**——`decisionPanel.js` 里模型自称的 confidence 会被 `pickModelOverrides()` 原样透传进最终面板，模型说"高"就是"高"，不管实际接地的数据维度（行情/财报/预期/公告/新闻）薄不薄，宪法承诺的"事实锚定"红线只在提示词里、代码没真正校验。改法：新增 `reconcileConfidence(modelConfidence, groundedConfidence)` 纯函数（`decisionPanel.js`）——模型自称的置信度不能超过 `deriveConfidence()` 算出的真实接地上限，超了就下调并生成 `confidenceNote` 说明原因；模型给的置信度低于或等于接地上限则尊重模型判断（不强行拉高，因为模型可能看出数据之外的矛盾）。`pickModelOverrides()` 的白名单去掉 `confidence`（这正是护栏被架空的根因）。前端 `sidebar.js`/`components.js` 的置信度 chip 在有 `confidenceNote` 时加 ⓘ 图标 + title 提示。浏览器实测：新研究（拼多多，数据 5/5 接地）置信度"高"、模型判断与接地一致、无 ⓘ 提示，零回归；`reconcileConfidence` 的下调分支用单测覆盖（真实模型输出很难在浏览器里可控地造出"证据薄却自称高"的场景）。测试 `phase-b1.mjs` +13。**下一步**：B-2 财报趋势判断（单期同比→多期连续趋势）、B-3 公司对比升级（并排表→排序+胜负手）、B-4 风险识别去占位符化 |
| B-2 | 财报趋势判断（多期连续趋势） | ✅ 2026-07-04 | `financialData.js` 新增 `classifyTrend(growthRatesAsc)` 纯函数——把逐年增速分类成"连续放缓/加速/由正转负拐点/由负转正拐点/企稳/波动无方向"5 种，取代"只看最新一期同比"。**踩坑记录（很重要）**：先给 FMP 路径（`fetchFmpFinancials`，limit 2→6）接了趋势，浏览器实测却发现 AAPL 走的是 **Finnhub 兜底路径**（`source: "Finnhub"`）——FMP 的 `/stable/income-statement` 被 402 Premium 挡住是已知的预先存在限制（README 早有记录），我加的 FMP 端趋势代码对当前免费档形同摆设。追查后发现 Finnhub `/stock/metric?metric=all` 的免费档其实带 `series.annual.*`（实测 AAPL 有近 40 年的 `salesPerShare`/`eps` 年度序列！），于是新增 `trendFromAnnualSeries()` 把这份免费数据接进 `fetchFinnhubFinancials()`，用每股口径代理绝对值算趋势。`financialsToMarkdown()` 把趋势句子喂进模型提示词；`decisionPanel.js` 的"基本面"keyDriver 有趋势时优先说趋势。浏览器/API 实测：问"苹果的财报增速趋势连续几年了" → 模型答案里出现"苹果近6期年报收入增速依次为：38.5% → 11.4% → 0.4% → 4.7% → 9.3%""利润增速趋势...同样显示拐点"，不再是单期"+9%"这种孤立数字。测试 `phase-b2.mjs` +16（`classifyTrend`/`trendFromAnnualSeries`/`financialsToMarkdown` 全覆盖，纯函数无网络依赖）。**范围裁剪**：港股趋势（Tencent/hkFilingsPipeline 路径）未做，留给 B-5/B-6；FMP 路径的趋势代码保留（未来换付费 key 就自动生效，非浪费） |
| B-3 | 公司对比升级：排序 + 胜负手判断 | ✅ 2026-07-04 | `chat.js` 新增 `judgeComparison(left, right)` 纯函数——只用两个可比、可解释的维度下结论：利润质量分（经营确定性）+ 回报风险赔率（当下值不值得买）。两个维度一致占优才敢说"谁更优"；指向不同方向标 `mixed` 并列出双方各自的优势维度；数据不够标 `insufficient`，绝不硬编赢家（B-1 事实锚定护栏在对比场景的延伸）。`buildComparison()` 把 `verdict` 挂进返回值；前端 `renderComparisonTable()` 在表格上方加一条"胜负手"提示条（赢家徽章 + 具体数字理由）。**浏览器实测抓到一个真 bug**：先版本对两个维度"胜负不一致"一律归为 `mixed`，没单独处理"其中一个维度其实是打平"的情况——用 NVDA vs AMD 赔率恰好都是 1.3:1 实测时，AMD 被误判成"赔率更好（1.3:1 vs 1.3:1）"，明明相等却说更好。修复：赔率或质量分打平时先归零成"这维度打平"，只让真正决定性的那个维度定输赢，不能把 tie 误当某一边胜出。测试 `phase-b3.mjs` +16（含这个回归场景的专项用例）。浏览器复测：胜负手提示条正确显示"英伟达 NVIDIA 更优 · 利润质量分更高（100 vs 72），赔率两者接近（1.3:1 vs 1.3:1），质量上占优"，表格里利润质量行正确高亮。 |
| B-4 | 风险识别去占位符化 | ✅ 2026-07-04 | **发现死代码**：`riskEngine.js` 的 `buildRiskRadar()` 一直没被接进主链路——真正显示的风险只是 `decisionPanel.js` 里 `profile.risks` 原样回显 + 一个万能占位 evidence（`"来自 seed profile，待公告核验"`），审计点名的"evidence 都是占位符"正是这里。改法：① `riskEngine.js` 的 evidence 从无意义字符串 ID（如 `'fin_de_high'`）换成和 `decisionPanel.js` 同形状的真实对象（source/asOf/quote/confidence/missingReason，每条都能看出从哪个数据源、哪个数字来的）；② 新增财报趋势驱动的风险识别——复用 B-2 的 `revenueTrend`/`profitTrend`，"连续放缓"标中风险、"由正转负拐点"标高风险，比原来单期"收入增速 < -10%"的阈值更早预警，收入和利润趋势独立判断（利润恶化可能先于收入暴露）；③ `decisionPanel.js` 把 `riskTriggers` 从 `profile.risks` 空转改成真调用 `buildRiskRadar()`。**浏览器实测抓到两个真发现**：一是 PDD 拼多多的利润增速序列 190%→302%→88%→85%→**-13.2%** 被正确识别为"利润增速转负（拐点）"高风险，证明趋势驱动的风险识别真的在工作；二是苹果这种财务健康、什么都没踩线的公司，旧的兜底文案统一说"缺乏足够数据构造风险雷达"——明明行情/财报/新闻全部 ok，只是没触发阈值，却被误说成"数据不足"，具有误导性。修复：区分"数据真的缺"（老实说数据不足）和"数据够但没踩线"（改说"未识别到需要警惕的风险信号"，这是积极结果不是缺口）。测试 `phase-b4.mjs` +18；顺带修了 `tests/phase3.mjs` 里因字段改名（`risk`→`label`）失效的既存用例。`npm test` 全绿（169 用例），lint 0 error。 |
| B-5 | 港股估值口径 | ✅ 2026-07-04 | **发现死数据**：`hkFilingsPipeline.js` 已经从 HKEX PDF 抽出真实三表（revenue/净利/现金流），但 `dataSources.js` 只在第三方源（腾讯免费接口）**全挂**时才把它提升为主数据——腾讯几乎总能成功（有价格/PE/市值），只是 revenue/净利/现金流全是 null，导致一手真实数据被晾在 `financialsData.hkFilings` 只当证据引用，从没进过估值引擎的数值字段，这正是"港股估值退化成机械 PE 带"的根因。改法：新增 `mergeHkFinancialGaps()`（`dataSources.js`）——第三方成功但字段是 null 时按字段补空（revenue/净利/现金流等绝对金额字段做人民币→港元近似汇率折算，`eps` 故意不补，避免和腾讯自带的 `pe` 混用币种拼出假自洽 PE）。**浏览器/真实数据实测连续抓到 3 个真 bug**：① `valuationEngine.js` 的 DCF 净现金计算用 `&&` 判断，无负债公司 `totalDebt===0`（falsy）会被当"数据缺失"，净现金再多也不计入——同样的 bug 修了 EV/Sales 情景一侧（改用显式 `netCash` 优先 + `??` 判断）；② 腾讯港股数据源的股本字段一直叫 `totalShares` 而不是其它源统一用的 `sharesOutstanding`，导致纯港股（无 FMP/Finnhub 三表）从未被 EV/Sales 情景读到过股本，永远走不通亏损股估值路径；③ 真实拉腾讯 + hk_financials 数据实测阿里巴巴（9988.HK）时发现：`classifyAssetStage` 对 eps/净利率/经营利润率三者做 OR 判亏损，阿里 26Q1 经营利润率 -0.05%（一次性费用噪音）而净利率 +9.7%、EPS +15.07 清晰为正，却被单独告负的经营利润率整体误判成"亏损高成长"，套 EV/Sales 情景会算出远低于合理区间的估值带——改成经营利润率只在净利润/EPS 都缺失时才当亏损信号用，净利润/EPS 才是主信号。真实拉取 0700.HK（腾讯）验证：merge 后 `revenue`/`netIncome`/`netCash` 从 null 变成真实数字（2121亿/641亿/1586亿），`firstPartySupplement: true`。**范围裁剪**：小鹏汽车（9868.HK）等部分港股的 HKEX 业绩公告 PDF 格式解析失败（"解析不到收入/盈利行"），尚无一手数据可合并，留给 B-6（filings 覆盖）；Tencent 自身 PE/EPS 数值偶发自相矛盾（如 0700.HK/9988.HK 的 PE×EPS 反推价格与实际现价对不上）导致仍会走"以现价为中心 PE 带"兜底，这是腾讯免费接口的原始数据质量问题，不在本次范围。测试 `phase-b5.mjs` +12，`npm test` 全绿（181 用例），lint 0 error。 |
| B-6 | 港股 PDF 解析扩标的 | ✅ 2026-07-04 | `hkFilingsPipeline.js` 从只认腾讯/阿里两栏标准版式，扩展到真实港股 PDF 常见的复杂版式：新增 `collapseCharSpacing()`（逐字符分词坍缩，不动分栏用的多空格）+ `normalizeCjkVariants()`（NFKC 折回康熙部首变体，汇丰式财报常见）；`parsePeriodFromTitle()` 兼容无「截至…止…日」从句的裸年度/合刊标题；`parseResultsText()` 新增小鹏式 4 栏（去年同季/上季/本季/美元换算列，需跳过美元换算列取人民币本期值）、阿里式币种表头带额外说明列、汇丰式银行业词汇（"本年度利润"/"母公司普通股股東"等）+ 单位在前的币种表述。**AIA 特殊处理**：保险股附注分项表会解析出人为负值收入，验证既有 `ingestHkFinancials` 负值护栏能正确拒收而不是把错误数字写进估值引擎（宁可缺数据也不要假数据）。浏览器实测：小鹏汽车（9868.HK）从"HKEX PDF 解析不到收入/盈利行"到真实拿到三表数据，走通 CNY→HKD 换算 → 估值引擎 → EV/Sales 情景估值全链路；AIA 因保单特殊财报结构被正确 fail-safe，不产出误导性估值。测试 `phase-b6.mjs` +28，`npm test` 全绿（235 用例），lint 0 error。 |
| B-7 | web 证据非沙箱实测 | ✅ 2026-07-04 | **真实调用 Tavily/Bing 搜索源实测（非 mock）抓到一个真 bug**：`intentClassifier.js` 的 `buildEvidenceQueries()` 和 `discovery.js` 的 `buildMacroQueries()` 对含"今天/最近/最新"等相对时间词的问题，会用 `anchorQueryToDate()` 把裸日期（如"2026-07-04"）拼进搜索关键词——本意是"先对齐时间再搜"，但真实调用 Bing 发现它会把裸日期当"年份 2026" token 处理，返回一堆"2026年"通用内容（世界杯赛程、政府工作报告解读）把公司相关结果整体挤出结果页。用小鹏汽车（9868.HK/XPEV）真实检索复现：加日期前缀后 Top 4 结果全部与公司无关，去掉后 Top 4 全部命中官网/百科等公司相关页；换引号包裹、"截至"措辞等变体依然被污染，说明问题是裸日期 token 本身，不是格式问题。修法：两个查询构造函数不再对**面向搜索引擎**的查询套用 `anchorQueryToDate`（该护栏保留给需要绝对日期语境的场景，如 LLM 提示词，函数本身逻辑不变，只移除这两处误用）。**沙箱网络限制记录**：Tavily API 当次实测命中账号用量上限（432，需升级套餐或等下月重置，非代码 bug）；DuckDuckGo/Yahoo News 在本沙箱网络环境下连接超时（`fetch failed`），无法在此验证，与文档既有记录的"沙箱会墙搜索引擎"一致——这两条回退路径仍需用户在本机网络环境验证。测试 `phase-b7.mjs` +5，同步修正 `smoke.mjs` 里编码了旧（错误）行为的过时断言，`npm test` 全绿（240 用例），lint 0 error。浏览器实测：小鹏汽车（问"小鹏汽车最近怎么样"，命中相对时间词触发路径）研究报告正常生成、来源正常引用（Finnhub 新闻源，无污染内容），无回归。 |
| C1–C2 | 移动端响应式 + PWA | ⬜ | 并行；后端不动 |
| D2 | 轻量 DB 迁移器（`user_version` + `migrations/NNN_*.sql`） | ✅ 2026-07-04 | **范围收窄**：用户明确数据库未上生产、无历史数据负担，允许直接清库重来，不需要"现有旧库无损迁移"路径，以最小成本换干净架构。新增 `src/db/migrate.js`（`PRAGMA user_version` 追踪 + 事务化应用 `migrations/NNN_*.sql`）+ `src/db/migrations/001_init.sql`（14 张表当前最终形态一次性建库，含此前散落在 `documentRepository`/`companyProfiles`/`researchSessions` 里靠运行时 `ALTER TABLE ADD COLUMN` 补的列，现在直接是建表语句的一部分）。11 个文件（9 个 repository + `scheduler.js`）的 `ensureTable()`/`ensureColumns()` 自迁移函数全部删除，改为直接 `getDb()`；`company_profiles` 的一次性 `backfillLegacyEvents`（老库 events_json → profile_events）作为死代码一并删除。`luvio.db` 已清空重建，`npm run seed` 重新灌入 654 支港股基础数据。测试 `phase-d2.mjs` +24（新库迁移到最新版本、14 张表全部就位、幂等重跑、此前靠 ALTER TABLE 补的列已在 001_init.sql 里就位），同步删掉 `phase4.mjs` 里测试已移除 legacy 迁移行为的过时用例。`npm test` 全绿（263 用例），lint 0 error。浏览器实测：全新迁移后的库上跑腾讯研究，公司检索/研究会话落库/看盘/画像全部走通，无回归。 |
| D3 | `chat.js` 编排逻辑内化进工具层 | ✅ 2026-07-04 | 新增 `src/server/services/chatOrchestrator.js`，把 `chat.js` 里 ~630 行编排逻辑（`runChat`/`finalizeChat`/`buildFinalThread`/`buildCompareSummary`/`judgeComparison`/`watchCandidatesFrom` 等 17 个函数）整体搬入，逐段 diff 核对搬迁前后代码逐字节一致（仅两处注释措辞差异，无逻辑改动）。`chat.js` 收窄成 9 行 HTTP 薄封装（`handleChatApi` 解析请求体后转发给 `runChat`）。`agentTools.js` 的 `compareCompanies` 改为从 `chatOrchestrator.js` 导入 `buildCompareSummary`，不再反向依赖路由层；`ask.js` 的 `runChat` 导入同步切换。`tests/phase-b3.mjs`/`phase-ea4.mjs` 的导入路径同步更新。`npm test` 全绿（263 用例，无需新增测试——纯代码搬迁，既有单测已覆盖 `judgeComparison`/`watchCandidatesFrom`），lint 0 error。浏览器实测：起本地服务器实测 `/api/chat`（腾讯估值问答），响应 200、决策面板/估值/来源/模型作答全部正常产出，无回归。 |
| D1 | `src/server/**`/`src/ui/**` 渐进 JSDoc + `checkJs`（第一批：六类跨模块数据结构） | 🟡 2026-07-04 | **范围收窄**（用户明确定的）：D1 目的不是"给全项目写注释"，而是用类型约束稳住真正跨模块传递的对象；第一批只覆盖 dataSources/valuation/research session/watchlist/portfolio/chat orchestration 六类，其余 ~70 余个文件留给后续增量批次，避免一次性大量 annotation 造成噪音。基建：新增 `jsconfig.json`（`allowJs`+`checkJs`，non-strict，`maxNodeModuleJsDepth:0` 滤掉 node_modules 噪音）+ `typescript`/`@types/node` 作为 devDependency + `npm run typecheck`（不接入 `npm test`/CI，纯本地提示）。新增 `src/server/types.js` 集中声明 `DataSources`/`Valuation`/`ResearchSession`/`WatchlistEntry`/`PortfolioPosition`/`ChatContext`/`ChatFinalResponse` 等 `@typedef`，逐个对照 `collectDataSources()`/`displayValuation()`/`saveResearchSession()`/`watchlist.js`/`portfolio.js`/`chatOrchestrator.js` 的真实返回形状核对字段（比如 `Valuation.currentPrice` 早退分支可能缺失、`bear/base/bull` 情景估值分支会是字符串）。六个目标文件的导出函数标注 `@param`/`@returns` 引用这些类型，`npm run typecheck` 跑出的报错反过来倒逼类型声明贴合实际（不是拍脑袋编类型）。**副产品**：`checkJs` 打开后在 `scheduler.js`（`isDue` 的 `@param` 少花括号）和 `watchDesk.js`（`buildWatchDesk` 的 `@returns` 同样漏花括号）发现两处真实 JSDoc 语法错误——不影响运行时，但会让 TS 解析中断、连累后面的类型检查报出无关错误，顺手改成合法语法。`npm run typecheck` 目标文件范围内 0 error（仅 `valuationEngine.js`/`watchDesk.js` 各留 1-3 处未标注的内部函数算术类型告警，属于函数体内部循环利用的已知松散类型，待后续批次一并处理）。`npm test` 全绿（263 用例，纯注释新增无运行时变化），lint 0 error。浏览器实测：`/api/chat`（腾讯估值问答）、`/api/watch/desk`、scheduler 启动均正常，无回归。**后续批次**：`src/ui/**`（13 文件 0 JSDoc）+ `src/server/` 其余 ~45 个文件按"高频改动优先"顺序逐批覆盖，不在本次一次性做完。 |
| P8 | 商业化底座 | ⬜ | 需用户逐项对齐 |

**建议顺序**：EA-0 → EA-1 → EA-2 → EA-3 → EA-4 → EA-5；C（移动端）可任意点插入；EA-6/P8 待需求。

---

## 6. 明确不做（防后人走弯路）

1. **不换前端框架**（React/Solid 重写）：vanilla ESM + 事件委托 + 服务端无构建，对单人 + AI 协作维护成本最低。EA-5 用渐进重构，不上全家桶。
2. **不做完全自主 ReAct 循环**：规划步数 ≤3，规则优先。投研要可靠可控，不要炫技多跳。
3. **不做 A 股**：数据源、合规、竞争格局不同，聚焦 HK + US。
4. **不给买卖指令**：合规红线，宪法已约束；Agent 再强也只给研究判断 / 监控条件 / 风险检查点。
5. **不编数字**：事实块红线对 Agent 同样生效；工具取不到就写"未核到"，禁止给估计范围或反推。
6. **不在没有授权前把腾讯港股行情当商用数据源宣传**（商业化阻断项）。
7. **不做过早抽象**：EA-6 用户自定义 skill 必须等有真实用户在用内置框架之后。

---

## 7. 怎么跑 + "完成"的定义（速查）

```bash
npm install                 # 只有 better-sqlite3 一个原生依赖
npm run seed                # 建/重置本地 SQLite 种子库
npm run dev                 # http://127.0.0.1:4173
npm test                    # 149 用例，必须全绿（EXIT=0）再提交
npm run lint                # eslint（correctness 级）
# 后端无热重载！改 src/server/** 或 src/*.js 后要重启 node（Ctrl+C 再 npm run dev）
# 隔离测试：LUVIO_DB_PATH=$TMPDIR/x.db PORT=4199 node server.js
```

**一次改动的"完成"= 代码 + 对应测试（进 `tests/`，接入 `npm test`）+ §5 状态表标 ✅ + 一条中文 commit（说清做了什么、为什么）。** 浏览器可见的改动必须实跑验证，不许只靠"应该没问题"。

**key 都在 `.env`（gitignored）**：DEEPSEEK / FMP / FINNHUB / TWELVEDATA / TAVILY 已配。沙箱会墙搜索引擎，端到端 web 证据效果要在用户本机验证。
