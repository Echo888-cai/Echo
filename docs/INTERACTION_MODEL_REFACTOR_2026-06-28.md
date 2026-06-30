# Luvio 终极重构计划：从「单公司研究」到「什么都能接住」的对话 Agent（2026-06-28 定稿）

> **用途**：给新会话的执行说明书（cold-start handoff）。本文件回答一个战略问题——
> **"为什么 HoneClaw 什么问题都能接住，而 Luvio 注定不灵活？"** 把根因、对照、目标架构、分阶段修法、涉及文件、验收写全。
> **触发场景**：用户拿"现在我持有 22 股思科和 7 股 spacex 成本分别是 118.3 和 151 能挣钱吗"同时问两边。
> HoneClaw 干净利落地给出**两笔各自盈亏 + 组合合计 + 分标的判断 + 证伪条件**；Luvio 只认住会话头部那一家（CSCO），
> 把 SpaceX 当自由文本丢给模型 → 凭旧知识答"SpaceX 没上市"（实际 2026-06-12 已 IPO，代码 SPCX，约 $153）。
> **关联**：`docs/PROJECT_PLAN_2026-06-28.md`、`docs/RESEARCH_QUALITY_GAP_LOG.md`、记忆 `honeclaw-competitive-analysis` / `luvio-product-roadmap` / `luvio-review-style`。

---

## 0. 一句话诊断

**Luvio 的最小单元是「一家公司」；HoneClaw 的最小单元是「一段对话」。**

Luvio 是「公司研究器」：先选一家公司，再围着它问。HoneClaw 是「投研对话 Agent」：先有对话，每一轮从问句里**临时**判断这轮涉及哪些标的 / 是不是组合 / 是不是宏观，再去取对应的数据。

→ 凡是装不进"这一家公司"的提问（组合、多标的、宏观、"我持有 A 和 B"、"该减谁"），Luvio 的容器**物理上装不下**。这不是提示词或推理能力的问题，调提示词救不了。

---

## 1. 根因：单公司绑定刻在三层（每层都得改）

### 层一 · 前端状态：全局只有一个 `company`
- [`src/app.js:6`](../src/app.js) `company: "luvio.v3.company"` —— localStorage 里**唯一**的当前公司。
- [`getCompany()` / `setCompany()`（app.js:256/260）](../src/app.js)、[`activeRunKey()`（app.js:183）](../src/app.js) `= sessionId + company.ticker`：连"运行中的任务"都是按单公司做键。
- 整个 app 的心智模型 = "同一时刻有且仅有一家在研公司"。

### 层二 · 前端发送：`sendChat` 每轮只收敛到「一家」
- [`src/app.js:1194` `sendChat`](../src/app.js)：每轮把问句解析成**恰好一个** `company`；切换公司 [（app.js:1258 `switched`）](../src/app.js) 直接开一条全新 session。
- 唯一的"多标的"出口是**对比特例** [（app.js:1200-1210）](../src/app.js)：必须同时满足"是对比句 + 强信号点名了另一家"，且只支持 **当前 + 1 家** 两列。"我持有 A 和 B"既不是对比句、也不是切换，于是 B 被当普通追问文本，**对 B 不解析、不取数**。

### 层三 · 后端：`handleChatApi` 一切 keyed off `payload.company`
- [`src/server/routes/chat.js:108`](../src/server/routes/chat.js) `companyForEvidence = companyByTicker(payload.company?.ticker)`；
  [`chat.js:115-123`](../src/server/routes/chat.js) 的 `runAgent` / `researchWebEvidence` / 估值，全部只对这**一家**跑。
- 记账也是单公司 [（chat.js:209-223，`upsertPosition` 只写 `portraitTicker`）](../src/server/routes/chat.js)：所以"成本分别是 118.3 和 151"只记了 CSCO 的 118.3，**SpaceX 的 151 那笔被静默丢弃**。

