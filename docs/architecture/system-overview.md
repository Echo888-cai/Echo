# 系统架构与部署总览

> 面向接手人的完整视图：运行时怎么连、部署拓扑长什么样、CI/CD 做了什么、日常怎么跑。目录归属规则见 [repository-layout.md](repository-layout.md)；产品目标、红线和路线图见 [../PLAN.md](../PLAN.md)。本文不重复那两份文档已经讲过的内容。

## 1. 运行时架构

```text
浏览器/PWA (React 19 + Vite)
   │  tRPC (非流式) / Hono 原生 SSE (研究流)
   ▼
Hono API (apps/api)  ── 鉴权、限流、REST+tRPC 路由共用同一业务函数
   │                 │
   │ Drizzle          └─ Temporal Client（触发/查询工作流）
   ▼
PostgreSQL 主库 ←── 同步 ──→ PostgreSQL 只读副本
   ▲
   │ Drizzle
Temporal Worker (apps/worker) ── 深度研究 / 披露入库 / 业绩复盘 / 摘要 / 证伪核对 / 备份

packages/domain       纯规则，无 IO
packages/application  用例编排，API 与 worker 共用，不复制业务分支
packages/contracts    zod 契约单一源（REST/tRPC/OpenAPI 共用）
packages/db           Drizzle schema、SQL 迁移、RLS、repositories
packages/data-plane   授权感知的行情/基本面/公告适配器
crates/finance-core    Rust 十进制金融内核，经 packages/finance-native 的 N-API 绑定暴露给 Node
```

请求路径只有 tRPC 和 Hono 原生 SSE 两种；后台一切多步骤工作（研究、入库、复盘、备份）都由 Temporal 承接，不存在另一套调度器。

## 2. 部署拓扑（`infra/terraform/`）

- **计算**：ECS Fargate 两个服务——`api`（蓝绿部署，CodeDeploy 金丝雀 10%/5 分钟）和 `worker`（滚动部署 + 部署熔断回滚）。两个服务都挂了 `aws_appautoscaling_target`/`policy`：`api` 按 ALB 每目标请求数（`ALBRequestCountPerTarget`，目标值 500）追踪，`worker` 按 CPU（目标 60%）追踪，`min/max` 由 `var.api_min_capacity` 等变量控制，默认 2→10（api）、2→8（worker）。`desired_count` 只是初始基线，`lifecycle.ignore_changes` 防止下次 `terraform apply` 把自动伸缩的结果打回去。
- **接入层**：ALB 前面挂了 `aws_wafv2_web_acl`，按 IP 做 5 分钟窗口的速率限制（`var.waf_rate_limit_per_5min`，默认 2000），作为应用层限流之外的第二道防线。
- **数据库**：一个 `db.r6g.large` 主实例（Multi-AZ、35 天备份保留、加密），一个只读副本（`aws_db_instance.read_replica`）供可容忍复制延迟的读查询使用，一个 RDS Proxy（`aws_db_proxy.main`）做连接池化，缓解 ECS 副本数增多时的连接数压力。三者的连接串都写进同一个 Secrets Manager secret（`DATABASE_URL` / `DATABASE_URL_READ` / `DATABASE_URL_PROXY`）。
- **备份**：S3 加密桶，版本化 + 生命周期（30 天转 IA，365 天过期）。
- **可观测性**：OTel → CloudWatch（`packages/observability`），API 5xx 和 P95 延迟（<3s 目标）告警，SLO 仪表盘覆盖可用性/延迟/数据库连接数/workflow 失败日志。

## 3. 限流设计（不引入 Redis）

`CLAUDE.md` 把运行架构锁定在五个组件，因此分布式限流没有走 Redis，而是分层处理（见 `apps/api/src/http.ts`）：

