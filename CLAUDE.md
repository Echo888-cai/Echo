# Echo Research 开发约束

- 唯一计划与架构底账是 `docs/PLAN.md`，不另建平行计划或重复实现。
- **目标运行架构是全栈 Rust**：Leptos/WASM 前端、axum(HTTP/SSE) 边界、Rust 用例编排、
  Rust 后台工作流、sqlx/PostgreSQL 与 Rust 金融定点内核。正在从 React/PWA + Hono/tRPC +
  Temporal + Drizzle 绞杀式(strangler)迁移——旧 TS 栈在对应 Rust crate 达到平价前继续供能，
  达到平价后即摘除；迁移进度以 `crates/echo-domain/src/lib.rs` 顶部账本与 `docs/PLAN.md` 为准。
- crate 分层：`crates/echo-domain` 只放纯领域规则(估值/护栏/意图/财务衍生，不碰时钟/IO)，
  `crates/echo-application` 只放用例编排，`crates/echo-api` 只放 HTTP/SSE 边界，
  `crates/echo-db` 只放持久化与 RLS，`crates/echo-web` 只放前端。迁移期尚存的 TS 对应目录
  (`packages/domain`、`packages/application` 等)同规则约束，且新增领域逻辑一律进 Rust crate，
  不再往 JS 侧加。
- 金额、股数、比率与估值使用 PostgreSQL `NUMERIC` 和 Rust 十进制定点(`rust_decimal`)；
  展示边界之外不得新增浮点金融计算。TS 侧若仍需这类计算，必须经 `@echo/finance-native`(NAPI)
  调 Rust 内核，不得在 JS 里用二进制浮点重算。
- 私有数据同时经过应用层租户过滤与 PostgreSQL 强制 RLS。
- 不提供买卖指令；数据缺失时明确说“未核到”；未获商用授权的数据源不可进入商用路由。
- 提交前必须通过 lint、全 workspace 类型检查、Rust fmt/clippy/test、领域与契约测试、
  工作流恢复测试、Playwright/端到端测试、Web build 和数据库恢复演练。
