# Luvio 下一阶段项目计划（2026-06-28 定稿）

> **用途**：本文件是给**新会话的执行说明书**（cold-start handoff）。新会话不带本次排查的上下文，所以这里把根因、证据、修法、涉及文件、验收都写全。
> **两条工作线**：
> - **工作线 A — 交互与稳定性**：用户实测抓到的 5 个问题（含一个会掀翻整个后台的崩溃）。
> - **工作线 B — 研究质量升级**：AAOI 实测对比 Hone，把 Luvio 从"会写投资报告"升级成"会做投资研究"。
> **关联**：`docs/RESEARCH_QUALITY_GAP_LOG.md`（BABA 复盘，根因 D = 估值引擎自循环，本次在美股亏损股上复发）、记忆 `luvio-product-roadmap` / `honeclaw-competitive-analysis` / `luvio-review-style`。

---

## 0. 给新会话的开工须知（先读这条）

- 分支 `cleanup/pristine-refactor`。**动手前先 `git log` 看有无新提交**——记忆/文档可能落后于实际代码。
- **后端无热重载**：改 `src/server/**`、`src/*.js`（newsData/marketData/financialData 等）后必须重启 node 进程才生效。用户跑桌面启动器（端口 4173，"已运行只开浏览器"不会重启），改完要手动重启。本地测试用 `LUVIO_DB_PATH=$TMPDIR/x.db PORT=4199 node server.js`，杀进程用 `pkill -f "node server.js"` 或 `lsof -ti tcp:PORT`（`PORT=` 在 env 不在 argv，`pkill -f "PORT=4199"` 杀不掉）。
- **验证需要 key**（`.env` 已配）：DEEPSEEK（模型）、FMP、FINNHUB、TWELVEDATA、TAVILY 都已 SET；OPENAI / SERPAPI 为空。沙箱会墙搜索引擎，端到端真效果要在用户的非沙箱环境跑。
- 按 **A-P0 → B-P0 → A-P1 → B-P1/B-P3 → A-P2 / B-P2** 的合并顺序推进（见 §3），**分阶段提交 + 每阶段实跑验证**（用户偏好"破而后立、先修地基、实跑找错打分"）。
- 测试基线：`node tests/smoke.mjs` + 其余（上一轮 34+17 全绿），改完不许回退。

---

# 工作线 A — 交互与稳定性（用户实测 5 项）

## A-P0.1　后台崩溃 → "Load failed"（最高优先，一条坏请求掀翻整个服务）

**根因（已复现）**：用假代码 `DRUM` 打 `/api/chat`，node 进程**直接退出**，日志停在
`src/newsData.js:382  throw new Error("East Money 没有返回相关新闻")` → `Node.js v24.16.0`（崩溃退出）。
机制有两处叠加：
1. [`src/newsData.js` `fetchBroadNews`](../src/newsData.js)：可靠源（Finnhub/Tavily）够 4 条就**提前返回**（约 line 471），但慢爬虫源（雅虎/必应/东方财富）此刻**还在后台跑、没有任何 `.catch`**；它们稍后 reject 就成了 **unhandled rejection**。
2. [`src/newsData.js` `withJobTimeout`](../src/newsData.js)（约 line 433）里那句 `Promise.resolve(promise).catch((err) => { throw err; })`：超时先赢得 `Promise.race` 后，真正的 promise 之后再 reject，会产生一条**无人接管的拒绝**。
3. [`server.js`](../server.js) **没有任何 `unhandledRejection` / `uncaughtException` 兜底**。Node 24 默认遇 unhandled rejection **杀进程**。
> 注意：这**不只在打错代码时发生**——任何"可靠源够了提前返回、慢源稍后失败"的正常查询都可能触发，这就是平时"后台时不时崩"的真因。

