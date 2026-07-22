//! 持久化与租户 RLS（PostgreSQL / sqlx）。
//!
//! 规则：金额/股数/比率一律 `NUMERIC` ↔ `rust_decimal::Decimal`（红线 4）；双时态表保留
//! valid_time（业务时间）与 knowledge_time（系统时间）。私有数据同时经**应用层租户过滤**
//! 与 **PostgreSQL 强制 RLS**——RLS 通过在事务内 `SET LOCAL app.user_id` 注入当前租户，
//! 见 [`with_tenant`]。公共参考数据（companies / market_snapshots）不分租户，直接读。
//!
//! 本阶段接通研究链路最先需要的两张表（company 身份、market 快照）。sqlx 用**运行期查询**，
//! 离线可编译；平价切流前换成编译期校验的 `query!` 宏（需活库/`.sqlx` 缓存）。

use rust_decimal::Decimal;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::{FromRow, Postgres, Transaction};

mod migrations;
mod repositories;
pub use migrations::{Migration, migrate, migration_checksum, migrations};
pub use repositories::{
    AuthRepository, AuthSessionRow, CompanyProfileRepository, CompanyProfileRow,
    CompanyProfileSummaryRow, CompanyProfileUpsert, CompanySearchRow, EarningsCandidateRow,
    NewNotification, NewUser, NotificationRow, NotificationsRepository, OperationsRepository,
    PortfolioPositionRow, PortfolioRepository, PortfolioSnapshotResult, PortfolioUpsert,
    PreferencesPatch, PreferencesRepository, RateLimitRepository, ReminderProfileRow,
    ResearchSessionRepository, ResearchSessionRow, ResearchSessionSummaryRow, SaveResearchSession,
    UserPreferencesRow, UserRow, WatchEntryRow, WatchRuleRow, WatchlistRepository,
    normalize_ticker,
};

// 连接池类型对上层再导出，让 echo-api 等消费方不必直接钉 sqlx 版本（工作区单一事实源在此收口）。
pub use sqlx::postgres::PgPool as Pool;

/// 数据层错误——薄封装 sqlx，避免上层直接耦合驱动。
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("已应用迁移内容发生变化: {0}")]
    ChangedMigration(String),
    #[error("租户资源冲突: {0}")]
    TenantConflict(String),
}

impl DbError {
    #[must_use]
    pub fn is_row_not_found(&self) -> bool {
        matches!(self, Self::Sqlx(sqlx::Error::RowNotFound))
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

/// 建连接池。`SET LOCAL app.user_id` 依赖会话，连接池按需复用连接，因此租户注入必须在
/// **事务内** 用 `SET LOCAL`（连接归还后自动失效），不能设在连接级——否则复用到别的租户。
pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// 就绪探针用：确认连接池能真正打到数据库，而非只是"配置存在"。
pub async fn ping(pool: &PgPool) -> Result<()> {
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(())
}

/// 在一个带租户上下文的事务里执行私有数据操作：`SET LOCAL app.user_id = $tenant`，
/// 之后该事务里所有查询都受 RLS 策略约束（策略读 `current_setting('app.user_id')`）。
/// 返回已开好且已注入租户的事务，调用方跑完自己的查询后 commit。
pub async fn with_tenant<'a>(pool: &'a PgPool, user_id: &str) -> Result<Transaction<'a, Postgres>> {
    let mut tx = pool.begin().await?;
    // 参数化设置：SET LOCAL 不接绑定参数，用 set_config(name, value, is_local=true) 等价且防注入。
    sqlx::query("SELECT set_config('app.user_id', $1, true)")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

/// 公司身份行（`companies` 表）。
#[derive(Debug, Clone, FromRow)]
pub struct CompanyRow {
    pub ticker: String,
    #[sqlx(rename = "name_zh")]
    pub name_zh: String,
    #[sqlx(rename = "name_en")]
    pub name_en: Option<String>,
    pub sector: Option<String>,
    pub industry: Option<String>,
    pub exchange: String,
    pub currency: String,
    #[sqlx(rename = "listing_status")]
    pub listing_status: String,
}

/// 行情快照行（`market_snapshots` 表，NUMERIC → Decimal）。
#[derive(Debug, Clone, FromRow)]
pub struct MarketRow {
    pub ticker: String,
    pub price: Option<Decimal>,
    #[sqlx(rename = "change_percent")]
    pub change_percent: Option<Decimal>,
    #[sqlx(rename = "market_cap")]
    pub market_cap: Option<Decimal>,
    pub pe: Option<Decimal>,
    #[sqlx(rename = "dividend_yield")]
    pub dividend_yield: Option<Decimal>,
    pub source: Option<String>,
    #[sqlx(rename = "valid_time")]
    pub valid_time: chrono::DateTime<chrono::Utc>,
}

/// 公司仓储。
pub struct CompanyRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> CompanyRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 按代码取公司身份（公共参考数据，不分租户）。
    pub async fn by_ticker(&self, ticker: &str) -> Result<Option<CompanyRow>> {
        let row = sqlx::query_as::<_, CompanyRow>(
            "SELECT ticker, name_zh, name_en, sector, industry, exchange, currency, listing_status \
             FROM companies WHERE ticker = $1",
        )
        .bind(ticker)
        .fetch_optional(self.pool)
        .await?;
        Ok(row)
    }
}

