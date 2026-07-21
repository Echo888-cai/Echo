# Echo Research

Echo 是面向美股与港股的证据优先研究台。研究问题、定点估值、数字护栏、公司判断、证伪线、通知和组合成本都在同一条 Rust 事实链上；缺失数据明确显示“未核到”，不提供买卖指令。

## 唯一运行栈

```text
Leptos/WASM  →  axum HTTP/SSE  →  echo-application/domain
                                      ↓
                              sqlx + PostgreSQL/RLS
                                      ↓
                         echo-data 外部供应商路由
                         echo-worker 可恢复后台活动
```

工程入口只有 Cargo。`echo-finance-core` 和 `rust_decimal` 负责金额、股数、比率与估值；`echo-data` 在供应商授权、质量门和熔断之后才允许行情进入数据库；私有仓储同时使用应用层用户过滤和 PostgreSQL 强制 RLS。

## 本地运行

需要 Rust 1.85、Trunk（WASM 前端）和 PostgreSQL。未配置 `DATABASE_URL` 时 API 仍可运行纯核研究路径，持仓、自选、通知和研究历史会诚实返回 PostgreSQL 不可用。

```bash
cp .env.example .env
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/echo_dev
cargo xtask migrate

# 终端一：API
cargo run -p echo-api

# 终端二：Leptos/WASM（/api 自动代理到 4180）
cargo xtask web

# 终端三：可恢复后台活动
cargo run -p echo-worker
```

首个 owner：

```bash
ECHO_BOOTSTRAP_EMAIL=owner@example.com \
ECHO_BOOTSTRAP_PASSWORD='use-a-long-password' \
cargo xtask bootstrap-owner
```

默认地址：Web `http://127.0.0.1:5191`，API `http://127.0.0.1:4180`。

## 验收门禁

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check -p echo-web --target wasm32-unknown-unknown
cargo xtask web

# 已启动 API、Trunk 和 chromedriver/geckodriver 后：
cargo xtask e2e
```

浏览器验收位于 `crates/echo-e2e`，使用 Rust WebDriver 客户端检查真实研究、 自选、持仓和设置交互；没有浏览器驱动时它不会阻塞普通单测。

## 外部数据与配置

Finnhub（美股，有 key 时优先）→ Yahoo Chart（美/港研究源）是实时行情降级链。免费源标记为不可商用，`ECHO_COMMERCIAL_MODE=1` 时会被整个路由排除，绝不会悄悄兜底。模型、行情、Tavily 密钥只在服务端环境读取。

完整变量见 [.env.example](.env.example)。

## 目录

- `crates/echo-domain`：纯意图、估值、财务衍生与数字护栏。
- `crates/echo-application`：研究提示词、模型网关和应用编排。
- `crates/echo-api`：axum 鉴权、研究、工作区和 SSE 边界。
- `crates/echo-db`：sqlx 仓储、迁移、RLS、通知咽喉与调度状态。
- `crates/echo-data`：授权感知数据源、质量门、熔断和行情写入。
- `crates/echo-worker`：九类可恢复后台活动。
- `crates/echo-web`：Leptos/WASM 工作区。
- `crates/echo-e2e`：Rust WebDriver 验收。
- `migrations`：编译进 `echo-db` 的 PostgreSQL 迁移正文。