**修法**：
- `withJobTimeout` 改成**永不 throw**：失败/超时都 resolve 成 `onTimeout` 兜底值。
  ```js
  function withJobTimeout(promise, ms, onTimeout = []) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(onTimeout), ms);
      Promise.resolve(promise).then(
        (v) => { clearTimeout(timer); resolve(v); },
        () => { clearTimeout(timer); resolve(onTimeout); }   // 超时/失败统一回兜底，绝不向上抛
      );
    });
  }
  ```
- `fetchBroadNews` 提前返回前，给 orphaned `scraperJobs` 兜一层（带刺保险）：`scraperJobs.forEach((p) => Promise.resolve(p).catch(() => {}));`
- `server.js` 加全局兜底（放在 `server.listen` 之前）：
  ```js
  process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
  process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));
  ```
  （单用户本地研究工具：保活 >> 崩溃。日志留痕即可。）

**验收**：复现 `DRUM` chat → 服务**存活**（`/api/status` 仍 200）；正常公司查询不受影响；smoke+全套测试绿。

---

## A-P0.2　新对话即时进侧栏 + 根除重复（同一根因，修问题 1 和问题 3）

**根因**：新研究全程带 `sessionId=null`（[`app.js` sendChat 切换块](../src/app.js) `setSessionId(null)`），run 用临时键 `new:<ticker>`，要等研究**跑完**才 `refreshSessions()` 显示到侧栏。后果：
- **问题 1**：生成期间侧栏没有 B；点"回到 A"后 B 成了看不见的后台 run；若中途服务崩了（见 A-P0.1）B 根本没落库 → 永远不出现。
- **问题 3（重复 DRAM）**：因为看不见，用户会再问一次 / 走"回到"；每次 `null` 都在 DB `INSERT` **新 session**（[`researchSessions.js:77`](../src/server/repositories/researchSessions.js) `id = payload.sessionId || s_<uuid>`）→ DRAM 两条。[`app.js` `returnToCompany`](../src/app.js)（约 line 1071）在侧栏找不到该 session 时落 else 分支、把当前公司挂成"空线程 + null session"，下一句追问再造一条重复。

**修法（前端 `src/app.js` 为主）**：研究**开始前**就生成稳定 `sessionId`（`s_${crypto.randomUUID?.() || uid()}`），并：
- 乐观插入一条本地 session 到侧栏列表（带转圈），不等服务端；
- chat 请求体带上这个 `sessionId` → 后端 `ON CONFLICT(id) DO UPDATE`（[`researchSessions.js:84`](../src/server/repositories/researchSessions.js)）**upsert 同一行**，不再 INSERT 新行；
- run **全程用真实 id 当键**（取代 `new:<ticker>`）→ `loadSession` 能从 `run.snapshot` 恢复、导航/切回都对得上；
- `refreshSessions` 把服务端列表与本地乐观条目**按 id 合并去重**（服务端版覆盖乐观版）；
- 修 `returnToCompany`：找不到 session 时不再遗留 null（要么用已生成的稳定 id，要么明确新建）。
- 涉及函数：`runKey/startRun/endRun`、`sendChat`、`runComparison`、`switchAndResearch`、`generateDeepResearch`、`loadSession`、`returnToCompany`、`refreshSessions`、`renderSessionItem`。

**风险**：这是上一轮那套精巧的并行对话逻辑（P2，提交 `4fc944e`），最需小心。**改完必须在浏览器逐条验证并行场景不回退**：A 跑着切 B、A 侧栏转圈、B 并行再发、A 后台完成不 clobber B、切回 A 见后台答案。

**验收**：发起新研究→**侧栏立刻出现**（转圈）；切走再切回正常；**对同一公司再问一次不产生第二条**；`returnToCompany` 不再遗留 null；并行场景全绿。

---

## A-P0.3　打错代码的"成熟纠错"（verify 闸门 + did-you-mean）