/// 调度器状态（`scheduler_state` 表）——每个后台作业的上次运行时刻/状态。是运营数据、不分租户，
/// 直接读写（无 `user_id`、不走 RLS）。worker 重启后据此恢复「哪些作业该补跑」，是恢复门禁的底座。
#[derive(Debug, Clone, FromRow)]
pub struct SchedulerRun {
    #[sqlx(rename = "job_id")]
    pub job_id: String,
    #[sqlx(rename = "last_run_at")]
    pub last_run_at: Option<chrono::DateTime<chrono::Utc>>,
    #[sqlx(rename = "last_status")]
    pub last_status: Option<String>,
    #[sqlx(rename = "last_detail")]
    pub last_detail: Option<String>,
}

/// 调度器状态仓储。
pub struct SchedulerStateRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> SchedulerStateRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 拉全部作业的上次运行状态（worker 启动时一次性读，重建到期判定所需的 last_run 表）。
    pub async fn all(&self) -> Result<Vec<SchedulerRun>> {
        let rows = sqlx::query_as::<_, SchedulerRun>(
            "SELECT job_id, last_run_at, last_status, last_detail FROM scheduler_state",
        )
        .fetch_all(self.pool)
        .await?;
        Ok(rows)
    }

    /// 首次见到作业时建立持久游标。`last_run_at=now()` 表示“从注册时刻向后观察”，避免首启回填
    /// 全部历史，同时保证下一次 cron 边界能被发现；冲突时绝不覆盖真实运行状态。
    pub async fn register_job(&self, job_id: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO scheduler_state (job_id, last_run_at, last_status, last_detail) \
             VALUES ($1, now(), 'registered', '等待首次调度') \
             ON CONFLICT (job_id) DO NOTHING",
        )
        .bind(job_id)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// upsert 一条运行记录（作业跑完/失败都记，last_run_at=now）。job_id 冲突即更新——恢复安全。
    /// 同时释放 `try_claim` 持有的租约：跑完（无论成败）就该立刻让位给下一跳，不必等租约到期。
    pub async fn record_run(&self, job_id: &str, status: &str, detail: Option<&str>) -> Result<()> {
        sqlx::query(
            "INSERT INTO scheduler_state (job_id, last_run_at, last_status, last_detail) \
             VALUES ($1, now(), $2, $3) \
             ON CONFLICT (job_id) DO UPDATE SET \
               last_run_at = excluded.last_run_at, \
               last_status = excluded.last_status, \
               last_detail = excluded.last_detail, \
               locked_until = NULL, \
               locked_by = NULL",
        )
        .bind(job_id)
        .bind(status)
        .bind(detail)
        .execute(self.pool)
        .await?;
        Ok(())
    }

    /// 原子抢占一个作业的执行权（worker-lease，IMPROVEMENT_PLAN §4 P4-1）：只有租约为空或已
    /// 过期时才能抢到，`UPDATE ... WHERE` 的行级锁天然保证多实例并发调用只有一个成功——
    /// 不需要显式 `SELECT ... FOR UPDATE`，单行 upsert 场景下二者等价。抢占失败即另一实例
    /// 正在跑或刚跑完，本实例这一跳跳过该作业。
    pub async fn try_claim(
        &self,
        job_id: &str,
        worker_id: &str,
        lease_seconds: i64,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE scheduler_state \
             SET locked_until = now() + ($2 * interval '1 second'), locked_by = $3 \
             WHERE job_id = $1 AND (locked_until IS NULL OR locked_until < now())",
        )
        .bind(job_id)
        .bind(lease_seconds)
        .bind(worker_id)
        .execute(self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }
}

