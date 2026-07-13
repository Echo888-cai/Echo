# Echo Research

面向港股、美股与 A 股价值投资者的证据优先 AI 研究台。产品围绕连续研究对话、公司画像、判断快照和可自动核对的证伪条件展开，不提供买卖指令，也不会用未经核实的数字填补数据缺口。

## 架构

```text
apps/
  web       React 19 + Vite + TanStack Query/Router，PWA 与 SSE 研究对话
  api       Hono + tRPC，无状态 HTTP/API 服务
  worker    Temporal workflows、周期任务与一手披露管道
packages/
  application  研究用例编排
  contracts    zod 契约与 OpenAPI
  data-plane   行情、基本面、公告与日历适配器
  db           Drizzle + PostgreSQL、NUMERIC、双时态数据与强制 RLS
  domain       零框架依赖的研究规则、答案与报告编排
  ui           品牌 tokens、组件与页面样式
crates/
  finance-core 十进制定点金融数值内核
tests/
  e2e          跨 React/PWA、Hono 与 PostgreSQL 的核心用户链路
infra/
  terraform    蓝绿服务、托管 PostgreSQL、观测与告警 IaC
scripts/
  document-processing  披露文档处理工具
  quality              仓库质量与旧底盘禁入检查
docs/          产品计划、发布门禁与架构说明
```

仓库只有这一套运行架构。API 的非流式操作通过 tRPC，研究流通过 Hono 原生 SSE；后台研究、公告入库、业绩核对、摘要、证伪和备份均由 Temporal 执行。

## 本地运行

要求 Node.js、Rust、PostgreSQL 与可用的 Temporal 服务。

```bash
npm install
export DATABASE_URL=postgresql:///echo_dev
npm run db:migrate
npm run dev
npm run worker
```

Web 默认地址为 `http://127.0.0.1:5173`，API 默认地址为 `http://127.0.0.1:3000`。Temporal 地址可通过 `TEMPORAL_ADDRESS` 配置。

## 验收

```bash
export DATABASE_URL=postgresql:///echo_dev
npm run lint
npm run typecheck
npm run lint:rust
npm test
npm run test:e2e
npm run build --workspace @echo/web
npm run db:recovery-drill
```

测试体系由领域单测、PostgreSQL/RLS 集成测试、唯一 API 契约测试、Temporal 可重放测试和 Playwright 核心链路组成。恢复演练会创建隔离数据库，执行真实备份与恢复，核对关键表行数和强制 RLS 后自动销毁演练库。

## 环境变量

核心变量：

```text
DATABASE_URL=
SESSION_SECRET=
TEMPORAL_ADDRESS=127.0.0.1:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=echo-research
OTEL_EXPORTER_OTLP_ENDPOINT=
```

模型和数据供应商密钥均只允许存在于服务端环境。缺少外部数据时，产品明确显示“未核到”，不生成替代数字。商用环境只允许选择授权元数据标记为可商用的适配器。

## 文档

- [产品计划与验收底账](docs/PLAN.md)
- [文档导航](docs/README.md)
- [仓库目录与代码归属](docs/architecture/repository-layout.md)
