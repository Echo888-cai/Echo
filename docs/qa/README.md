# Rust QA 门禁

当前质量门禁全部由 Cargo 驱动，不依赖外部脚本运行时：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check -p echo-web --target wasm32-unknown-unknown
cargo xtask web
```

## 离线研究语料（Phase 0 恢复）

迁移前 `scripts/quality/agent-qa/corpus.ts`（275 条）与 `live.ts`（15 条）已恢复为语言中立 fixture：

- `docs/qa/fixtures/intent-routing-corpus.json`
- `docs/qa/fixtures/live-research-probes.json`
- `docs/qa/fixtures/agent-qa-baseline.historical.json`
- `docs/qa/fixtures/migration-checksums.json`（`0001`–`0010` 冻结）
- `docs/qa/fixtures/api-json-snapshots.json`

跑意图路由回归（不允许静默删 case）：

```bash
cargo test -p echo-domain --test intent_routing_corpus
```

当前 runner 断言 `intent`；ticker / discovery / dual-listing 等字段记为 deferred，待公司身份端口迁入 domain 后启用。Live probes 仅作目录，声明式全链路门禁在后续阶段接入。

能力平价状态见 [../rust-parity-matrix.md](../rust-parity-matrix.md)。

## 浏览器 E2E

需要真实浏览器时，先启动 WebDriver、`echo-api` 与 Trunk，再运行：

```bash
cargo xtask e2e
```

`echo-e2e` 默认连接 `127.0.0.1:4444`，覆盖登录后的研究、观察、组合和设置页面导航以及一次研究提交。
