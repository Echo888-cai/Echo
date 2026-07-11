# Echo Research 后台数据接入策略

Echo Research 的用户不应该自己接 API。数据接入是后台能力：产品部署方统一配置、缓存、校验和降级，前端只告诉用户哪些数据已接入、哪些证据缺口还在影响置信度。

## 产品原则

1. 用户只输入问题：例如“阿里巴巴最近怎么样”“腾讯护城河强不强”。
2. 系统自动判断需要哪些数据：行情、财报、公告、新闻、估值、股东回报、用户上传资料。
3. 先用结构化数据源，再用官方公告，再用 web 搜索补证据。
4. 找不到公开数据时，模型必须继续给出推理判断，但要明确标注“事实缺口”和“置信度下降”。
5. 任何具体财务数字必须能追溯到来源；不能用模型猜数字。

## 当前已经具备

| 数据层 | 当前实现 | 状态 |
|--------|----------|------|
| 市场识别 | `src/market.js`：HK/US/CN 三路自动识别 + 各源 symbol 映射 + 币种 | 已接入 |
| 公司 universe | `src/data/hkStocks.js`（港股）+ `src/data/cnStocks.js`（A股，主板+创业板核心 66 家分阶段种子）+ SQLite `companies`；美股按 ticker 即时建档 | 已接入 |
| 行情 | 港股 Tencent；A股 Tencent + Sina 双源；美股 Finnhub/Alpha Vantage/Yahoo；`market_snapshots` 缓存 | 已接入 |
| 财报三表 | **美股 FMP `/stable` 真财报**；港股回退腾讯/Yahoo 基础；**A股 CNINFO（巨潮资讯网）一手定期报告抽取**（`cnFilingsPipeline.js`） | 美股/A股已通一手 / 港股受限 |
| 财务质量评分 | `financialQuality.js`（美股真分，如 AAPL 83/100） | 已接入 |
| 估值与赔率 | `valuationEngine.displayValuation`（自洽 PE 带 + 赔率，市场无关，A股财报接入后同样生效） | 已接入 |
| 网页证据 | `webEvidenceService`：Tavily→公开兜底，URL 校验、去垃圾、正文抽取、可信度评分、缓存 | 已接入 |
| 新闻 | Yahoo RSS / Bing / 东方财富组合抓取 | 可用但稳定性有限 |
| 公告 | HKEX 页面解析（港股）；CNINFO `hisAnnouncement/query` JSON 接口（A股） | 港股 Beta / A股已通 |
| 研究会话 | SQLite `research_sessions`（含决策面板/估值/来源） | 已持久化 |

## A/港/美股数据现实（重要）

- **美股**：FMP 免费档覆盖真实 EPS/FCF/利润率 → 利润质量评分和估值真实分化。FMP 的 v3 接口已于 2025-08-31 废弃，必须用 `/stable/?symbol=`。
- **港股**：FMP 免费档对港股 **premium 封锁**，自动回退腾讯/Yahoo 基础数据（PE/PB/市值），完整三表需 **FMP 付费档**或解析 **HKEXnews** 年报 PDF。港股估值因此为机械 PE 带。

## A股数据现实（P-CN-2，2026-07）

