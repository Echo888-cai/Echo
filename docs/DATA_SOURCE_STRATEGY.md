# Luvio 后台数据接入策略

Luvio 的用户不应该自己接 API。数据接入是后台能力：产品部署方统一配置、缓存、校验和降级，前端只告诉用户哪些数据已接入、哪些证据缺口还在影响置信度。

## 产品原则

1. 用户只输入问题：例如“阿里巴巴最近怎么样”“腾讯护城河强不强”。
2. 系统自动判断需要哪些数据：行情、财报、公告、新闻、估值、股东回报、用户上传资料。
3. 先用结构化数据源，再用官方公告，再用 web 搜索补证据。
4. 找不到公开数据时，模型必须继续给出推理判断，但要明确标注“事实缺口”和“置信度下降”。
5. 任何具体财务数字必须能追溯到来源；不能用模型猜数字。

## 当前已经具备

| 数据层 | 当前实现 | 状态 |
|--------|----------|------|
| 公司 universe | `src/data/hkStocks.js` + SQLite `companies` | 已接入 |
| 公司画像 | `src/data.js` + SQLite `company_details` | 已接入一部分 |
| 行情 | Tencent Finance 免费接口 + `market_snapshots` 缓存 | 已接入 |
| 新闻 | Yahoo RSS / Bing / 东方财富组合抓取 | 可用但稳定性有限 |
| 公告 | HKEX 页面解析 | Beta |
| 财报三表 | FMP/Finnhub/Yahoo 等 provider 入口 | 需要后台 key 或更稳定 provider |
| 研究会话 | SQLite `research_sessions` | 已持久化 |

## 推荐后台数据源

### 1. 行情和基础估值

优先级：

1. Tencent Finance 免费接口：作为港股实时报价兜底。
2. EODHD：补历史 K 线、交易日历、复权、分红、全球市场覆盖。
3. FMP：补 quote、market cap、ratio 和基础财务指标。

后台目标：

- `market_snapshots` 表保留最新行情。
- 交易时间 15 分钟内缓存，非交易时间 4 小时缓存。
- 报告中显示价格来源和时间，不把旧缓存伪装成实时。

### 2. 财报三表和核心数学

优先级：

1. FMP：income statement、balance sheet、cash flow、ratios。
2. EODHD：fundamentals、historical financials、dividends、splits。
3. Finnhub：basic financials、company financials、analyst estimates。
4. HKEX 年报/中报 PDF：作为官方兜底，用文档解析抽取关键表格。

后台目标：

- 新增 `financial_snapshots` 表，按 `ticker + period + source` 存财务快照。
- 标准化字段：收入、毛利、经营利润、净利润、经营现金流、资本开支、自由现金流、现金、债务、股本、分红、回购。
- 报告里的“赚不赚钱”“估值贵不贵”“现金流好不好”都从这张标准化表取数。

### 3. 公告和官方材料

优先级：

1. HKEXnews Title Search：公告、通函、年报、中报、盈利预警、回购公告。
2. 公司 IR 页面：业绩公告、presentation、transcript。
3. 用户上传资料：PDF、截图、研报、会议纪要。

后台目标：

- 新增 `filing_documents` 表，存公告标题、日期、PDF URL、抽取文本、摘要。
- agent 先检索最近 12 个月公告，再回答重大事件和证伪条件。
- 对官方公告给更高可信度，对媒体新闻给中等可信度。

### 4. Web 搜索补证据

web 搜索不是替代财报源，而是补充“近期发生了什么”。

推荐流程：

1. 根据公司名、ticker、问题关键词生成 3-5 个搜索 query。
2. 只保留可信域名：公司 IR、HKEXnews、交易所、主流财经媒体、数据 provider。
3. 抽取标题、发布时间、URL、摘要。
4. 存到 `web_evidence` 表。
5. 让模型引用这些 evidence 生成“事实 / 推断 / 来源”。

搜索失败时：

- 不回答“什么都没有接入”。
- 改为：说明公开证据缺口，然后基于商业模式、历史画像、行业常识做低置信度推断。

## Agent 调度逻辑

```text
用户问题
  ↓
识别公司 / ticker / 问题类型
  ↓
读取 SQLite：company_details + research_sessions + documents
  ↓
读取缓存：market_snapshots + financial_snapshots + filing_documents + web_evidence
  ↓
缓存缺失或过期？
  ├─ 是：后台 provider 拉取 / web 搜索 / HKEX 抓取
  └─ 否：直接使用缓存
  ↓
统一证据包 EvidencePack
  ↓
模型生成结构化 decisionPanel
  ↓
生成用户可读回答或深度报告
  ↓
写回 research_sessions
```

## 需要新增的后端模块

```text
src/server/services/evidenceCollector.js
src/server/services/webSearchService.js
src/server/services/financialNormalizer.js
src/server/repositories/financialSnapshotsRepository.js
src/server/repositories/filingDocumentsRepository.js
src/server/repositories/webEvidenceRepository.js
```

## 环境变量

这些 key 由部署方配置在服务器或 GitHub Secrets，不让普通用户填写。

```text
FMP_API_KEY=
EODHD_API_KEY=
FINNHUB_API_KEY=
BING_SEARCH_API_KEY=
SERPAPI_API_KEY=
```

部署到云端后，推荐把 key 放在：

- 本地开发：`.env`
- GitHub Actions：Repository Secrets
- Render / Railway / Fly.io / Vercel：Environment Variables

## 最小可交付路线

### Phase 1：把现有能力产品化

- 研究会话持久化并可恢复。
- 设置页展示数据接入状态。
- 报告中明确“已接入 / 缺失 / 用推理补足”的边界。

### Phase 2：补数学能力

- 接入一个主 provider：优先 FMP 或 EODHD。
- 新增 `financial_snapshots` 表。
- 报告加入收入、利润、现金流、PE、FCF、分红/回购等字段。

### Phase 3：web 搜索证据层

- 增加 `webSearchService`。
- 搜索结果写入 `web_evidence`。
- agent 回答时可引用可点击来源。

### Phase 4：官方公告自动化

- HKEXnews 定时抓取重点公司公告。
- PDF 自动解析、摘要、存档。
- 报告中将公告作为高可信来源。

## 关键限制

- web 搜索不能保证完整性，不能用来替代三表财务数据。
- 免费接口可能限流或结构变化，所以必须有缓存和降级。
- 模型可以推理商业判断，但不能凭空制造财务数字。
- 所有来源必须在回答末尾可点击展示。

## 参考入口

- FMP API 文档：https://site.financialmodelingprep.com/developer/docs
- EODHD API：https://eodhd.com/
- Finnhub API 文档：https://finnhub.io/docs/api
- HKEXnews 标题搜索：https://www1.hkexnews.hk/search/titlesearch.xhtml