**根因**：[`app.js:153` `resolveUsTicker`](../src/app.js) 把**任意 1–5 位纯大写**当美股代码，[`app.js:600`](../src/app.js) 直接返回、**不校验**。已验证校验可行：FMP `search-symbol` 里 `DRAM`→CBOE 上市（真票），`DRUM`→只有伦敦 `DRUM.L`（非美股主板）；后端 [`verifyUsTicker`](../src/server/routes/companies.js)（line 97）正好能区分，只是这条路绕过了它。

**修法（成熟方案）**：
1. **verify 闸门**：纯大写/自由文本代码在研究前先过 `verifyUsTicker`（FMP search-symbol 含 ETF + Finnhub profile2 兜底）。`verified`→放行（用返回的真实公司名）；`not_found`→**不研究**，进 did-you-mean；`error`（限流/网络）→**放行**（信任用户，避免误杀刚 IPO 的新股，与现有"新上市自愈"一致）。
2. **did-you-mean**：新增 `GET /api/companies/suggest?q=`（或让 verify 在 `not_found` 时一并返回 `suggestions`）：FMP `search-name` + Finnhub `search`，**美股主板过滤 + 去重 + 排序**，返回 top 候选 `[{ticker,name}]`。
3. **前端**：`resolveCompany` 对 bare/typed US 猜测调 verify；拦下时**复用 choice-card** 弹"没找到 `DRUM`，你是不是想找：…"（候选按钮）+ 一个**退路**按钮"仍按 DRUM 研究"（兜冷门/新票）+ 提示"也可输入更完整的公司名或港股 xxxx.HK / 美股代码"。
4. **不加延迟给常见票**：别名表（AAPL/NVDA…）、双重上市、港股代码都**先短路**，只有未收录的裸代码才走 verify（约 0.5–1s，已有"正在识别公司"微状态覆盖）。

**验收**：`DRUM`→弹纠错卡不研究、不崩；`DRAM`/`AAPL`/`RKLB`→正常研究；FMP 限流时不误杀。

---

## A-P1.1　对比做成可视化并排表（现在是散文）

**根因**：后端 [`buildCompareSummary`](../src/server/routes/chat.js)（line 20）已经把对比对象的结构化数据（行情/区间回报/财报/估值/评级）拉回来了，但只喂给模型写散文，**前端无并排表组件**。

**修法**：
- 后端 `chat.js` 在 `finalizeChat` 返回里加结构化 `comparison = { left, right }`，每家含：`name, ticker, price, changePct, pe, qualityScore, odds, oneMonthPct, ytdPct, target, upsidePct`。
  - 主公司质量分：`computeFinancialQuality(result.financialsData)`（[`financialQuality.js:25`](../src/server/services/financialQuality.js)，返回 `quality.qualityScore`）。
  - 对比对象质量分：`computeFinancialQuality(compareData.financialsData)`；赔率从两家各自的 `valuation`（bull/bear vs price）算；区间回报取 `marketSnapshot.ranges`。
- 前端 `src/app.js` 新增 `renderComparisonTable(comparison)`，在 `renderMessage` 里当 `meta.comparison` 存在时渲染**两列对照表**（现价 / PE / 赔率 / 利润质量 / 区间回报 / 目标价），**散文保留在表下**。`styles.css` 配套（参考现有 `.valuation-*` / `.analyst-*` 风格，浅深色都要）。
- meta 要在**实时**（`answerMetaFromResult`）和**持久化**（`persistFinalChatSession` 的 `assistantMeta`）两处都带 `comparison`，恢复历史一致。

**验收**：点"在本对话里对比"→ 出现两列表，一眼看清两家现价/PE/赔率/利润质量/区间回报；恢复历史仍在。

## A-P1.2　对比对象接新闻/网页证据（现在只拉行情/财报/估值/评级）

**根因**：`buildCompareSummary` 为避超时**故意没拉 news/filings**（line 17 注释写明）。A-P0.1 修完后新闻管线不会再崩，可安全补。

