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

本地服务提供：

```http
POST /api/agent
POST /api/report
GET /api/market?ticker=0700.HK
```

请求体：

```json
{
  "question": "腾讯现在贵不贵？",
  "company": {},
  "filings": [],
  "promptVersion": "luvio-prompts-v0.4"
}
```

返回：

```json
{
  "mode": "model",
  "model": "由 OPENAI_MODEL 控制",
  "content": "模型输出"
}
```

如果没有 `OPENAI_API_KEY`，网关返回 `mode: "local"`，用于稳定演示。

## 行情源

港股行情会优先尝试 Tencent Finance 公开接口作为免费兜底。也支持以下环境变量，任意配置一个即可：

- `ALPHAVANTAGE_API_KEY`
- `TWELVEDATA_API_KEY`
- `FINNHUB_API_KEY`

优先级：

1. Alpha Vantage
2. Twelve Data
3. Finnhub
4. Yahoo Chart 公开接口兜底

实际执行顺序：

1. Tencent Finance 港股公开接口
2. Finnhub
3. Alpha Vantage
4. Twelve Data
5. Yahoo Chart 公开接口兜底

如果全部失败，接口返回 `providerStatus: "missing"`，前端显示“实时数据未接入”。

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
