# Echo Research 架构约定

## 目标

Echo Research 的核心是一个**A/港/美股**投资研究 agent，不是单次聊天框。任何新功能都要服务于三件事：

- **连续对话**：同一研究主题可以多轮追问、纠错、补充材料。
- **证据优先**：每个判断都带可点击、可信度评分、URL 校验过的来源。
- **可复盘资产**：回答能沉淀为研究会话、决策面板、估值、可导出报告。

## 项目结构

```
luvio/
├── index.html                 ← SPA 入口
├── server.js                  ← 瘦 HTTP 路由（只挂前端真正用到的端点）+ 静态文件
├── luvio.db                   ← SQLite（gitignored，npm run seed 创建）
├── .env                       ← API Key（gitignored）
│
├── src/
│   ├── app.js                 ← 渲染、路由(研究室/设置)、localStorage、交互
│   ├── styles.css             ← Apple 质感 UI（设计 token + 动效）
│   ├── market.js              ← ★ 市场识别层：detectMarket(HK/US) + 各源 symbol 映射 + 币种
│   ├── data.js                ← 港股精选档案 + ticker 归一 + 报告/备忘录模板
│   ├── marketData.js          ← 行情适配（港股腾讯 / 美股 Finnhub·AlphaVantage·Yahoo）
│   ├── financialData.js       ← 财报适配（FMP /stable / Finnhub / Yahoo / 腾讯）
│   ├── newsData.js · filingData.js · documentParser.js · prompts.js
│   ├── data/hkStocks.js       ← 650+ 港股 universe（可搜索表 source of truth）
│   ├── db/index.js            ← SQLite 连接 + schema
│   └── server/
│       ├── routes/            ← chat · reports · companies · research · status · documents
│       ├── services/          ← answerComposer · valuationEngine · financialQuality ·
│       │                         webEvidenceService · agentService · decisionPanel ·
│       │                         dataSources · modelGateway · intentClassifier · reportComposer …
│       ├── repositories/      ← researchSessions · companyRepository · webEvidenceRepository …
│       └── schemas/           ← agentPanel（结构化输出校验）
│
├── scripts/seed-db.js         ← 数据库种子
├── tests/                     ← smoke · reliability · phase3
└── docs/                      ← 本目录
```

> 已移除的历史包袱：`src/agent/`（function-calling 旧引擎）、`/api/agent`·`/api/watchlist`·`/api/web-research`·`/api/market` 等前端不调用的路由、旧版 `/api/report`。`server.js` 现在只挂 6 类端点。

## 单趟研究管线（/api/chat）

chat 路由很薄，编排一次数据采集 + 一次模型调用 + 一次落库：

```
POST /api/chat
  │
  ├─ classifyResearchIntent(question)            ← 意图：财务质量/护城河/竞争/证伪/估值…
  │
  ├─ Promise.all:
  │     ├─ runAgent(persist:false, useModelPanel:false)   ← 行情+财报+新闻+公告 并行采集 → 本地决策面板
  │     └─ researchWebEvidence(...)                       ← 网页证据(Tavily→DDG/Yahoo/Bing) + URL校验 + 正文抽取
  │
  ├─ displayValuation(profile, market, financials)        ← 估值区间 + 赔率（自洽守卫）
  ├─ buildChatPrompt(...) → callModel(单次, 30s)          ← 模型生成正文；超时→意图聚焦的本地兜底
  ├─ mergeEvidenceIntoPanel(panel, webEvidence)           ← 证据并入面板(去重/可信度) → 持久化
  └─ persistFinalChatSession(...)                         ← 单次落库
```

答案的所有模板/拼装逻辑都在 `services/answerComposer.js`（route 不含文案）。深度研究 `/api/report/generate` 复用同一管线，换一个报告 prompt。

## 市场识别层（HK + US）

`src/market.js` 是"哪个市场、symbol 怎么拼"的唯一来源：

| 函数 | 作用 |
|---|---|
| `detectMarket(t)` | 数字/.HK → `HK`；字母/.US → `US` |
| `fmpSymbol` / `finnhubSymbol` / `yahooSymbol` / `alphaVantageSymbol` / `twelveDataSymbol` / `tencentSymbol` | 按市场拼对应源的 symbol |
| `marketCurrency` | US→USD，HK→HKD |

行情与财报源都按 `detectMarket` 选择 provider 顺序。**美股基本面用裸 symbol 查 FMP `/stable` → 免费档返回真实 EPS/FCF/利润率**；港股 FMP 免费档被 premium 封锁，优雅回退腾讯/Yahoo。

## 数据层

```
SQLite luvio.db                         外部 API（按市场路由）
 · companies / company_details   行情  港股: Tencent Finance(免费)
 · market_snapshots                     美股: Finnhub / Alpha Vantage / Yahoo
 · research_sessions(含 panel/估值/来源)  财报  US: FMP /stable（真财报）  HK: 腾讯/Yahoo 基础
 · web_evidence(缓存+可信度)              证据  Tavily / SerpAPI →（无 key）DuckDuckGo / Yahoo / Bing
```

服务端接口保持可降级：任何源超时都返回 missing 占位，下游照常给阶段判断。

## 前端

`src/app.js` 单文件：两个路由（研究室 / 设置），事件委托(click/submit/change/keydown → action map)，localStorage 存研究状态。两栏工作台（侧栏 + 研究区），回答卡内联渲染**估值区间条、证据溯源卡、置信度芯片、状态标签**。不在浏览器保存模型密钥。

## 测试

`npm test` = smoke（报告合成/会话持久化）+ reliability（agentService/decisionPanel/估值/财务质量）+ phase3（意图分类/财务质量引擎/网页证据/估值/风险）。
