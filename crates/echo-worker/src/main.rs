//! 后台工作流 worker——Rust cron 调度与可恢复活动执行器。
//!
//! 承接两类既有巡检：业绩复盘（刷新 earnings_calendar 已报告字段）与证伪巡检（对 watch_rules
//! 逐条核对基本面/价格线），外加行情刷新/组合快照/摘要推送/备份等共 9 个 cron 作业。
//!
//! 每分钟一跳，从 `scheduler_state` 拉回各作业 last_run 重建到期表，
//! 用 [`schedule::due_now`] 纯函数挑出到期作业，派发后把运行结果 upsert 回 `scheduler_state`——
//! 重启后错过的作业照样补跑。活动执行结果写回调度状态，失败会保留错误信息供下一轮重试。

mod activities;
mod schedule;

use std::collections::HashMap;
use std::time::Duration;

use activities::Activities;
use echo_config::WorkerConfig;
use echo_db::{Pool, SchedulerStateRepository};
use schedule::{Schedule, due_now};
use tracing::{error, info};

/// 从 `scheduler_state` 拉回 (job_id → last_run_at)，重建到期判定所需的历史表。
async fn load_last_runs(pool: &Pool) -> HashMap<String, chrono::DateTime<chrono::Utc>> {
    match SchedulerStateRepository::new(pool).all().await {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|r| r.last_run_at.map(|t| (r.job_id, t)))
            .collect(),
        Err(err) => {
            error!(error = %err, "读取 scheduler_state 失败，本跳按空历史处理");
            HashMap::new()
        }
    }
}

/// 派发一个到期作业，实际成功才记 `ok`；失败详情进入可恢复游标供运营排查。
async fn dispatch(pool: &Pool, activities: &Activities, schedule: &Schedule) {
    let (status, detail) = match activities.run(schedule.job).await {
        Ok(detail) => {
            info!(job_id = schedule.id, detail, "后台活动完成");
            ("ok", detail)
        }
        Err(err) => {
            error!(job_id = schedule.id, error = %err, "后台活动失败");
            ("error", err.to_string())
        }
    };
    if let Err(err) = SchedulerStateRepository::new(pool)
        .record_run(schedule.id, status, Some(&detail))
        .await
    {
        error!(job_id = schedule.id, error = %err, "记录运行状态失败");
    }
}

/// 跑一跳：重建历史 → 挑到期 → 逐个派发。抽出来便于将来做单跳集成测试。
async fn tick(pool: &Pool, activities: &Activities, now: chrono::DateTime<chrono::Utc>) {
    let last_runs = load_last_runs(pool).await;
    let due = due_now(now, |id| last_runs.get(id).copied());
    for schedule in due {
        dispatch(pool, activities, schedule).await;
    }
}

#[tokio::main]
async fn main() {
    echo_observability::init("echo-worker").expect("init tracing");
    let config = WorkerConfig::from_env().expect("load echo-worker config");
    // 调度必须有可恢复的状态底座：没配 DATABASE_URL 就硬失败——宁可启动即报，也不跑一个状态不落库、
    // 重启即丢的假调度器（那正是「写好了没人调」类隐形失效）。
    let pool = echo_db::connect(&config.database_url, config.max_connections)
        .await
        .expect("connect DATABASE_URL");
    let state = SchedulerStateRepository::new(&pool);
    for job in schedule::SCHEDULES {
        state.register_job(job.id).await.expect("register cron job");
    }
    let activities = Activities::new(
        pool.clone(),
        config.data_sources,
        config.database_url,
        config.backup_dir,
    )
    .expect("build worker activities");
    info!(
        jobs = schedule::SCHEDULES.len(),
        tick_seconds = config.tick_seconds,
        "echo-worker started; 9 个活动均由 Rust 执行"
    );

    let mut ticker = tokio::time::interval(Duration::from_secs(config.tick_seconds));
    loop {
        ticker.tick().await;
        tick(&pool, &activities, chrono::Utc::now()).await;
    }
}
