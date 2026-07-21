# Echo Research 开发约束

- Cargo 是唯一工程入口；禁止新增 Node、Python、手写 TypeScript/JavaScript 业务实现。
- `docs/PLAN.md` 是唯一计划与架构底账。
- `echo-domain` 只放纯规则，`echo-application` 只做用例，`echo-db` 是唯一数据库入口，`echo-data` 是唯一外部供应商入口，`echo-api`/`echo-worker` 只做边界与调度，`echo-web` 只放 Leptos/WASM UI。
- 所有金额、股数、比率、估值使用 PostgreSQL NUMERIC 与 `rust_decimal::Decimal`；缺失数据用 `Option` 表示，禁止 0 占位或跨公司混数。
- 私有仓储必须同时经过应用层用户过滤和 PostgreSQL 强制 RLS；通知必须经过偏好、免打扰和去重咽喉。
- 商用模式只允许授权元数据明确允许商用的数据源。
- 交付前通过 `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`、WASM check、Trunk build；有 WebDriver 时再运行 `cargo xtask e2e`。
