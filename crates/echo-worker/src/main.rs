//! 后台工作流 worker（骨架）——绞杀 Temporal。
//!
//! 承接两类既有巡检：业绩复盘（刷新 earnings_calendar 已报告字段）与证伪巡检
//! （对 watch_rules 逐条核对基本面/价格线）。迁移期先保留一个可恢复的调度骨架，
//! 具体活动随 `echo-db` 仓储接入后逐个搬入——恢复测试（记忆：Temporal 恢复测试）是接入门禁。

#[tokio::main]
async fn main() {
    println!("echo-worker started (rust) — 工作流活动待随 echo-db 接入");
    // 调度骨架：真实实现会从 echo-db 拉取到期规则并派发活动。
}