- **重路径**（`ask` / `report/generate` / `parse-document`，30 次/分钟）：写入 `rate_limit_buckets` 表（`packages/db/src/schema/misc.ts`），一条 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count` 原子完成读+判断+写，跨所有 API 副本共享同一个计数。这些端点可能产生真实的供应商调用成本，值得为精确计数花一次数据库往返。
- **普通路径**（300 次/分钟）：继续用进程内 `Map`，只是加了容量触顶后的惰性清理，避免内存无限增长。这是有意的近似——普通请求量大，精确到副本级别的代价划不来。
- **网络层**：AWS WAF 按 IP 做纵深防御，独立于应用层，配置在 Terraform 里。

## 4. 数据库连接模式

`packages/db/src/repositories/context.ts` 暴露两个入口：

- `database()`：主库连接，写入和强一致读取都走这里。
- `databaseRead()`：优先读 `DATABASE_URL_READ`（只读副本），未设置时自动退回主库连接串——本地开发和单实例部署不需要额外配置就能工作。目前只有 `getLatestMarketSnapshot`（`packages/db/src/repositories/companyRepository.ts`）接入了这个入口作为示例；其余仓库调用仍然走主库，按实际流量分布再逐个迁移，不做一次性全量切换。

## 5. CI/CD（`.github/workflows/ci.yml`）

单一 job，`ubuntu-latest`，起一个真实的 `postgres:16-alpine` 服务容器（`echo_ci` 库），按顺序跑：

1. `npm ci`
2. 安装 Rust 1.85.0（rustfmt + clippy）
3. `npm run lint`
4. `npm run check:retired`（扫描退役栈/文件数据库/密钥误提交）
5. `npm run lint:rust`（`cargo fmt --check` + `cargo clippy -D warnings`）
6. `npm run typecheck`（全 workspace）
7. `npm run migrate --workspace @echo/db`（对 CI 的真实 Postgres 迁移）
8. `npm test`（domain/db/api/worker/contracts/finance-native 的单测与集成测试 + `cargo test --workspace`）
9. `npm run build --workspace @echo/web`
10. `npm run db:recovery-drill`（隔离库恢复演练）
11. Playwright 安装 + `npm run test:e2e`

**没有** Temporal 服务容器——Temporal 相关测试走 `@temporalio/testing`（内存态可重放测试），不依赖真实 Temporal 集群。**没有**容量/负载测试步骤——那需要一个已部署的目标环境，见下一节。

## 6. 本地开发与运行手册

```bash
npm install
export DATABASE_URL=postgresql:///echo_dev
npm run db:migrate
npm run dev        # api + web
npm run worker      # Temporal worker（需要本地/远程 Temporal 服务）
```

环境变量全集见根 [README.md](../../README.md#环境变量)。密钥（数据库密码、Temporal API key、OTel headers）只存在于 Secrets Manager，ECS 任务通过 `secrets` 块注入，不写入镜像或环境变量明文。密钥轮换：更新 Secrets Manager 里的值后滚动重启 ECS 服务即可，数据库密码轮换需要先在 RDS 侧改密码、再更新 secret、再重启（顺序反过来会导致短暂连接失败）。

容量/负载测试工具：

```bash
npm run test:load -- --url https://<环境地址> --concurrency 20 --duration 30 --path /healthz --path /api/companies/search?q=tencent
```

对齐 CloudWatch 的 P95 < 3s 告警阈值（`--p95-budget-ms` 默认 3000）；错误率超过 1% 或 P95 超预算时非零退出，可以接入发布前的手动或半自动检查，但目前不是阻塞式 CI 门禁的一部分，因为本地/CI 里没有已部署的目标环境可打。

## 7. 已知边界与下一步

- 只读副本和 RDS Proxy 目前只在 Terraform 里声明，仅 `getLatestMarketSnapshot` 一个调用点接入 `databaseRead()`；其余读密集查询要不要搬，按真实流量分布决定。
- 自动伸缩的目标值（请求数 500、CPU 60%）是保守起点，需要一次真实压测（`npm run test:load`）后按实际单请求耗时/资源占用调参。
- WAF 速率阈值和应用层限流阈值都是起点数字，同样需要用真实流量校准，而不是想当然。
- 真正的生产容量数字（多少并发用户、多少 QPS、扩容延迟多久生效）必须在预生产环境跑一次 `npm run test:load` + 手动流量爬坡才能拿到——这是本文写作时无法在本地沙箱里验证的部分，见 [../PLAN.md](../PLAN.md) 第 5 节外部依赖清单的退出指标。