> **反讽**：解析能力其实够。[`companies.js:147` `BRAND_ALIASES`](../src/server/routes/companies.js) 早已有 `spacex → SPCX`，
> [`verifyUsTicker`（companies.js:97）](../src/server/routes/companies.js) 还有 Finnhub"新上市自愈"。
> 这套只在**【新建研究】入口**跑；对话内提到的第二只股根本到不了它面前。**地基对，但只通了一条腿。**

---

## 2. 对照 HoneClaw：为什么"什么都能接住"

公开仓库（`B-M-Capital-Research/honeclaw`，Rust）的关键模块印证了架构差异：

| 能力 | HoneClaw | Luvio 现状 |
|---|---|---|
| 会话单元 | `crates/hone-channels/src/agent_session/core.rs` + **`turn_builder.rs`**：每轮从问句**重建上下文** | 会话绑定一家公司，全局 `company` 状态 |
| 提问范围 | README 自述：**单股 / 组合监控（多持仓）/ 宏观 / 跨标的对比** 同一对话统一处理 | 单股；对比是 2 列特例；组合/宏观无 |
| 实体来源 | 每轮从问句抽取，无"current company"全局 | 入口解析一次，之后锁死 |
| 路由 | `router/{classify,dispatch,policy}.rs` 把输入分派到不同处理 | `classifyResearchIntent` 只分**同一家公司内**的问题类型 |

**HoneClaw 的本质**：`turn_builder` = 每轮"按问题组装上下文"的 Agent 循环。它没有"当前公司"，所以没有"装不下"的问题。

**Luvio 真正更强、必须保住的**（别为了灵活把这些丢了）：结构化 `decisionPanel` + JSON schema 校验 + 可视化**估值条 / 证据卡 / 置信度** + **港美双市场**。HoneClaw 是纯文本流，产品化前端不如我们。**目标是"既要 Hone 的灵活，又留住我们的结构化"。**

---

## 3. 目标架构：在现有管线上加一层「轮路由」（分层，不推倒）

```
用户消息（任意问题）
      │
      ▼
┌─────────────────────────────────────────────┐
│ Turn Router  ── 每一轮都跑（取代"单公司解析或继承"）   │
│  1) 判轮型 kind: single | portfolio | compare │
│                  | macro | followup | position │
│  2) 抽全部实体 entities[0..N]（复用 alias/verify/自愈）│
│  3) 定 scope：哪些标的 / 是否组合 / 是否宏观        │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ Context Assembler ── 按 scope 取数（1 / N / 组合 / 宏观）│
│  · per-ticker：现有 runAgent 管线（降级为"模式之一"）  │
│  · portfolio：portfolio 仓 + enrichPosition + 逐仓轻摘要│
│  · macro：只跑 web 证据（时间锚点改写），不强出公司面板  │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ Answer Composer ── 模式感知提示词                 │
│  输出：散文 + 对的结构化件                          │
│  （1 张面板 / N 张卡 / 组合表 / 宏观简报）           │
└─────────────────────────────────────────────┘
```

**核心原则**：现有"一家公司的 runAgent + decisionPanel + 估值条"**不删**，把它从"唯一主路径"降级成 Router 的一个分支。新增的只有最上面那层 Router 和 Context Assembler 的多标的/组合/宏观分支。

---

## 4. 分阶段交付（每阶段独立可发、独立验收）

### P0 — 对话内多标的（拆掉地基 + 直接修掉 SpaceX 尴尬）★ keystone

**做法**
1. 新增**多实体抽取** `extractEntities(question, sessionFocus)`：复用现有 LLM 解析器（`companies.js` 的 `RESOLVER_SYSTEM`）+ `BRAND_ALIASES` + `verifyUsTicker`，一次返回 `0..N` 个已校验 ticker（不再只返回一个）。
2. 后端 `handleChatApi` 接受 `entities: [...]`（N 个）而非单 `company`；把 [`buildCompareSummary`（chat.js:22）](../src/server/routes/chat.js) 从"2 列"泛化成"N 个轻摘要"，并发拉（沿用现有 `withTimeout` 预算）。
3. **多笔记账**：自然语言"分别…和…"支持 ≥2 笔，各记各的 ticker（修 chat.js:209-223 单笔丢弃）。
4. 前端 `sendChat` 的"对比特例"并入通用多实体路径；本轮聚焦从"一家"变"一组"。