**修法**：`buildCompareSummary` 加一条带超时护栏的 `getNewsSnapshot(对比对象)`（如 5–6s，`withTimeout` 兜底 missing）；`buildCompareBlock`（[`answerComposer.js:640`](../src/server/services/answerComposer.js)）渲染对比对象的近期新闻；并排表/散文都能引用对方头条 2–3 条。注意整体超时预算（当前 compare 整块 12s，见 chat.js line 63）别被撑爆，必要时把对比对象的拉取也并发化。

**验收**：对比回答里两家都有近期新闻引用；不超时、不崩。

---

## A-P2.1　多法估值"为什么是这个区间"的依据展开

**根因**：[`valuationEngine.js` `computeValuation`](../src/server/services/valuationEngine.js)（line 148）内部已算出每种方法（PE / Forward PE / FCF / DCF）各自的 bear/base/bull，但对外只暴露 `methods: [方法名]`（line 279），**每种方法各自推出多少钱被丢掉**。

**修法**：`computeValuation` 返回里加 `methodDetail: [{ name, bear, base, bull }]`；`displayValuation` 的各 fallback（PE 区间 / 分析师目标价区间）也给单条 detail。前端 `renderValuation`（[`app.js:1688`](../src/app.js)）的"估值依据"展开成"PE法→$X / FCF法→$Y / DCF→$Z + 各自关键假设"，让"区间怎么来的"可追溯。

**验收**："估值依据"展开里能看到每种方法的隐含价 + 假设，不再是孤零零一个区间。
> 注：本项与工作线 B-P0（stage-aware 估值）相关——B-P0 落地后，亏损股的 detail 会变成 EV/Sales 情景而非 PE，本项的展开 UI 要兼容两种来源。

---

# 工作线 B — 研究质量升级（AAOI 实测对比 Hone）

> **背景证据**：同一问题（AAOI 基本面）下，**第一份（Hone，胜）** 抓住胜负手（Q2/Q3 800G 放量、毛利率、现金流）、用一手事实（Q1 实绩 + Q2 指引 + 订单公告）；**第二份（Luvio，弱）** 结构完整但：① 对亏损股用 Forward PE 带（自循环赔率 1.3:1）② 拿 Finnhub 新闻标题当主证据 ③ 收入硬错（"约2-3亿、未核到"，实际 TTM ~$5.07 亿、2025 ~$4.557 亿）④ 缺一手事实与情景估值。
> **AAOI 地面真值（引擎应当产出的口径，供验收对照）**：Q1 2026 收入 $151.1M（+51% YoY，数据中心 $81.4M +154%）；GAAP 毛利率 29.1%；GAAP 净亏 $14.3M；Non-GAAP EPS -$0.07。Q2 指引收入 $180–198M、Non-GAAP 毛利率 29–30%、Non-GAAP EPS -0.03~0.03。4 月公告单一 hyperscaler 新增 $71M 800G 订单（自 3 月中累计 $124M）。6/26 收盘 $135.69，市值 ~$10.9B，TTM 收入 ~$5.07 亿，TTM EPS -$0.66（PE 不适用）。
> **独立判断**：第二份的弱**主要是引擎/管线，不是脑子**——提示词早已要求高成长用 EV/Sales（[`prompts.js:37`](../src/prompts.js)）+ 事实/推断/判断分层，但**估值条与赔率是确定性引擎算的**（见下 B-P0），模型只是复述。**研究质量第一杠杆 = 估值引擎 stage-aware。**
> **规格来源**：用户提供的《投资研究质量改进指令》（资产分类 / 一手源优先级 / 适配阶段的估值 / 事实-推断-判断分层 / 指引锚定证伪 / 15 段输出结构 / 科技股 10 项额外检查 / 质量自检 10 条）即本工作线的需求 spec，落地时对照执行。

## B-P0　估值引擎 stage-aware（EV/Sales 情景）—— 研究质量最大杠杆