/// 一条 LLM 调用审计——failover 链上的每一跳都记（不止最终成功那跳）。对齐 TS `insertLlmAudit`。
/// 是私有数据（带 `user_id`、受 RLS），写入必走 [`with_tenant`]。
#[derive(Debug, Clone)]
pub struct LlmAuditEntry {
    pub user_id: String,
    pub provider: String,
    pub model: Option<String>,
    pub kind: String,
    pub status: String,
    pub latency_ms: Option<i32>,
    pub error_detail: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub estimated_cost_usd: Option<Decimal>,
}

/// error_detail 落库前截到 500 字（对齐 TS 的 `.slice(0, 500)`）——按 `char` 截，不切裂多字节。
#[must_use]
pub fn truncate_error_detail(detail: &str) -> String {
    detail.chars().take(500).collect()
}

/// LLM 审计仓储。写入是 best-effort：审计**绝不能阻断模型调用**（对齐 TS「audit must never block」），
/// 失败由调用方吞掉。
pub struct LlmAuditRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> LlmAuditRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 在租户事务内插入一条审计。`user_id` 兜底 "local"（对齐 TS 默认）。
    pub async fn insert(&self, entry: &LlmAuditEntry) -> Result<()> {
        let user_id = if entry.user_id.is_empty() {
            "local"
        } else {
            entry.user_id.as_str()
        };
        let error_detail = entry.error_detail.as_deref().map(truncate_error_detail);
        let mut tx = with_tenant(self.pool, user_id).await?;
        sqlx::query(
            "INSERT INTO llm_audit \
             (user_id, provider, model, kind, status, latency_ms, error_detail, input_tokens, output_tokens, estimated_cost_usd) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(user_id)
        .bind(&entry.provider)
        .bind(&entry.model)
        .bind(&entry.kind)
        .bind(&entry.status)
        .bind(entry.latency_ms)
        .bind(&error_detail)
        .bind(entry.input_tokens)
        .bind(entry.output_tokens)
        .bind(entry.estimated_cost_usd)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

/// 行情仓储——唯一取数入口的持久化侧（对齐 TS 的 ensureFreshMarketSnapshot 读路径）。
pub struct MarketRepository<'a> {
    pool: &'a PgPool,
}

#[derive(Clone, Debug)]
pub struct MarketSnapshotWrite {
    pub ticker: String,
    pub price: Option<Decimal>,
    pub previous_close: Option<Decimal>,
    pub change: Option<Decimal>,
    pub change_percent: Option<Decimal>,
    pub open: Option<Decimal>,
    pub high: Option<Decimal>,
    pub low: Option<Decimal>,
    pub volume: Option<Decimal>,
    pub market_cap: Option<Decimal>,
    pub pe: Option<Decimal>,
    pub dividend_yield: Option<Decimal>,
    pub week_52_high: Option<Decimal>,
    pub week_52_low: Option<Decimal>,
    pub source: String,
    pub valid_time: chrono::DateTime<chrono::Utc>,
}

impl<'a> MarketRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 取最新一条快照（按 valid_time 倒序）。缺数即断口——返回 `None`，绝不用陈旧/占位价冒充。
    pub async fn latest_snapshot(&self, ticker: &str) -> Result<Option<MarketRow>> {
        let row = sqlx::query_as::<_, MarketRow>(
            "SELECT ticker, price, change_percent, market_cap, pe, dividend_yield, source, valid_time \
             FROM market_snapshots WHERE ticker = $1 ORDER BY valid_time DESC LIMIT 1",
        )
        .bind(ticker)
        .fetch_optional(self.pool)
        .await?;
        Ok(row)
    }

    /// 通过质量门后的完整行情快照一次写入。公司行不存在时只建最小身份壳，名称保持 ticker，
    /// 以后经已验证的公司解析再补全；绝不伪造公司中文名。
    pub async fn insert_snapshot(&self, value: &MarketSnapshotWrite) -> Result<()> {
        let ticker = value.ticker.trim().to_ascii_uppercase();
        let currency = if ticker.ends_with(".HK") {
            "HKD"
        } else {
            "USD"
        };
        let exchange = if ticker.ends_with(".HK") {
            "HKEX"
        } else {
            "US"
        };
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO companies (ticker, name_zh, name_en, exchange, currency) \
             VALUES ($1, $1, CASE WHEN $2 = 'US' THEN $1 ELSE NULL END, $2, $3) \
             ON CONFLICT (ticker) DO NOTHING",
        )
        .bind(&ticker)
        .bind(exchange)
        .bind(currency)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO market_snapshots \
             (ticker, price, previous_close, change, change_percent, open, high, low, volume, \
              market_cap, pe, dividend_yield, week_52_high, week_52_low, source, valid_time) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
        )
        .bind(&ticker)
        .bind(value.price)
        .bind(value.previous_close)
        .bind(value.change)
        .bind(value.change_percent)
        .bind(value.open)
        .bind(value.high)
        .bind(value.low)
        .bind(value.volume)
        .bind(value.market_cap)
        .bind(value.pe)
        .bind(value.dividend_yield)
        .bind(value.week_52_high)
        .bind(value.week_52_low)
        .bind(&value.source)
        .bind(value.valid_time)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

