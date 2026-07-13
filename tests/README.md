# Tests

跨应用的端到端测试统一放在 `tests/e2e`。包内单元测试、契约测试和数据库集成测试继续贴近对应源码，便于维护领域边界和测试夹具。

- `tests/e2e`：React/PWA、Hono API 与 PostgreSQL 的核心用户链路。
- `packages/*/test` 或 `*.test.*`：包级单元、架构和集成测试。
- `packages/contracts/src/contract-tests`：唯一 API 契约测试。

从仓库根目录执行 `npm test` 运行包级测试，执行 `npm run test:e2e` 运行跨应用端到端测试。
