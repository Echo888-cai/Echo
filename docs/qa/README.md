# Rust QA 门禁

当前质量门禁全部由 Cargo 驱动，不依赖外部脚本运行时：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check -p echo-web --target wasm32-unknown-unknown
cargo xtask web
```

需要真实浏览器时，先启动 WebDriver、`echo-api` 与 Trunk，再运行：

```bash
cargo xtask e2e
```

`echo-e2e` 默认连接 `127.0.0.1:4444`，覆盖登录后的研究、观察、组合和设置页面导航以及一次研究提交。