/// 财报日历仓储——唯一读写入口（对齐 `earnings_calendar` 表；不分租户，公共参考数据）。
pub struct CalendarRepository<'a> {
    pool: &'a PgPool,
}

#[derive(Clone, Debug, FromRow)]
pub struct CalendarRow {
    pub ticker: String,
    pub next_date: Option<String>,
    pub quarter: Option<i32>,
    pub year: Option<i32>,
    pub eps_estimate: Option<Decimal>,
    pub revenue_estimate: Option<Decimal>,
    pub source: Option<String>,
    pub knowledge_time: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub struct CalendarUpsert {
    pub ticker: String,
    pub next_date: Option<String>,
    pub quarter: Option<i32>,
    pub year: Option<i32>,
    pub eps_estimate: Option<Decimal>,
    pub revenue_estimate: Option<Decimal>,
    pub source: String,
}

impl<'a> CalendarRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 取当前登记行。缺表项即断口——返回 `None`，绝不用陈旧值冒充。
    pub async fn latest(&self, ticker: &str) -> Result<Option<CalendarRow>> {
        let row = sqlx::query_as::<_, CalendarRow>(
            "SELECT ticker, next_date, quarter, year, eps_estimate, revenue_estimate, source, \
             knowledge_time FROM earnings_calendar WHERE ticker = $1",
        )
        .bind(ticker)
        .fetch_optional(self.pool)
        .await?;
        Ok(row)
    }

