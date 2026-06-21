# AI 接入说明

## 提示词来源

所有提示词集中在 `src/prompts.js`。前端和服务端都应把这里当成唯一提示词来源。

当前角色：

- 首席研究助手
- 公司研究助手
- 估值助手
- 风险审查助手
- 多空辩论助手
- 备忘录助手
- 组合纪律助手

## 当前网关

研究对话主入口（单趟管线：一次采集 + 一次模型 + 一次落库）：

```http
POST /api/chat                 # 研究对话
POST /api/report/generate      # 深度研究报告（同管线，换报告 prompt）
GET  /api/companies/search?q=  # 公司检索
GET  /api/status               # 数据源/模型状态
```

`/api/chat` 内部：`classifyResearchIntent` 先分意图（company_status / business_model / moat / competitors / **financial_quality**（含口语“赚钱吗”）/ valuation / **falsify**（证伪）/ deep_research），再据此选择本地兜底答案器和模型 prompt 的段落规则。估值（`displayValuation`）在模型调用前算好并注入 prompt，保证文字与可视化口径一致。

返回含：`mode`(chat_model/chat_local)、`intent`、`content`、`decisionPanel`(含估值/来源)、`valuation`、`webEvidence`、`dataSources`。模型超时则回退到意图聚焦的本地答案（仍带判断，不是“数据不足”）。

模型由 `modelGateway` 适配（DeepSeek 优先，OpenAI 兼容）；无 key 时返回本地兜底，用于稳定演示。

## 行情源（按市场路由）

`src/market.js` 的 `detectMarket` 决定 provider 顺序：

- **港股**：Tencent Finance（免费）→ Finnhub → Alpha Vantage → Twelve Data → Yahoo。
- **美股**：Finnhub → Alpha Vantage → Twelve Data → Yahoo。

币种按市场自动判定（USD / HKD）。全部失败返回 `providerStatus: "missing"`，前端显示“实时数据未接入”。

财报：美股 FMP `/stable`（真实三表）优先；港股 FMP 免费档受限，回退 Finnhub/Yahoo/腾讯基础数据。

## 密钥策略

- API Key 只放在服务端环境变量。
- 前端不保存、不展示、不传输用户密钥。
- 本地运行示例：

```bash
OPENAI_API_KEY=你的密钥 OPENAI_MODEL=你的模型 npm run dev
```

也可以复制 `.env.example` 为 `.env`，服务端启动时会自动读取。

## 输出要求

- 明确说明来源材料是否充分。
- 区分事实、假设和观点。
- 缺数据时写“未在当前材料中找到”。
- 不给买入或卖出指令。
- 高风险结论必须经过风险审查助手。
- 报告、估值和备忘录都要保留可复盘假设。
