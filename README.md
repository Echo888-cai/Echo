# Luvio

Luvio 是面向港股长期价值研究的 AI 研究室。

它不是行情刺激工具，而是把"选公司、问问题、找证据、做估值、审风险、存备忘录、看组合纪律"收进一个可复盘的产品闭环。

## 核心能力

- **专业投资研究工作台**首页：三栏布局、研究模板、快捷芯片、数据源概览。
- **650+ 港股公司覆盖**：涵盖恒指成分股、大型中概股、各行业代表性公司。
- **SQLite 数据库存储**：公司资料、行情快照、研究会话、关注列表、上传资料持久化。
- **AI Agent 研究引擎**：自动调用行情、财报、新闻、公司档案等工具，生成结构化研究结论。
- **JSON Schema 校验 + 自动修复**：模型输出不符合固定 schema 时自动修复一次，仍失败则本地降级。
- **用户持仓解析**：自动识别"成本价 4.9，持有 3000 股"等自然语言输入，存入统一 userContext。
- **研究可审计**：每个结论都带 evidence 数组（来源、时间、可信度、缺失原因）。
- **关注列表 + 组合纪律**：服务端持久化，含成本、持股、行业暴露统计。
- **上传资料解析**：支持 PDF、图片、文本等格式，持久化到 SQLite。
- **报告生成**：从结构化研究结果生成可保存/导出的 Markdown 报告，含来源审计。

## 本地运行

```bash
npm run dev
```

打开 `http://127.0.0.1:4173`。

### 初始化数据库

```bash
npm run seed
```

种子脚本会创建 `luvio.db` 并填充 650+ 港股公司数据。

## 测试

```bash
npm test
```

当前测试覆盖 smoke、reliability、phase2、report 等核心链路，覆盖：
- ticker 标准化
- 用户持仓自然语言解析
- JSON Schema 校验（拒绝 买入/持有/卖出 等违规字段）
- 模型输出修复（Markdown 包 JSON 提取）
- 数据源超时降级
- 研究 session 持久化
- 公司搜索（SQLite 654+）
- 关注列表 CRUD + 组合纪律统计
- 文档持久化
- 报告生成器

## API 清单

| 路径 | 方法 | 说明 | 响应格式 |
|------|------|------|----------|
| `/api/status` | GET | 服务状态与数据源配置 | 旧格式 |
| `/api/market?ticker=X` | GET | 实时行情 | 旧格式 |
| `/api/news?ticker=X` | GET | 新闻舆论 | 旧格式 |
| `/api/financials?ticker=X` | GET | 财报数据 | 旧格式 |
| `/api/filings?ticker=X` | GET | 公告数据 | 旧格式 |
| `/api/agent` | POST | 研究助手（结构化结果） | 旧格式 |
| `/api/report` | POST | 报告生成 | 旧格式 |
| `/api/parse-document` | POST | 解析上传资料 | 旧格式 |
| `/api/companies/search?q=` | GET | 搜索公司（SQLite 654+） | `{ ok, data }` |
| `/api/companies/:ticker` | GET | 公司详情 + 资料完整度 | `{ ok, data }` |
| `/api/watchlist` | GET | 关注列表 + 纪律统计 | `{ ok, data }` |
| `/api/watchlist` | POST | 添加关注项 | `{ ok, data }` |
| `/api/watchlist/:id` | PATCH | 更新关注项 | `{ ok, data }` |
| `/api/watchlist/:id` | DELETE | 删除关注项 | `{ ok, data }` |
| `/api/documents` | GET | 文档列表（?ticker= 过滤） | `{ ok, data }` |
| `/api/documents` | POST | 上传并持久化文档 | `{ ok, data }` |
| `/api/documents/:id` | GET | 获取单篇文档 | `{ ok, data }` |
| `/api/research/sessions` | GET | 研究会话列表 | `{ ok, data }` |
| `/api/research/sessions/:id` | GET | 研究会话详情 + 报告 | `{ ok, data }` |

后端新 API 使用统一响应格式：`{ ok, data, meta: { requestId, asOf } }`。

## 接入模型

前端不保存 API Key。复制 `.env.example` 为 `.env`，填写：

```text
OPENAI_API_KEY=你的密钥
OPENAI_MODEL=gpt-4.1-mini
```

如果没有设置模型密钥，研究助手自动使用本地可演示回复（本地 fallback）。

支持 DeepSeek（自动降级）：

```text
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-v4-pro
```

## 接入真实行情

港股行情优先尝试 Tencent Finance 公开接口作为免费兜底；其他行情源按环境变量补充：

```text
FMP_API_KEY=          # Financial Modeling Prep（财报）
ALPHAVANTAGE_API_KEY= # 行情
TWELVEDATA_API_KEY=   # 行情
FINNHUB_API_KEY=      # 新闻
```

服务端 API：

- `GET /api/market?ticker=0700.HK` — 实时行情
- `GET /api/financials?ticker=0700.HK` — 财报数据
- `GET /api/news?ticker=0700.HK` — 新闻
- `POST /api/agent` — 研究助手
- `POST /api/report` — 报告生成

如果全部行情源不可用，页面显示"实时数据未接入"，不会用 seed 数据冒充实时行情。

## 数据架构

```
src/data/hkStocks.js  ──→  npm run seed  ──→  luvio.db (SQLite)
  650+ 家公司               种子脚本               companies 表（650+）
  按行业分组                                       company_details 表（31 家详细画像）
  is_hsi 标记恒指成分                              market_snapshots 表（行情缓存）
                                                  research_sessions 表（研究会话）
                                                  watchlist 表（关注列表）
                                                  documents 表（上传资料）
```

- 所有关键用户资产（研究会话、上传资料、关注列表）已服务端持久化到 SQLite。
- localStorage 只作为 UI 草稿和主题，不作为唯一数据源。
- 搜索从 SQLite 的 654+ 家公司查询，不限 31 家 seed。

## 产品原则

- 中文港股优先。
- 先证据，后结论。
- 不输出买卖指令（买入/卖出/持有）。
- 使用研究状态（持续观察/需要补充材料/数据缺失暂不评分/风险提示/不在研究范围）。
- 每次研究都经 JSON Schema 校验，不合格则修复或本地降级。
- 每次研究自动持久化到 research_sessions。

## 文档

- [架构约定](docs/ARCHITECTURE.md)
- [数据库指南](docs/DATABASE.md)
- [数据管道](docs/DATA_PIPELINE.md)
- [后台数据接入策略](docs/DATA_SOURCE_STRATEGY.md)
- [产品需求](docs/PRD.md)
- [平台对标](docs/PLATFORM_BENCHMARK.md)
- [AI 集成](docs/AI_INTEGRATION.md)
- [GitHub 工作流](docs/GITHUB_WORKFLOW.md)