**根因**：[`valuationEngine.js`](../src/server/services/valuationEngine.js) 不分公司阶段。对亏损股（EPS<0、PE 不适用），`computeValuation` 的 PE/ForwardPE/FCF 法都进不去，`displayValuation` 一路掉到**以现价为中心的 ±25% PE 带**（base=现价）→ 这就是"中性=现价、赔率1.3:1"的自循环（= `gap log` 根因 D 在美股的复发）。

**修法**：
- 新增**资产阶段分类**（用户 spec §三的 8 类，先实现关键分支）：用 `financialsData`（netMargin/operatingMargin/eps<0 + revenueGrowth 高）判为"亏损高成长"。
- 对该类走 **EV/Sales（或 EV/Gross Profit）情景估值**：Bear/Base/Bull 各设 {目标 EV/Sales 倍数, 收入(或 2026E/2027E 收入), 毛利率} → 隐含 EV → 加净现金（`cashAndEquivalents - totalDebt`）→ ÷ 稀释后股本 → 价格区间；**赔率由 bull/bear vs 现价推出（非自循环）**；并给"当前价隐含了什么预期"（反推市场 implied EV/Sales 或 implied 收入）。
- 倍数/情景假设：先用**按行业的规则默认值**（可后续让模型在护栏内给），每条情景**显式列假设**（对接 A-P2.1 的 detail UI 和 B-P3 的情景表）。
- **数据前置检查**：确认 `getFinancials`（[`src/financialData.js`](../src/financialData.js)）返回 **TTM 收入 + 收入历史 + sharesOutstanding + 现金/负债 + 毛利率**；缺哪个补哪个（这是 B-P0 的硬依赖，也修 B-P1 的收入硬错）。

**验收**：AAOI 估值条不再是"中性=现价"，而是 EV/Sales 情景（如 base 用某倍数×收入推出的价位），赔率非自循环；成熟盈利股（AAPL）仍走 PE/FCF 多法，不被带偏。

## B-P1　一手事实硬化 + 防幻觉（修收入硬错）

**根因**：TTM 收入这种基础项没进事实块 / 模型拿不到就自己编（"约2-3亿"）；"还缺什么"也不准。

**修法**：
- `answerComposer` 的 `financialsToMarkdown`（事实块）**必含 TTM 收入 + 收入历史 + 毛利率/经营利润率/净利率/EPS/FCF**，作为"唯一事实源"。
- **防幻觉硬约束**：在 `RESEARCH_DISCIPLINE` / `PROMPTS.chat` 里加"**事实块中没有的财务数字一律只能写'未核到'，禁止给估计范围**"；可选加一个轻量 post-check，对答案里的 `$`/亿/百万 数字与事实块比对，命中未提供数字则降置信度或打标。
- `missingData` 要**准**：有 TTM 收入就别列"收入未核到"。

**验收**：AAOI 答案出现真实 TTM 收入 ~$5.07 亿，不再出现"约2-3亿、未核到"自相矛盾；缺失项准确。

## B-P3　提示词与输出结构升级（研究灵魂 + 适配阶段）

**根因**：现结构是模板，但没强制"胜负手 / 市场在押注什么 / 何时证实证伪"，证伪条件偏泛，亏损股仍套 PE 模板段落。

**修法**（对照用户 spec §一/§三/§六/§八/§九/§十）：
- `PROMPTS.chat` / `PROMPTS.cio` 强制：① 先做**资产阶段分类** ② 回答**五个问题**（市场在押注什么 / 核心基本面变量 / 何以验证 / 何以证伪 / 现价是否透支） ③ 一句话**胜负手** ④ **指引锚定的证伪条件**（"Q2 收入低于指引中位数 $189M""毛利率跌破 29%"这种具体阈值，不是"竞争加剧") ⑤ 段落模板**按资产类型自适应**（亏损高成长 → EV/Sales 情景段，不是 PE 段）。
- 输出结构按 spec §九 补：**三情景估值表、当前价隐含预期、现金流与稀释、客户集中度**（深度研究全量；对话内追问按需精简）。