- **行情**：腾讯（`qt.gtimg.cn`，`sh`/`sz` 前缀）+ 新浪（`hq.sinajs.cn`，需 `Referer` 头）双源免 key，实测均可用；FMP/Finnhub/Alpha Vantage 免费档均不覆盖 A股，只作为理论兜底（几乎不会命中）。
- **财报三表**：**CNINFO（巨潮资讯网）是沪深交易所官方指定信息披露平台**，`hisAnnouncement/query` 接口免 key、返回定期报告 PDF 列表，是 A股对应 HKEX 披露易的角色。已实测覆盖年报+一/三季报+半年报四类分类代码（`category_ndbg_szsh`/`category_yjdbg_szsh`/`category_zqbg_szsh`/`category_sjdbg_szsh`）。
- **A股财报解析比港股简单，但有自己的坑**：A股定期报告受统一会计准则强制模板约束，字段名（营业收入/归属于母公司股东的净利润/基本每股收益等）全市场高度一致，不像港股各公司排版千差万别；但实测遇到过三类真实格式坑，均已在 `cnFilingsPipeline.js` 里修复并留了真实数据回归测试（`tests/phase-cn2.mjs`）：
  1. **计量单位在同一份文档内切换**（如中兴通讯：摘要页"单位：百万元"，正式合并利润表切到"人民币千元"且无"单位："字样）——不能整篇一次性正则，必须按行扫描做局部状态。
  2. **单位直接写进字段名括号里**（如美的集团"营业收入（千元）"），会抢在按行扫描更新 ambient 单位之前抢先命中，必须就地识别并覆盖。
  3. **附注引用列污染数据列**（如银行报表"基本每股收益(人民币元) 48 2.07 2.15"里的 48 是脚注编号不是数据）——用"整数夹在小数之间"的启发式丢弃。
- **银行/保险等金融业没有"营业成本"科目**，毛利/毛利率诚实留空，不强行凑数。
- **腾讯行情接口的字段位置在 A股/港股报价格式下含义不同**：同一字段索引在港股格式下是 EPS，在 A股格式下实测是当日成交额——A股这里已改为诚实留空，真实 EPS 靠 CNINFO 一手数据补。
- **覆盖率现状**（2026-07-10 实测 `npm run cn-coverage`）：66 支种子 universe 全部检查过，60 支（91%）有真实一手财报数据；唯一失败案例是一份标题格式特殊的 H股公告（"XXX H股公告-2026年第一季度报告"），诚实报错而非编数字。
- **同业倍数自动发现（`compPeers.js`）对 A 股完全不支持**：这套机制的同业清单来自 Finnhub `/stock/peers`，查询前要把 ticker 转成美股 bare symbol 或港股 ADR（`adrOrBareSymbol`），A 股既没有 Finnhub 直查入口也没有 ADR 映射表，会在第一步就诚实返回"无法识别同业"——不是"允许 CN↔CN 对比"，是这条链路对 A 股整体不适用，包括 A 股内部同业对比也没有；要支持需要另找一个覆盖 A 股同业分类的数据源，不在当前范围内。

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

### 4. Web 搜索证据（已实现 `webEvidenceService.js`）

web 搜索不替代财报源，而是补充“近期发生了什么”。当前实现：

1. 按意图 + 公司名/ticker 生成 ≤6 组 query。
2. **provider**：配 `TAVILY_API_KEY`（或 SERPAPI）走专业搜索；否则公开兜底 DuckDuckGo / Yahoo / Bing。
3. **URL 校验**：逐条 HEAD/GET，只删确诊 404/410/死链（403/429 保留，避免误杀）。
4. **去垃圾**：丢弃首页/门户根域（qq.com/ 等）。
5. **正文抽取**：top N 页 Readability-lite（og 描述领头 + 段落评分 + 去样板）。
6. **可信度 + 相关度评分**，去重，写入 `web_evidence` 表（缓存）。
7. 校验过的证据并入 `decisionPanel.sources` → 前端可点击溯源卡；摘要喂模型生成“判断 / 依据 / 来源”。

搜索为空时：不说“什么都没接入”，改为基于商业模式/历史画像/行业常识做低置信度判断，把缺口折叠到末尾。

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
DEEPSEEK_API_KEY=        # 分析模型（推荐 deepseek-v4-flash）
FINNHUB_API_KEY=         # 美股行情 + 基础财务
ALPHAVANTAGE_API_KEY=    # 美股行情兜底
FMP_API_KEY=             # 美股真实三表（免费档）；港股需付费档
TAVILY_API_KEY=          # 网页证据（免费 1000/月）；留空则用公开兜底
SERPAPI_API_KEY=         # 网页证据备选
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
