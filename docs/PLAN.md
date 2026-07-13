# Echo Research 终局计划与验收底账

> 更新于 2026-07-13。本文是仓库唯一计划文档。生产当前稳定版本保持不变，直到本地新架构验收后由负责人明确批准切流。

## 1. 产品与红线

Echo Research 是面向港股、美股与 A 股价值投资者的证据优先 AI 研究台。核心资产是财报管道、估值与财务质量规则、factGuard、证伪闭环、研究记忆和安静的研究札记体验。

永久红线：

1. 不给买卖指令，只输出研究判断、监控条件和风险检查点。
2. 不编数字；取不到就明确显示“未核到”，近似口径必须标注。
3. 私有数据由应用层租户过滤和 PostgreSQL 强制 RLS 双重隔离。
4. 金额、股数、比率与估值不使用二进制浮点：存储用 `NUMERIC`，计算用 Rust 十进制定点。
5. 密钥只存服务端环境；未获商用授权的数据源不得进入商用路径。
6. 组合净值缺日即断口，不插值、不回填。
7. UI 变更必须通过 375/768/1280 三档视口与双主题实跑。
8. 数据变更必须可恢复；发布采用 expand-contract 与蓝绿方式。

## 2. 唯一运行架构

```text
React/PWA ── tRPC + Hono SSE ── Hono API ── PostgreSQL
                                  │
                                  └── Temporal ── worker / filing / backup

packages/domain       纯领域规则、答案与报告编排
packages/application  研究用例编排
packages/contracts    zod 契约单一源
packages/db           Drizzle、双时态财务仓库、强制 RLS
packages/data-plane   授权感知的供应商适配器
packages/ui           品牌与组件
crates/finance-core   十进制定点金融数值内核
```

端与端之间只有 zod 契约；领域包不接触 IO；多步任务由 Temporal 提供可重放语义；结构化研究数据保留 valid time 与 knowledge time。

## 3. 执行结果（严格按 1 → 6 完成）

### 1 · 领域层

- [x] 判断规则、factGuard、证伪、事件、画像、答案与报告编排集中到 `packages/domain`。
- [x] `packages/application` 承担研究用例编排，API 与 worker 共享同一实现。
- [x] Rust 金融内核通过十进制字符串窄边界接入，黄金向量覆盖一致性。

### 2 · Hono + tRPC

- [x] 非流式 Web 操作全部走类型化 tRPC。
- [x] REST/OpenAPI 兼容入口由 Hono 原生适配器提供。
- [x] 研究流由 Hono 原生 SSE 提供，保留 status/token/final/done 事件契约。
- [x] 鉴权、签名 HttpOnly cookie、CSRF、限速和请求体上限均为 Hono 中间件。

### 3 · Drizzle + PostgreSQL

- [x] 全部 24 个 repository 使用 Drizzle/PostgreSQL；仓库不存在文件数据库运行依赖。
- [x] 私有表强制 RLS，认证会话使用 security-definer 数据库函数建立租户边界。
- [x] 财务事实采用双时态追加模型，金融字段使用 `NUMERIC`。
- [x] 历史数据已完成实库迁移与逐表校验；迁移桥接代码和源数据库文件均已移除。
- [x] 真实备份、隔离恢复、关键表核对与 RLS 保留演练通过。

### 4 · Temporal

- [x] 深度研究、披露入库、业绩复盘、摘要、证伪核对和 PostgreSQL 备份均为 workflow。
- [x] 盘前、盘后、证伪、业绩和每日备份均由 Temporal schedule 注册。
- [x] 故障注入测试证明已完成步骤不重跑、失败步骤按策略重试并继续。

### 5 · React + PWA

- [x] 研究、关注、持仓、公司画像、通知、引导、反馈和设置全部由 React 提供。
- [x] PWA 包含 manifest、离线壳、运行时缓存、推送、通知点击和安装引导。
- [x] 375/768/1280 三档视口和明暗主题实跑，无横向溢出。
- [x] 当前 Lighthouse 全量审计通过；核心研究流与移动端主题由 Playwright 覆盖。

### 6 · 本地退役与终验

- [x] 仓库只保留终局运行架构；迁移桥、重复实现、旧入口、源数据库和备份文件全部删除。
- [x] 三层测试门禁为领域/数据库单测、唯一 API 契约测试和 Playwright E2E，并包含 Temporal 可重放专项测试。
- [x] 恢复演练以真实 `pg_dump` / `pg_restore` 验证关键表与强制 RLS。
- [x] 新部署基线以 IaC、蓝绿服务、OTel 和 SLO 告警描述；不对生产执行未批准变更。

## 4. 最终验收命令

```bash
export DATABASE_URL=postgresql:///echo_dev
npm install
npm run db:migrate
npm run lint
npm run typecheck
npm run lint:rust
npm test
npm run test:e2e
npm run build --workspace @echo/web
npm run db:recovery-drill
```

完成定义：以上命令全部退出码为 0；仓库扫描不存在已退役入口、文件数据库依赖或迁移兼容层；生产保持不变，切流必须在本地验收后单独批准。

## 5. 下一产品阶段（不属于架构换血）

在干净底座上继续推进盈余质量红旗、行业估值路由、A/H 溢价、业绩期视图、证伪线温度计、未决问题闭环，以及数据授权、计费、渗透测试和法务发布准备。这些能力不得重新引入第二套底盘或旁路数据实现。