    /// 用最新供应商数据整行覆盖（`provider_status` 置 ok，`knowledge_time` 推进）。
    pub async fn upsert(&self, value: &CalendarUpsert) -> Result<()> {
        let ticker = value.ticker.trim().to_ascii_uppercase();
        sqlx::query(
            "INSERT INTO earnings_calendar \
             (ticker, next_date, quarter, year, eps_estimate, revenue_estimate, source, provider_status, knowledge_time) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'ok', now()) \
             ON CONFLICT (ticker) DO UPDATE SET \
               next_date = EXCLUDED.next_date, \
               quarter = EXCLUDED.quarter, \
               year = EXCLUDED.year, \
               eps_estimate = EXCLUDED.eps_estimate, \
               revenue_estimate = EXCLUDED.revenue_estimate, \
               source = EXCLUDED.source, \
               provider_status = 'ok', \
               knowledge_time = now()",
        )
        .bind(&ticker)
        .bind(&value.next_date)
        .bind(value.quarter)
        .bind(value.year)
        .bind(value.eps_estimate)
        .bind(value.revenue_estimate)
        .bind(&value.source)
        .execute(self.pool)
        .await?;
        Ok(())
    }
}

/// 历史估值分位仓储——`historical_valuation`（状态行）+ `historical_valuation_points`
/// （月度 PE 点）唯一读写入口。不分租户，公共参考数据。
pub struct HistoricalValuationRepository<'a> {
    pool: &'a PgPool,
}

#[derive(Clone, Debug, FromRow)]
pub struct HistoricalValuationPointRow {
    pub period_end_date: String,
    pub pe_value: Option<Decimal>,
}

#[derive(Clone, Debug)]
pub struct HistoricalValuationWrite {
    pub ticker: String,
    pub points: Vec<(String, Decimal)>,
}

impl<'a> HistoricalValuationRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 状态行的 `knowledge_time`；缺行即 `None`（从未取过数）。
    pub async fn knowledge_time(
        &self,
        ticker: &str,
    ) -> Result<Option<chrono::DateTime<chrono::Utc>>> {
        let row: Option<(chrono::DateTime<chrono::Utc>,)> = sqlx::query_as(
            "SELECT knowledge_time FROM historical_valuation WHERE ticker = $1 AND provider_status = 'ok'",
        )
        .bind(ticker)
        .fetch_optional(self.pool)
        .await?;
        Ok(row.map(|(t,)| t))
    }

    /// 月度 PE 点，按期末日期升序。缺点位即空表——绝不用陈旧/插值点冒充。
    pub async fn points(&self, ticker: &str) -> Result<Vec<HistoricalValuationPointRow>> {
        let rows = sqlx::query_as::<_, HistoricalValuationPointRow>(
            "SELECT period_end_date, pe_value FROM historical_valuation_points \
             WHERE ticker = $1 ORDER BY period_end_date ASC",
        )
        .bind(ticker)
        .fetch_all(self.pool)
        .await?;
        Ok(rows)
    }

    /// 整批覆盖点位并把状态行推进为 `ok`。先清空该 ticker 全部旧点位再写入——不然换算口径
    /// （比如从年度切到月度）后，旧点位会跟新点位混在一张分布表里，把分位算脏。
    pub async fn write(&self, value: &HistoricalValuationWrite) -> Result<()> {
        let ticker = value.ticker.trim().to_ascii_uppercase();
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM historical_valuation_points WHERE ticker = $1")
            .bind(&ticker)
            .execute(&mut *tx)
            .await?;
        for (period_end_date, pe_value) in &value.points {
            sqlx::query(
                "INSERT INTO historical_valuation_points (ticker, period_end_date, pe_value) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (ticker, period_end_date) DO UPDATE SET pe_value = EXCLUDED.pe_value",
            )
            .bind(&ticker)
            .bind(period_end_date)
            .bind(pe_value)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "INSERT INTO historical_valuation (ticker, provider_status, valid_time, knowledge_time) \
             VALUES ($1, 'ok', now(), now()) \
             ON CONFLICT (ticker) DO UPDATE SET \
               provider_status = 'ok', valid_time = now(), knowledge_time = now()",
        )
        .bind(&ticker)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

/// 同业锚点仓储——`comp_peers`（唯一读写入口；不分租户，公共参考数据；`ticker` 外键指向
/// `companies`，写入前调用方须已 `CompanyRepository::ensure` 建档）。
pub struct PeersRepository<'a> {
    pool: &'a PgPool,
}

