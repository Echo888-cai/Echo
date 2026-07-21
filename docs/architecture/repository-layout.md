# Repository layout

```text
crates/
  finance-core/       Decimal 金融内核
  echo-contracts/     serde 请求/响应契约
  echo-config/        环境配置边界
  echo-observability/ tracing 初始化
  echo-domain/         纯研究规则
  echo-application/    用例与模型网关
  echo-db/             sqlx 仓储、RLS、迁移
  echo-data/           供应商路由、质量门、行情写入
  echo-api/            axum HTTP/SSE
  echo-worker/         可恢复 cron 活动
  echo-web/            Leptos/WASM
  echo-e2e/             Rust WebDriver 验收
migrations/             编译进 echo-db 的 PostgreSQL SQL
```

依赖只能向下：domain 不碰 IO；application 组织用例；db 是唯一持久化入口；data 是唯一外部行情入口；api 和 worker 复用 application/domain，不复制数字逻辑。金额、股数、比率必须是 `rust_decimal::Decimal`，不能在展示边界之外使用二进制浮点。