**涉及文件**：`src/app.js`(sendChat/状态)、`src/server/routes/chat.js`、`src/server/routes/companies.js`、`src/server/services/userContext.js`(多笔解析)、`src/server/repositories/portfolio.js`。

**验收**：在 CSCO 对话里发"我持有 22 股思科和 7 股 spacex 成本分别是 118.3 和 151 能挣钱吗" → 两只都拿到真实行情、各自盈亏 + 合计、两笔都入账；smoke + 全套测试绿。**对标 Hone 那条回答。**

---

### P1 — 组合模式（持仓变成一等公民 scope）

**做法**
- `kind = portfolio` 时从 `listPositions()` 拉全部持仓，逐仓 `enrichPosition`（[portfolio 路由已具备底座](../src/server/routes/portfolio.js)），答组合级问题：整体盈亏 / 集中度风险 / "该减谁" / 再平衡。
- 组合层 `decisionPanel`：组合赔率、集中度、与单仓判断的聚合。

**涉及文件**：`src/server/routes/portfolio.js`、`src/server/routes/chat.js`、`src/server/services/answerComposer.js`、`src/server/services/decisionPanel.js`、`src/app.js`(持仓视图)。

**验收**："我整个组合怎么样 / 现在该减谁" → 给出基于实时价的组合盈亏 + 集中度 + 分标的动作。

---

### P2 — 宏观 / 通用问题（真正"什么都能接住")

**做法**
- `kind = macro|general` → 走 web-evidence 主导的作答，借鉴 soul.md 的**时间锚点 + 查询改写**（"今天非农"→"2026-xx-xx 非农"再搜），不强行套公司面板。
- 与持仓联动："这事对我持仓影响" → 宏观结论叠加 P1 的组合上下文。

**涉及文件**：`src/server/services/intentClassifier.js`(新增 turn-scope 分类)、`webEvidenceService.js`、`answerComposer.js`、`src/prompts.js`。

**验收**："美联储这次会议对我持仓的影响""AI 板块还能追吗" → 给出有据、时间锚定、与持仓挂钩的判断。

---

### P3 — UI 去单公司中心化（拆掉视觉上的"这对话是哪家公司")

**做法**
- 侧栏从"研究公司 X"改为**对话中心**；新增"本轮聚焦"区，动态显示 1 / N 公司 / 组合 / 宏观。
- `decisionPanel` / 估值条改为**按需出现的卡片**（单股出 1 张，多股出 N 张，组合出组合卡）。

**涉及文件**：`src/app.js`(renderSidebar/聚焦区/卡片渲染)、`index.html`、样式。

**验收**：同一对话里可无缝在单股 / 多股 / 组合 / 宏观间切换，UI 不再暗示"只能一家"。

---

## 5. 风险与边界

- **实体误抽**：把"非农""美联储"这类宏观词错当 ticker → Router 先判 `kind`，宏观分支不强解析；ticker 解析保留 `verify` 闸门 + did-you-mean。
- **多标的数据预算**：N 个并发拉数据可能撞超时 → 每个走 `withTimeout` 兜底，组合场景用"轻摘要"（不跑 news/filings 全量，沿用 buildCompareSummary 的精简口径）。
- **后端无热重载 + 需 key**：改 `src/server/**` 须重启 node；端到端真效果要在用户非沙箱环境跑（搜索引擎在沙箱被墙）。详见 `PROJECT_PLAN_2026-06-28.md §0`。

---

## 6. 推进顺序与建议

**P0 → P1 → P2 → P3**，每阶段分开提交 + 实跑验证（用户偏好"破而后立、先修地基、实跑打分"）。

**强烈建议先做 P0**：它是 keystone——一旦"每轮抽多实体"通了，组合/宏观都是在它之上加分支；而且它直接修掉用户截图里最扎眼的 SpaceX 尴尬。**不建议大重写**：现有结构化管线是我们对 Hone 的优势，保留它、在上面加一层 Router 即可。