#[derive(Clone, Debug, FromRow)]
pub struct PeersRow {
    pub ticker: String,
    pub peers_json: Option<serde_json::Value>,
    pub anchor_json: Option<serde_json::Value>,
    pub knowledge_time: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub struct PeersUpsert {
    pub ticker: String,
    pub peers_json: serde_json::Value,
    pub anchor_json: serde_json::Value,
    pub partial: bool,
}

impl<'a> PeersRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 取当前登记行。缺表项即断口——返回 `None`，绝不用陈旧值冒充。
    pub async fn latest(&self, ticker: &str) -> Result<Option<PeersRow>> {
        let row = sqlx::query_as::<_, PeersRow>(
            "SELECT ticker, peers_json, anchor_json, knowledge_time \
             FROM comp_peers WHERE ticker = $1 AND provider_status = 'ok'",
        )
        .bind(ticker)
        .fetch_optional(self.pool)
        .await?;
        Ok(row)
    }

    /// 用最新供应商数据整行覆盖（`provider_status` 置 ok，`knowledge_time` 推进）。
    pub async fn upsert(&self, value: &PeersUpsert) -> Result<()> {
        let ticker = value.ticker.trim().to_ascii_uppercase();
        sqlx::query(
            "INSERT INTO comp_peers \
             (ticker, peers_json, anchor_json, provider_status, partial, valid_time, knowledge_time) \
             VALUES ($1, $2, $3, 'ok', $4, now(), now()) \
             ON CONFLICT (ticker) DO UPDATE SET \
               peers_json = EXCLUDED.peers_json, \
               anchor_json = EXCLUDED.anchor_json, \
               provider_status = 'ok', \
               partial = EXCLUDED.partial, \
               valid_time = now(), \
               knowledge_time = now()",
        )
        .bind(&ticker)
        .bind(&value.peers_json)
        .bind(&value.anchor_json)
        .bind(value.partial)
        .execute(self.pool)
        .await?;
        Ok(())
    }
}

/// 公司公告/披露仓储——`company_filings`（唯一读写入口；不分租户，公共参考数据；`ticker`
/// 外键指向 `companies`，写入前调用方须已 `CompanyRepository::ensure` 建档）。
pub struct FilingsRepository<'a> {
    pool: &'a PgPool,
}

#[derive(Clone, Debug, FromRow)]
pub struct FilingRow {
    pub form: String,
    pub filed_date: Option<chrono::NaiveDate>,
    pub filing_url: String,
}

#[derive(Clone, Debug)]
pub struct NewFiling {
    pub form: String,
    pub filed_date: Option<chrono::NaiveDate>,
    pub accepted_date: Option<chrono::DateTime<chrono::Utc>>,
    pub report_url: Option<String>,
    pub filing_url: String,
}

impl<'a> FilingsRepository<'a> {
    #[must_use]
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// 该 ticker 最近一次同步时间；缺行即 `None`（从未取过数）。
    pub async fn last_synced(&self, ticker: &str) -> Result<Option<chrono::DateTime<chrono::Utc>>> {
        let row: Option<(chrono::DateTime<chrono::Utc>,)> = sqlx::query_as(
            "SELECT MAX(knowledge_time) FROM company_filings WHERE ticker = $1 \
             HAVING MAX(knowledge_time) IS NOT NULL",
        )
        .bind(ticker)
        .fetch_optional(self.pool)
        .await?;
        Ok(row.map(|(t,)| t))
    }

