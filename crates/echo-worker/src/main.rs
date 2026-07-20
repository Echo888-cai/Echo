//! 后台工作流 worker——绞杀 Temporal。
//!
//! 承接两类既有巡检：业绩复盘（刷新 earnings_calendar 已报告字段）与证伪巡检（对 watch_rules
//! 逐条核对基本面/价格线），外加行情刷新/组合快照/摘要推送/备份等共 9 个 cron 作业。
//!
//! 本轮立**可恢复的调度骨架**：每分钟一跳，从 `scheduler_state` 拉回各作业 last_run 重建到期表，
//! 用 [`schedule::due_now`] 纯函数挑出到期作业，派发后把运行结果 upsert 回 `scheduler_state`——
//! 重启后错过的作业照样补跑（恢复门禁，记忆：Temporal 恢复测试）。作业**活动体**待随 echo-application
//! 编排逐个搬入；在此之前派发只落一条 `ok` 运行记录并记日志，不静默假装跑了实活。

mod schedule;

use std::collections::HashMap;
use std::time::Duration;

use echo_db::{Pool, SchedulerStateRepository};
use schedule::{JobKind, Schedule, due_now};

/// 从 `scheduler_state` 拉回 (job_id → last_run_at)，重建到期判定所需的历史表。
async fn load_last_runs(pool: &Pool) -> HashMap<String, chrono::DateTime<chrono::Utc>> {
    match SchedulerStateRepository::new(pool).all().await {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|r| r.last_run_at.map(|t| (r.job_id, t)))
            .collect(),
        Err(err) => {
            eprintln!("echo-worker: 读 scheduler_state 失败，本跳按空历史处理：{err}");
            HashMap::new()
        }
    }
}

/// 派发一个到期作业。活动体待接：现在只记日志 + 落 `ok` 运行记录（占位状态明确写出，不假装跑了实活）。
async fn dispatch(pool: &Pool, schedule: &Schedule) {
    let detail = match schedule.job {
        JobKind::PremarketDigest | JobKind::AfterhoursDigest => "digest 活动体待接",
        JobKind::MarketRefresh => "行情刷新活动体待接",
        JobKind::PortfolioSnapshot => "组合快照活动体待接",
        JobKind::FalsifierCheck => "证伪巡检活动体待接",
        JobKind::EarningsReview => "业绩复盘活动体待接",
        JobKind::PositionAlert => "仓位告警活动体待接",
        JobKind::ReviewReminder => "复盘提醒活动体待接",
        JobKind::PostgresBackup => "备份活动体待接",
    };
    println!("echo-worker: 派发 {} —— {detail}", schedule.id);
    if let Err(err) = SchedulerStateRepository::new(pool)
        .record_run(schedule.id, "ok", Some(detail))
        .await
    {
        eprintln!("echo-worker: 记 {} 运行状态失败：{err}", schedule.id);
    }
}

/// 跑一跳：重建历史 → 挑到期 → 逐个派发。抽出来便于将来做单跳集成测试。
async fn tick(pool: &Pool, now: chrono::DateTime<chrono::Utc>) {
    let last_runs = load_last_runs(pool).await;
    let due = due_now(now, |id| last_runs.get(id).copied());
    for schedule in due {
        dispatch(pool, schedule).await;
    }
}

#[tokio::main]
async fn main() {
    // 调度必须有可恢复的状态底座：没配 DATABASE_URL 就硬失败——宁可启动即报，也不跑一个状态不落库、
    // 重启即丢的假调度器（那正是「写好了没人调」类隐形失效）。
    let url = std::env::var("DATABASE_URL")
        .expect("echo-worker 需要 DATABASE_URL 才能持久化调度状态（可恢复门禁）");
    let pool = echo_db::connect(&url, 5)
        .await
        .expect("connect DATABASE_URL");
    println!(
        "echo-worker started (rust) — {} 个 cron 作业，每分钟一跳；活动体随 echo-application 接入",
        schedule::SCHEDULES.len()
    );

    let mut ticker = tokio::time::interval(Duration::from_secs(60));
    loop {
        ticker.tick().await;
        tick(&pool, chrono::Utc::now()).await;
    }
}
