# Echo Research 开发约束

- 唯一计划与架构底账是 `docs/PLAN.md`，不另建平行计划或重复实现。
- 运行架构只有 React/PWA、Hono+tRPC、Temporal、Drizzle/PostgreSQL 和 Rust 金融内核。
- 领域规则只能进入 `packages/domain`，用例编排只能进入 `packages/application`。
- 金额、股数、比率与估值使用 PostgreSQL `NUMERIC` 和 Rust 十进制定点；展示边界之外不得新增浮点金融计算。
- 私有数据同时经过应用层租户过滤与 PostgreSQL 强制 RLS。
- 不提供买卖指令；数据缺失时明确说“未核到”；未获商用授权的数据源不可进入商用路由。
- 提交前必须通过 lint、全 workspace 类型检查、Rust fmt/clippy/test、领域与契约测试、Temporal 恢复测试、Playwright E2E、Web build 和数据库恢复演练。
