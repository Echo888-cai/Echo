# 文档导航

- [RUST_REFACTOR_HANDOFF.md](RUST_REFACTOR_HANDOFF.md)：Rust-only 合并后的真实完成度、缺口、续作顺序和最终验收定义；交接给其他 AI 时先读这一份。
- [rust-parity-matrix.md](rust-parity-matrix.md)：旧能力 → Rust 落点的功能平价底账（未决定项不得标完成）。
- [PLAN.md](PLAN.md)：结构迁移 vs 功能平价口径、验收门禁与续作入口。
- [architecture/repository-layout.md](architecture/repository-layout.md)：crate 归属与新增代码规则。
- [architecture/system-overview.md](architecture/system-overview.md)：运行时拓扑、数据质量和租户边界。
- [architecture/conversation-research-engine.md](architecture/conversation-research-engine.md)：研究回答的意图、估值和事实护栏。
- [ui-design-system.md](ui-design-system.md)：Echo Editorial 视觉令牌、组件状态、动效与可访问性规范。
- [hk-financial-ingest.md](hk-financial-ingest.md)：HKEX 来源校验、金额单位归一化与安全写入命令。
- [qa/README.md](qa/README.md)：Cargo 与 Rust WebDriver 验收门禁、离线 QA 语料。

文档只描述当前架构；退役的 Node/Python/React 实现不再作为有效运行路径维护。功能是否平价以平价矩阵为准，不以“能编译”代替。
