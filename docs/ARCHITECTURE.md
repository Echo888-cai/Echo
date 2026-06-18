# Luvio 架构约定

## 目标

Luvio 的核心是投资研究 agent，而不是单次聊天框。任何新功能都要服务于三件事：

- 连续对话：同一研究主题可以多轮追问、纠错和补充材料。
- 记忆沉淀：成本、持仓、偏好、关注主题和已上传资料要成为后续上下文。
- 可复盘资产：回答最终要能沉淀到公司档案、报告、备忘录和关注列表。

## 项目结构

```
luvio/
├── index.html             ← SPA 入口
├── server.js              ← HTTP 网关、静态文件、API 路由
├── package.json           ← 依赖：better-sqlite3
├── luvio.db               ← SQLite 数据库（gitignored，npm run seed 创建）
├── .env                   ← API Key 等敏感配置（gitignored）
│
├── src/
│   ├── app.js             ← 页面渲染、路由、localStorage、用户交互
│   ├── styles.css         ← 全局样式（6500+ 行）
│   ├── modelClient.js     ← 前端 → 服务端 API 请求封装
│   ├── data.js            ← 种子数据（35 家 + detailOverrides）+ 估值/报告/备忘录模板
│   │
│   ├── data/
│   │   └── hkStocks.js    ← 650+ 家港股公司全量列表（universe source of truth）
│   │
│   ├── db/
│   │   └── index.js       ← SQLite 连接、schema 初始化、CRUD 函数
│   │
│   ├── agent/             ← 研究 Agent（DeepSeek function calling）
│   │   ├── agent.js       ← Agent 引擎：iteration / tool dispatch
│   │   ├── provider.js    ← LLM Provider 适配（OpenAI 兼容）
│   │   ├── tool.js        ← 工具基类
│   │   ├── toolRegistry.js
│   │   ├── index.js       ← 工厂方法 createResearchAgent()
│   │   └── tools/
│   │       ├── market.js      ← get_market_data
│   │       ├── financials.js  ← get_financial_data
│   │       ├── news.js        ← get_news_and_filings
│   │       ├── company.js     ← get_company_profile
│   │       └── research.js    ← summarize_research
│   │
│   ├── marketData.js      ← 行情适配器（Tencent Finance / FMP / etc.）
│   ├── financialData.js   ← 财报数据适配器（FMP）
│   ├── newsData.js        ← 新闻适配器
│   ├── filingData.js      ← 公告数据适配器
│   ├── documentParser.js  ← 上传资料解析（PDF/图片/文本）
│   ├── prompts.js         ← Agent system prompt + 工作流注册表
│   └── productStrategy.js ← 产品价值、竞品分析、定位文本
│
├── scripts/
│   ├── seed-db.js         ← 数据库种子脚本（npm run seed）
│   └── extract_pdf_text.py
│
├── tests/
│   └── smoke.mjs          ← 冒烟测试
│
└── docs/
    ├── ARCHITECTURE.md    ← 本文
    ├── DATABASE.md        ← 数据库 schema 和查询指南
    ├── DATA_PIPELINE.md   ← 数据流、实时数据、添加新公司
    ├── PRD.md             ← 产品需求文档
    ├── PLATFORM_BENCHMARK.md
    └── AI_INTEGRATION.md
```

## 分层架构

```
┌─────────────────────────────────────────────────────┐
│                   前端 (src/app.js)                   │
│  render() → shell() → 3-column workspace            │
│  localStorage: 研究状态、会话历史、watchlist           │
│  事件委托: click/input/submit/change → action map   │
├─────────────────────────────────────────────────────┤
│                 API 层 (src/modelClient.js)           │
│  fetch /api/agent → POST                            │
│  fetch /api/market → GET                            │
│  fetch /api/news → GET                              │
│  fetch /api/parse-document → POST                   │
├─────────────────────────────────────────────────────┤
│                服务端 (server.js)                     │
│  HTTP 路由 + 静态文件 + API 编排                      │
│  模型调用 + 工具执行 + 响应合成                       │
├─────────────────────────────────────────────────────┤
│              数据层                                   │
│  ┌──────────────┐  ┌──────────────────────────┐     │
│  │  luvio.db    │  │  外部 API                 │     │
│  │  (SQLite)     │  │  · Financial Modeling Prep│     │
│  │   · companies │  │  · Tencent Finance       │     │
│  │   · company_  │  │  · News API / Finnhub    │     │
│  │     details   │  │  · HKEXnews              │     │
│  │   · market_   │  └──────────────────────────┘     │
│  │     snapshots │                                    │
│  │   · research_ │                                    │
│  │     sessions  │                                    │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

## 前端边界

- `src/app.js`：页面渲染、路由、localStorage 状态和用户交互。
- `src/modelClient.js`：所有前端到服务端 API 的请求封装。
- `src/styles.css`：视觉样式。三栏研究工作台（240px + 1fr + 280px）。
- `src/data.js`：估值、报告和备忘录模板。

前端可以保存轻量记忆（研究状态、会话、watchlist），但不要在浏览器中保存模型密钥。

## 服务端边界

- `server.js`：HTTP 网关、模型调用编排、静态文件服务。
- `src/db/index.js`：数据库连接和查询。
- `src/documentParser.js`：上传资料解析。
- `src/marketData.js`：行情适配器。
- `src/newsData.js`：新闻与舆论适配器。
- `src/prompts.js`：agent 角色、工作流和提示词注册表。

服务端接口应该保持可降级：行情、新闻或模型超时时，要返回阶段性研究结果。

## 港股公司数据

当前包含 **650+ 家** 港股公司覆盖：

- **数据源**：`src/data/hkStocks.js` 是 universe 的 source of truth
- **存储**：SQLite `companies` + `company_details` 表
- **检索**：`getCompanyByTicker()`、`findCompanies()`、`getCompaniesBySector()`
- **覆盖**：恒指成分股 ~80 家 + 大型中概股 + 各行业代表性公司
- **扩展**：编辑 `hkStocks.js` + `npm run seed` 即可添加新公司

详见 `docs/DATABASE.md`。

## Agent 输入

`POST /api/agent` 必须接收并使用：

- `question`：本轮用户问题。
- `company`：当前研究对象（从 DB 获取）。
- `filings`：公司页导入的公告材料。
- `history`：最近多轮对话。
- `memory`：用户长期记忆。
- `documents`：上传资料解析结果。

## Agent 工具

| 工具 | 函数 | 数据源 |
|------|------|--------|
| `get_company_profile` | DB + FMP | `companies` + `company_details` + `financialData.js` |
| `get_market_data` | 外部 API | Tencent Finance / FMP / Alpha Vantage |
| `get_financial_data` | 外部 API | Financial Modeling Prep |
| `get_news_and_filings` | 外部 API | News API / Finnhub |
| `summarize_research` | Agent 合成 | 以上所有数据 |

## 研究室展示状态

研究室的首页（空状态）= 专业投资研究工作台，包含：

- 左侧边栏：新建研究、搜索、最近研究列表、设置
- 中心区：Hero、3 步研究流程卡片、5 个研究模板、带快捷芯片的 Composer
- 右侧面板：研究概况、数据源状态、上传资料入口

用户提交问题后进入三栏研究 workspace 进行深度研究。

## 文档解析

`POST /api/parse-document` 接收前端传入的 `name`、`type`、`dataUrl`，返回统一资料对象：

- `name`、`type`、`size`、`parser`、`text`、`summary`、`createdAt`

图片当前记录元数据；接入视觉 OCR 后应替换 `src/documentParser.js` 内部实现。