    /// 按公告日期倒序取最近若干条。缺表项即空表——绝不用陈旧/臆造行冒充。
    pub async fn recent(&self, ticker: &str, limit: i64) -> Result<Vec<FilingRow>> {
        let rows = sqlx::query_as::<_, FilingRow>(
            "SELECT form, filed_date, filing_url FROM company_filings \
             WHERE ticker = $1 ORDER BY filed_date DESC NULLS LAST, id DESC LIMIT $2",
        )
        .bind(ticker)
        .bind(limit)
        .fetch_all(self.pool)
        .await?;
        Ok(rows)
    }

    /// 批量插入新公告；已存在（同 ticker + filing_url）静默跳过——filings 是不可变历史记录，
    /// 不存在"覆盖更新"语义。`knowledge_time` 用当前时刻标记本轮同步。
    pub async fn insert_batch(&self, ticker: &str, filings: &[NewFiling]) -> Result<()> {
        if filings.is_empty() {
            return Ok(());
        }
        let ticker = ticker.trim().to_ascii_uppercase();
        let mut tx = self.pool.begin().await?;
        for filing in filings {
            sqlx::query(
                "INSERT INTO company_filings \
                 (ticker, form, filed_date, accepted_date, report_url, filing_url, source, valid_time, knowledge_time) \
                 VALUES ($1, $2, $3, $4, $5, $6, 'finnhub', now(), now()) \
                 ON CONFLICT (ticker, filing_url) DO NOTHING",
            )
            .bind(&ticker)
            .bind(&filing.form)
            .bind(filing.filed_date)
            .bind(filing.accepted_date)
            .bind(&filing.report_url)
            .bind(&filing.filing_url)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::truncate_error_detail;

    #[test]
    fn error_detail_truncated_to_500_chars() {
        let long = "x".repeat(1000);
        assert_eq!(truncate_error_detail(&long).chars().count(), 500);
    }

    #[test]
    fn error_detail_short_is_untouched() {
        assert_eq!(truncate_error_detail("boom"), "boom");
    }

    #[test]
    fn error_detail_truncation_respects_char_boundary() {
        // 多字节字符（中文 3 字节）按字符截，不切裂 UTF-8。
        let s = "错".repeat(600);
        let out = truncate_error_detail(&s);
        assert_eq!(out.chars().count(), 500);
        assert!(out.is_char_boundary(out.len())); // 未切裂
    }

    /// 活库集成：scheduler_state 往返（#9 可恢复门禁）。默认 `#[ignore]`，只在配了 DATABASE_URL 时
    /// 手动跑：`cargo test -p echo-db -- --ignored`。验 `record_run` upsert + `all()` 读回同一行，
    /// 证明 Rust 仓储与真库 schema（列名/类型）对齐；跑完删掉探针行，不留污染。
    #[tokio::test]
    #[ignore = "需要活库 DATABASE_URL"]
    async fn live_scheduler_state_round_trip() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = super::connect(&url, 2).await.expect("connect");
        if std::env::var("ECHO_SKIP_TEST_MIGRATE").ok().as_deref() != Some("1") {
            super::migrate(&pool).await.expect("migrate");
        }
        let repo = super::SchedulerStateRepository::new(&pool);
        let probe_id = "echo-verify-probe";

        repo.register_job(probe_id).await.expect("register");
        let registered = repo.all().await.expect("registered all");
        let first = registered
            .iter()
            .find(|r| r.job_id == probe_id)
            .expect("registered row present");
        assert_eq!(first.last_status.as_deref(), Some("registered"));

        repo.record_run(probe_id, "ok", Some("live probe"))
            .await
            .expect("record_run");
        let rows = repo.all().await.expect("all");
        let found = rows
            .iter()
            .find(|r| r.job_id == probe_id)
            .expect("probe row present");
        assert_eq!(found.last_status.as_deref(), Some("ok"));
        assert_eq!(found.last_detail.as_deref(), Some("live probe"));
        assert!(found.last_run_at.is_some(), "last_run_at 应由 now() 落值");

        // upsert 语义：同 id 再写一次应更新而非插重。
        repo.record_run(probe_id, "error", Some("second"))
            .await
            .expect("upsert");
        let after = repo.all().await.expect("all2");
        assert_eq!(
            after.iter().filter(|r| r.job_id == probe_id).count(),
            1,
            "upsert 不应产生重复行"
        );

        // 清理探针，不留污染。
        sqlx::query("DELETE FROM scheduler_state WHERE job_id = $1")
            .bind(probe_id)
            .execute(&pool)
            .await
            .expect("cleanup probe");
    }

    /// 活库集成：worker-lease 原子抢占（IMPROVEMENT_PLAN §4 P4-1）。证明"第二个实例在租约有效期内
    /// 抢不到、`record_run` 会释放锁、锁过期后能重新抢到"三件事——这正是多 worker 部署下防止
    /// 同一 job 被重复执行所依赖的不变量。默认 `#[ignore]`，手动跑：`cargo test -p echo-db -- --ignored`。
    #[tokio::test]
    #[ignore = "需要活库 DATABASE_URL"]
    async fn live_scheduler_lease_claim_round_trip() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = super::connect(&url, 2).await.expect("connect");
        if std::env::var("ECHO_SKIP_TEST_MIGRATE").ok().as_deref() != Some("1") {
            super::migrate(&pool).await.expect("migrate");
        }
        let repo = super::SchedulerStateRepository::new(&pool);
        let probe_id = "echo-verify-lease-probe";
        repo.register_job(probe_id).await.expect("register");

        // 实例 A 抢到租约。
        let claimed_a = repo
            .try_claim(probe_id, "worker-a", 60)
            .await
            .expect("claim a");
        assert!(claimed_a, "首次抢占应成功");

        // 实例 B 在租约有效期内抢同一 job——必须失败，不能两个实例同时跑同一作业。
        let claimed_b = repo
            .try_claim(probe_id, "worker-b", 60)
            .await
            .expect("claim b");
        assert!(!claimed_b, "租约未过期时第二个实例不应抢到");

        // A 跑完调 record_run——应同时释放锁，B 立刻能抢到，不必等 60s 租约到期。
        repo.record_run(probe_id, "ok", Some("lease probe"))
            .await
            .expect("record_run releases lease");
        let claimed_b_after_release = repo
            .try_claim(probe_id, "worker-b", 60)
            .await
            .expect("claim b after release");
        assert!(claimed_b_after_release, "record_run 后锁应已释放，B 能抢到");
        repo.record_run(probe_id, "ok", Some("release b"))
            .await
            .expect("release b's claim before expiry scenario");

        // 租约过期（用负秒数模拟已过期）后，即便没调 record_run，别的实例也能重新抢到——
        // 覆盖"持锁进程崩溃"场景，不会永久卡死这个 job。
        let claimed_c = repo
            .try_claim(probe_id, "worker-c", -1)
            .await
            .expect("claim c expires immediately");
        assert!(claimed_c, "锁已释放，C 应能抢到（即便租约设为已过期）");
        let claimed_d = repo
            .try_claim(probe_id, "worker-d", 60)
            .await
            .expect("claim d");
        assert!(claimed_d, "过期租约应可被下一个实例重新抢占");

        sqlx::query("DELETE FROM scheduler_state WHERE job_id = $1")
            .bind(probe_id)
            .execute(&pool)
            .await
            .expect("cleanup probe");
    }
}
