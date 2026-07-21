use chrono::{Datelike, Utc};
use echo_data::QuoteService;
use echo_db::{
    NewNotification, NotificationsRepository, OperationsRepository, Pool, PortfolioRepository,
};
use rust_decimal::Decimal;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

use crate::schedule::JobKind;

#[derive(Debug, thiserror::Error)]
pub enum ActivityError {
    #[error(transparent)]
    Database(#[from] echo_db::DbError),
    #[error(transparent)]
    Quote(#[from] echo_data::QuoteError),
    #[error("备份目录无效")]
    InvalidBackupDirectory,
    #[error("pg_dump 启动失败: {0}")]
    BackupIo(#[from] std::io::Error),
    #[error("pg_dump 超时")]
    BackupTimeout,
    #[error("pg_dump 失败: {0}")]
    BackupFailed(String),
}

pub struct Activities {
    pool: Pool,
    quotes: QuoteService,
    database_url: String,
    backup_dir: PathBuf,
}

impl Activities {
    pub fn new(
        pool: Pool,
        data_sources: echo_config::DataSourceConfig,
        database_url: String,
        backup_dir: String,
    ) -> Result<Self, ActivityError> {
        let backup_dir = PathBuf::from(backup_dir);
        if backup_dir.as_os_str().is_empty() || backup_dir == Path::new("/") {
            return Err(ActivityError::InvalidBackupDirectory);
        }
        Ok(Self {
            quotes: QuoteService::new(pool.clone(), data_sources)?,
            pool,
            database_url,
            backup_dir,
        })
    }

    pub async fn run(&self, job: JobKind) -> Result<String, ActivityError> {
        match job {
            JobKind::PremarketDigest => self.digest("premarket").await,
            JobKind::AfterhoursDigest => self.digest("afterhours").await,
            JobKind::MarketRefresh => self.refresh_market().await,
            JobKind::PortfolioSnapshot => self.capture_portfolios().await,
            JobKind::FalsifierCheck => self.check_falsifiers().await,
            JobKind::EarningsReview => self.review_earnings().await,
            JobKind::PositionAlert => self.check_positions().await,
            JobKind::ReviewReminder => self.review_reminders().await,
            JobKind::PostgresBackup => self.backup().await,
        }
    }

    async fn digest(&self, slot: &str) -> Result<String, ActivityError> {
        let operations = OperationsRepository::new(&self.pool);
        let users = operations.user_ids().await?;
        let mut emitted = 0usize;
        let date = Utc::now().date_naive();
        for user_id in &users {
            let rule_count = operations.active_rules(user_id).await?.len();
            let title = if slot == "premarket" {
                "盘前研究速报"
            } else {
                "盘后研究速报"
            };
            let body = format!("当前有 {rule_count} 条有效监控条件。");
            let key = format!("digest:{slot}:{date}");
            emitted += self
                .notify(
                    user_id,
                    &NewNotification {
                        kind: "event_digest",
                        title,
                        body: &body,
                        ticker: None,
                        payload: None,
                        dedupe_key: Some(&key),
                        dedupe_window_hours: 12,
                    },
                )
                .await? as usize;
        }
        Ok(format!("用户={}，推送={emitted}", users.len()))
    }

    async fn refresh_market(&self) -> Result<String, ActivityError> {
        let tickers = OperationsRepository::new(&self.pool)
            .tracked_tickers()
            .await?;
        let mut refreshed = 0usize;
        let mut failed = Vec::new();
        for ticker in &tickers {
            match self.quotes.refresh(ticker).await {
                Ok(result) if result.quote.price.is_some() => refreshed += 1,
                Ok(_) => failed.push(format!("{ticker}:missing")),
                Err(error) => failed.push(format!("{ticker}:{error}")),
            }
        }
        Ok(format!(
            "总数={}，刷新={refreshed}，失败={}{}",
            tickers.len(),
            failed.len(),
            if failed.is_empty() {
                String::new()
            } else {
                format!(" [{}]", failed.join(", "))
            }
        ))
    }

    async fn capture_portfolios(&self) -> Result<String, ActivityError> {
        let hkd_usd = self
            .quotes
            .refresh("HKDUSD=X")
            .await
            .ok()
            .and_then(|result| result.quote.price);
        let operations = OperationsRepository::new(&self.pool);
        let users = operations.user_ids().await?;
        let date = Utc::now().date_naive();
        let mut saved = 0usize;
        let mut gaps = 0usize;
        for user_id in &users {
            let result = operations
                .capture_portfolio_snapshot(user_id, date, hkd_usd)
                .await?;
            if result.position_count == 0 {
                continue;
            }
            if result.missing_price == 0 && result.missing_fx == 0 {
                saved += 1;
            } else {
                gaps += 1;
            }
        }
        Ok(format!("组合快照={saved}，因缺价/汇率跳过={gaps}"))
    }

    async fn check_falsifiers(&self) -> Result<String, ActivityError> {
        let operations = OperationsRepository::new(&self.pool);
        let users = operations.user_ids().await?;
        let mut checked = 0usize;
        let mut triggered = 0usize;
        for user_id in &users {
            for rule in operations.active_rules(user_id).await? {
                checked += 1;
                let current = if matches!(rule.kind.as_str(), "price_below" | "price_above") {
                    operations
                        .latest_market(&rule.ticker)
                        .await?
                        .and_then(|market| market.price)
                } else if matches!(
                    rule.kind.as_str(),
                    "fundamental_below" | "fundamental_above"
                ) {
                    match rule.metric.as_deref() {
                        Some(metric) => {
                            operations
                                .latest_fundamental_metric(&rule.ticker, metric)
                                .await?
                        }
                        None => None,
                    }
                } else {
                    None
                };
                let Some(current) = current else { continue };
                let hit = match rule.kind.as_str() {
                    "price_below" | "fundamental_below" => current <= rule.threshold,
                    "price_above" | "fundamental_above" => current >= rule.threshold,
                    _ => false,
                };
                if !hit {
                    continue;
                }
                let title = format!("{} 证伪条件触线", rule.ticker);
                let body = format!(
                    "{}（当前 {}，阈值 {}）",
                    rule.label.as_deref().unwrap_or("监控条件"),
                    current.normalize(),
                    rule.threshold.normalize()
                );
                let key = format!("falsifier:{}", rule.id);
                if self
                    .notify(
                        user_id,
                        &NewNotification {
                            kind: "falsify_alert",
                            title: &title,
                            body: &body,
                            ticker: Some(&rule.ticker),
                            payload: None,
                            dedupe_key: Some(&key),
                            dedupe_window_hours: 12,
                        },
                    )
                    .await?
                {
                    triggered += 1;
                }
                operations.mark_rule_triggered(user_id, rule.id).await?;
            }
        }
        Ok(format!("核对={checked}，触线={triggered}"))
    }

    async fn review_earnings(&self) -> Result<String, ActivityError> {
        let operations = OperationsRepository::new(&self.pool);
        let users = operations.user_ids().await?;
        let candidates = operations.earnings_candidates().await?;
        let mut emitted = 0usize;
        for candidate in &candidates {
            let summary = format!(
                "业绩事实已更新：EPS actual {}，estimate {}。",
                decimal_or_gap(candidate.last_eps_actual),
                decimal_or_gap(candidate.last_eps_estimate)
            );
            for user_id in &users {
                let Some(company_name) =
                    operations.profile_name(user_id, &candidate.ticker).await?
                else {
                    continue;
                };
                operations
                    .append_earnings_event(user_id, candidate, &summary)
                    .await?;
                let title = format!("{company_name} 业绩闭环");
                let key = format!(
                    "earnings:{}:{}",
                    candidate.ticker,
                    candidate.last_date.as_deref().unwrap_or("unknown")
                );
                emitted += self
                    .notify(
                        user_id,
                        &NewNotification {
                            kind: "earnings_review",
                            title: &title,
                            body: &summary,
                            ticker: Some(&candidate.ticker),
                            payload: None,
                            dedupe_key: Some(&key),
                            dedupe_window_hours: 12,
                        },
                    )
                    .await? as usize;
            }
        }
        Ok(format!("候选={}，闭环推送={emitted}", candidates.len()))
    }

    async fn check_positions(&self) -> Result<String, ActivityError> {
        let operations = OperationsRepository::new(&self.pool);
        let users = operations.user_ids().await?;
        let mut checked = 0usize;
        let mut alerts = 0usize;
        for user_id in &users {
            for position in PortfolioRepository::new(&self.pool).list(user_id).await? {
                checked += 1;
                let Some(price) = operations
                    .latest_market(&position.ticker)
                    .await?
                    .and_then(|market| market.price)
                else {
                    continue;
                };
                if position
                    .stop_loss
                    .is_some_and(|threshold| price <= threshold)
                {
                    let threshold = position.stop_loss.expect("checked some");
                    alerts += self
                        .position_notification(user_id, &position.ticker, "止损", price, threshold)
                        .await? as usize;
                }
                if position
                    .take_profit
                    .is_some_and(|threshold| price >= threshold)
                {
                    let threshold = position.take_profit.expect("checked some");
                    alerts += self
                        .position_notification(user_id, &position.ticker, "止盈", price, threshold)
                        .await? as usize;
                }
                if let Some(cost) = position.avg_cost.filter(|cost| !cost.is_zero()) {
                    let drawdown = (price - cost) / cost * Decimal::from(100);
                    if drawdown <= Decimal::from(-15) {
                        let title = format!("{} 大幅回撤", position.ticker);
                        let body = format!(
                            "现价 {}，成本 {}，回撤 {}%",
                            price.normalize(),
                            cost.normalize(),
                            drawdown.round_dp(1).normalize()
                        );
                        let bucket = (drawdown / Decimal::from(5)).floor() * Decimal::from(5);
                        let key = format!(
                            "position:drawdown:{}:{}",
                            position.ticker,
                            bucket.normalize()
                        );
                        alerts += self
                            .notify(
                                user_id,
                                &NewNotification {
                                    kind: "position_alert",
                                    title: &title,
                                    body: &body,
                                    ticker: Some(&position.ticker),
                                    payload: None,
                                    dedupe_key: Some(&key),
                                    dedupe_window_hours: 12,
                                },
                            )
                            .await? as usize;
                    }
                }
            }
        }
        Ok(format!("持仓={checked}，告警={alerts}"))
    }

    async fn position_notification(
        &self,
        user_id: &str,
        ticker: &str,
        label: &str,
        price: Decimal,
        threshold: Decimal,
    ) -> Result<bool, ActivityError> {
        let title = format!("{ticker} 触及{label}线");
        let body = format!(
            "现价 {}，{}线 {}",
            price.normalize(),
            label,
            threshold.normalize()
        );
        let key = format!("position:{label}:{ticker}");
        self.notify(
            user_id,
            &NewNotification {
                kind: "position_alert",
                title: &title,
                body: &body,
                ticker: Some(ticker),
                payload: None,
                dedupe_key: Some(&key),
                dedupe_window_hours: 12,
            },
        )
        .await
    }

    async fn review_reminders(&self) -> Result<String, ActivityError> {
        let operations = OperationsRepository::new(&self.pool);
        let users = operations.user_ids().await?;
        let now = Utc::now();
        let mut emitted = 0usize;
        for user_id in &users {
            for profile in operations.reminder_profiles(user_id).await? {
                let days = now.signed_duration_since(profile.updated_at).num_days();
                let company = profile.company_name.as_deref().unwrap_or(&profile.ticker);
                let title = format!("{company} 研究已 {days} 天未更新");
                let body = format!(
                    "上次更新于 {}，建议复盘当前判断是否仍然成立",
                    profile.updated_at.date_naive()
                );
                let key = format!(
                    "review:{}:{:04}-{:02}",
                    profile.ticker,
                    now.year(),
                    now.month()
                );
                emitted += self
                    .notify(
                        user_id,
                        &NewNotification {
                            kind: "review_reminder",
                            title: &title,
                            body: &body,
                            ticker: Some(&profile.ticker),
                            payload: None,
                            dedupe_key: Some(&key),
                            dedupe_window_hours: 168,
                        },
                    )
                    .await? as usize;
            }
        }
        Ok(format!("复盘提醒={emitted}"))
    }

    async fn backup(&self) -> Result<String, ActivityError> {
        tokio::fs::create_dir_all(&self.backup_dir).await?;
        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
        let path = self
            .backup_dir
            .join(format!("echo-scheduled-{timestamp}.dump"));
        let mut command = Command::new("pg_dump");
        command
            .arg("--format=custom")
            .arg("--file")
            .arg(&path)
            .arg(&self.database_url)
            .kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(600), command.output())
            .await
            .map_err(|_| ActivityError::BackupTimeout)??;
        if !output.status.success() {
            return Err(ActivityError::BackupFailed(
                String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(500)
                    .collect(),
            ));
        }
        Ok(format!("备份={}", path.display()))
    }

    async fn notify(
        &self,
        user_id: &str,
        notification: &NewNotification<'_>,
    ) -> Result<bool, ActivityError> {
        let inserted = NotificationsRepository::new(&self.pool)
            .insert(user_id, notification)
            .await?;
        Ok(inserted.is_some())
    }
}

fn decimal_or_gap(value: Option<Decimal>) -> String {
    value
        .map(|value| value.normalize().to_string())
        .unwrap_or_else(|| "未核到".into())
}