**验收**：AAOI 回答有明确"胜负手"一句、五问可见、证伪条件锚到公司指引数字、亏损股不再大谈"Forward PE 透支"。

## B-P2　一手源优先 + 来源分级（把新闻降级为情绪参考）

**根因**：有 SEC EDGAR（[`secFilings.js`](../src/secFilings.js)）但没把 8-K / 业绩新闻稿 / 指引抽进事实块，模型只能抓 Finnhub 标题当主证据。

**修法**：
- 美股一手源抽取：8-K / 业绩新闻稿 / 业绩电话会要点 / 订单公告，进事实块（[`filingData.js`](../src/filingData.js) / `secFilings.js`）。
- 建**来源分级**（财报/10-Q > 指引/电话会 > 权威数据 > 卖方研报 > 新闻 > 社媒），在 prompt + 接地条 + 证据卡排序里强制；新闻标题在答案里显式标为"情绪参考"。
- Tavily/web 证据优先指向 IR/SEC 页面，而非泛新闻。

**验收**：AAOI 答案主证据是 Q1 实绩 + Q2 指引 + 订单公告（一手），新闻仅作情绪点缀且被标注。

---

## 3. 合并优先级（两线如何穿插，推荐顺序）

| 次序 | 项 | 为什么排这 |
|---|---|---|
| 1 | **A-P0.1 后台崩溃** | 一条坏请求掀翻全服务、连带并行对话全死；改动小、收益最大；也是 B-P1.2 / 新闻类改动的前提 |
| 2 | **A-P0.2 侧栏/重复** + **A-P0.3 verify 纠错** | 用户最直接的体感痛点（问题 1/2/3） |
| 3 | **B-P0 stage-aware 估值** | 研究质量第一杠杆；修自循环赔率；A-P1.1 对比表要显示"真赔率"也依赖它 |
| 4 | **A-P1.1 对比表** + **A-P1.2 对比接新闻** | 体感最强的研究质量项；受益于 B-P0（真赔率）与 A-P0.1（新闻不崩） |
| 5 | **B-P1 防幻觉** + **B-P3 提示词/结构** | 研究灵魂；成本低、杠杆高 |
| 6 | **A-P2.1 估值依据展开** + **B-P2 一手源分级** | 深度打磨；A-P2.1 需兼容 B-P0 的情景来源 |

> 每完成一个次序就**单独 commit + 实跑验证**（含浏览器场景），再进下一个。push 由用户在本地终端做（沙箱无 git 凭据）。

## 4. 验收总清单（逐项可勾）

- [ ] 假代码 `DRUM` 不崩、弹纠错卡；`DRAM`/`AAPL` 正常研究
- [ ] 新研究**立即进侧栏**（转圈）；同一公司再问不产生重复行；切走切回/并行不回退
- [ ] 对比 → 两列并排表（现价/PE/赔率/利润质量/区间回报/目标价）+ 两家近期新闻
- [ ] AAOI 估值 = EV/Sales 情景（非"中性=现价"）；赔率非自循环；AAPL 仍多法
- [ ] AAOI 出现真实 TTM 收入；无"约2-3亿、未核到"自相矛盾
- [ ] AAOI 回答有"胜负手"一句、五问可见、证伪锚到指引数字
- [ ] 一手源（Q1 实绩/Q2 指引/订单）为主证据，新闻标为情绪参考
- [ ] 估值依据展开含每种方法隐含价 + 假设
- [ ] smoke + 全套测试绿；浅/深色都验过、无 console 错误

---

_本计划由 2026-06-28 的排查会话定稿，供新会话执行。实现细节以届时的实际代码为准（动手前先 `git log` + 读相关文件核对）。_
