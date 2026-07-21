# System overview

浏览器加载 Leptos/WASM，工作区通过同源 `/api` 调用 axum。API 先做 cookie 会话鉴权，再把研究请求交给 `echo-application`；事实由请求体或 `echo-data`/`echo-db` 组成，估值和数字护栏只接受单一 ticker 的事实。

PostgreSQL 的私有表启用强制 RLS。每次仓储操作在事务内 `set_config('app.user_id', ..., true)`，同时 SQL 显式带 `user_id`，因此连接池复用不会泄露租户。

数据源选择先检查 `commercial_use_allowed`，再按质量等级和延迟排序。所有外部 Decimal 字段在质量门通过后才写入 `market_snapshots`。三次连续失败会打开五分钟进程内熔断；缺数保持 `None`，不使用陈旧占位价。

Worker 从 `scheduler_state` 恢复上次游标。九个 cron 活动分别执行行情刷新、组合快照、摘要、证伪、业绩、仓位告警、复盘提醒和备份，结果只会记为 `ok` 或带错误详情的 `error`。

部署时 API 与 Worker 使用各自 Rust release binary，Web 使用 Trunk 构建静态 WASM。数据库迁移由 `cargo xtask migrate` 串行执行并校验 SHA-256。
