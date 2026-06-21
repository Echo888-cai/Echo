# Luvio 交接文档（对标 HoneClaw 的提质改造）

> 用途：在新对话里贴这份文档，就能快速接力，不用重新调研。
> 最后更新：2026-06-22 · 分支 `cleanup/pristine-refactor`

## 一、这是什么项目

Luvio 是港股 + 美股价值投资 AI 研究产品（纯 Node + better-sqlite3，无前端框架，原生 JS SPA）。
核心心智：**连续对话完成研究**，结构化决策面板（decisionPanel）+ 前端组件渲染。
模型走 `modelGateway`（GLM/DeepSeek/OpenAI 优先级 fallback）。数据走 FMP（美股免费档有真实基本面，港股需付费档）。

对标竞品：**HoneClaw**（B-M-Capital-Research/honeclaw，Rust 投研系统）。
调研结论与超越路线见记忆 `honeclaw-competitive-analysis.md` 与 `luvio-product-roadmap.md`。

## 二、已完成（P1 + P2 + P3，均已实现并测试）

### P1 立刻提质
- **研究纪律宪法**：`src/prompts.js` 的 `RESEARCH_DISCIPLINE`（概率优先/先校验/时间锚点/四层输出/估值纪律/辩证框架/禁止事项），注入 `PROMPTS.cio`（JSON 面板）和 `PROMPTS.chat`（散文追问）。
- **时间锚点 + 查询改写**：`src/server/utils/time.js`。相对时间问题（今天/最新/盘前）搜索前把绝对日期锚进查询。
- **数据源加固**：`src/fmpClient.js`——多 Key（`FMP_API_KEY` + `FMP_API_KEYS` 逗号分隔）+ 401/403→24h、402/429→6h 冷却自动 fallback + 分级 TTL 缓存（行情5min/评级3h/财报6h/分红12h/profile24h）。`financialData.js` 4 个 FMP 函数已改用 `fmpGet`。

### P2 核心壁垒
- **P2.1 公司画像长期记忆**：
  - `src/server/repositories/companyProfiles.js`（SQLite `company_profiles` 表）
  - `src/server/services/companyPortrait.js`（`loadPortraitContext` 注入研究上下文；`updatePortraitFromPanel` 从 decisionPanel 蒸馏当前 view，**判断变化才记 event，未变只累计轮次**）
  - `src/server/routes/portraits.js` → `/api/company/profile(s)`
  - 前端"公司画像 ◆"按钮 + 建档/变化 toast
- **P2.2 两阶段检索→作答**：
  - `src/server/services/twoStageChat.js`（阶段1 检索分流产出研究笔记，阶段2 作答；阶段1 失败→单段，作答失败→本地兜底）
  - `chat.js` 用 `runTwoStageChat` 替换单次 callModel；响应加 `stages` 字段

### P3 系统化
- **P3.1 事件引擎 MVP**：
  - `src/server/services/eventEngine.js`（律所广告反模板 + 高影响关键词分级 + 财报日历倒计时 + 新闻 + 三层过滤 + 持仓触线提醒）
  - `src/server/routes/events.js` → `/api/events/digest`（受众=有画像或有持仓的公司）
  - 前端"盘前事件 ◷"按钮
- **P3.2 持仓记账与纪律提醒**：
  - `src/server/repositories/portfolio.js`（`portfolio_positions` 表）
  - `userContext.js` 加止损/止盈解析；`chat.js` 自然语言记账 upsert（响应加 `positionSaved`）
  - eventEngine 现价≤止损 / ≥止盈 / 回撤≥20% 产出 `position_alert`
  - `src/server/routes/portfolio.js` → `/api/portfolio`；前端"我的持仓 ▣"按钮

### 测试
- `tests/smoke.mjs` 已加：提示词宪法、时间锚点/查询改写、FMP fallback/缓存/冷却、画像建档/部分更新、新闻分级、止损解析+记账。
- `npm test` 全绿（smoke + reliability + phase3 = 17 passed）。浏览器实测三个新按钮渲染正常、无 console 错误。

## 三、未完成 / 待办（下次接力重点）

1. **P4 多渠道**：先接 Telegram（成本最低）。当前只有 Web。
2. **事件引擎真正定时触发**：现在是"按需 digest"（点按钮才算）。本地无常驻进程，要真正盘前自动推送需要 cron / 常驻服务 / 系统定时任务。
3. **真实效果实测**：两阶段作答、画像蒸馏、财报日历依赖模型 key + FMP key，在开发沙箱无法跑真实 LLM/付费数据。**需要在本地配好 `.env`（`GLM_API_KEY` 或 `DEEPSEEK_API_KEY` + `FMP_API_KEY`）后人工实测一轮**，确认提示词纪律和画像连贯性符合预期。
4. **LLM 新闻仲裁**：HoneClaw 对"不确定来源"新闻用 LLM 判重要性并跨用户缓存。当前 eventEngine 只做确定性关键词分级，可选增强。
5. **画像的用户偏好/约束沉淀**：当前画像主要存投资主线/Bull/Bear/证伪。HoneClaw 还沉淀用户偏好（反感高杠杆、偏好 FCF 等），可扩展。

## 四、怎么在本地跑

```bash
npm run dev          # 启动，默认 http://127.0.0.1:4173
npm test             # 跑全部测试
```

配 `.env`（gitignored）：`GLM_API_KEY=...`、`FMP_API_KEY=...`（多个用 `FMP_API_KEYS=k1,k2`）、可选 `TAVILY_API_KEY=...`（网页证据）。

## 五、关键约束记牢

- FMP 免费档**只覆盖美股，不含港股**；必须用 `/stable/?symbol=`（v3 已废弃）。
- 改动都在 `cleanup/pristine-refactor` 分支，**环境无 git 凭据，需在 GitHub Desktop 手动 Push**。
- 要保持的既有优势：结构化 decisionPanel + JSON schema 校验 + repair-once + 本地兜底；可视化估值条/证据卡/置信度；HK+US 双市场。
