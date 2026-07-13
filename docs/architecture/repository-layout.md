# 仓库目录与代码归属

```text
Echo/
├── apps/                 可部署应用
│   ├── api/              Hono + tRPC + SSE
│   ├── web/              React/PWA
│   └── worker/           Temporal worker 与 schedules
├── packages/             可复用 TypeScript/JavaScript 包
│   ├── application/      跨领域用例编排
│   ├── contracts/        zod/API 契约单一源
│   ├── data-plane/       授权感知的数据供应商适配器
│   ├── db/               Drizzle、PostgreSQL、迁移与 repositories
│   ├── domain/           无 IO 的纯领域规则和报告编排
│   ├── finance-native/   Rust 金融内核的 Node 绑定
│   ├── observability/    OTel 与运行观测
│   └── ui/               共享品牌 tokens 与组件
├── crates/               独立 Rust crates
├── tests/e2e/            跨应用核心用户链路
├── infra/terraform/      生产基础设施定义
├── scripts/              文档处理与仓库质量工具
├── docs/                 当前计划与架构文档
└── .github/              CI、代码所有者与 PR 模板
```

## 归属规则

- 业务判断、估值、证伪、factGuard、答案和报告内容进入 `packages/domain`，不得访问网络、数据库或环境变量。
- 多步骤研究用例进入 `packages/application`；API 和 worker 复用同一用例，不复制业务分支。
- HTTP、cookie、CSRF、限速、tRPC 和 SSE 只进入 `apps/api`。
- 数据访问只通过 `packages/db` 的 Drizzle repositories；不得新增文件数据库或旁路 SQL 客户端。
- 长任务、重试、定时任务和恢复语义只进入 `apps/worker` 的 Temporal workflow/activity。
- 页面与 PWA 行为进入 `apps/web`，跨页面视觉资产进入 `packages/ui`。
- 供应商接入进入 `packages/data-plane`，必须声明授权范围、来源与降级行为。
- 跨应用 E2E 放在 `tests/e2e`；包级测试贴近包源码或包内 `test` 目录。

## 仓库卫生

- 不提交 `.env`、密钥、数据库文件、备份、日志、缓存、构建输出、平台原生二进制或 Terraform provider。
- 根目录只保留工作区配置、锁文件和项目入口文档；新文档进入 `docs`，辅助程序按用途进入 `scripts` 子目录。
- 删除功能时同时删除入口、实现、测试、配置和文档，不保留“可能以后用”的第二套底盘。
- 目录变更必须同步更新 README、测试配置、CI 和本文件。
