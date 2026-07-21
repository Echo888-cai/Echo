# Echo Research · Rust 单栈计划与验收底账

## 目标

最终仓库只保留 Cargo 工程：Leptos/WASM、axum、Rust application/domain、sqlx/PostgreSQL、Rust worker、定点金融内核和 Rust WebDriver 验收。产品核心是证据优先研究，不提供交易指令。

## 当前完成度

| 区域 | Rust 落点 | 状态 |
| --- | --- | --- |
| 金融算术 | `finance-core` | 完成：Decimal 金额、比率、盈亏、收益惊喜、估值不变量 |
| 意图/估值/护栏 | `echo-domain` | 完成：中英意图、阶段感知估值、事实注册表、硬/软护栏 |
| 研究编排 | `echo-application` | 完成：事实映射、提示词、DeepSeek/OpenAI 兼容网关、流式 SSE、审计 |
| HTTP/API | `echo-api` | 完成：cookie 会话、邀请注册、研究、SSE、搜索、自选、持仓、偏好、通知、研究历史 |
| 数据库 | `echo-db` | 完成：编译迁移、NUMERIC、强制 RLS、workspace 仓储、通知咽喉、调度游标 |
| 外部数据 | `echo-data` | 完成：美/港市场识别、授权路由、Finnhub→Yahoo、质量门、熔断、行情写回 |
| 后台 | `echo-worker` | 完成：9 个可恢复活动，真实执行并记录 ok/error |
| Web | `echo-web` | 完成：研究对话、登录/注册、自选、持仓、设置、通知，WASM/Trunk 构建 |
| 浏览器验收 | `echo-e2e` | 完成：Rust WebDriver 核心流程，需外部驱动时运行 ignored test |

## 不变量

1. 单公司边界：研究请求中的 ticker 是唯一事实身份。
2. 缺数断口：`None` 代表未核到，永远不回填陈旧/跨公司/零值。
3. Decimal 边界：金融计算不转 `f64`；JSON 和 UI 只在展示处格式化。
4. 租户隔离：RLS + 显式用户条件 + 事务级 `set_config`。
5. 通知策略：偏好、免打扰、去重在 `NotificationsRepository::insert` 唯一咽喉生效。
6. 供应商合规：商用模式排除没有明确商业授权的数据源。
7. 可恢复调度：`scheduler_state` 的 last_run 是唯一恢复游标；活动失败不得记成功。

## 发布门禁

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check -p echo-web --target wasm32-unknown-unknown
cargo xtask web
cargo xtask migrate   # 预生产/生产，显式 DATABASE_URL
cargo xtask e2e       # API、Trunk、WebDriver 已启动时
```

## 后续增强（不改变单栈边界）

- 接入已签署商业协议的行情/财报适配器，并补充真实供应商 canary。
- 将更多一手公告/港交所披露解析接入 `echo-data`，保持 bitemporal 与来源 URL。
- 为研究历史增加报告导出与画像编辑页面；服务端能力已由 workspace 表承接。
- 在预生产跑 RLS 双租户、备份恢复、外部源故障和 Worker 重启联合演练。
