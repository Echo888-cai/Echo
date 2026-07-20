//! 持久化与租户 RLS（PostgreSQL / sqlx）——迁移自 `packages/db`（Drizzle）。
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

// 连接池类型对上层再导出，让 echo-api 等消费方不必直接钉 sqlx 版本（工作区单一事实源在此收口）。
pub use sqlx::postgres::PgPool as Pool;

/// 数据层错误——薄封装 sqlx，避免上层直接耦合驱动。
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
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

    /// upsert 一条运行记录（作业跑完/失败都记，last_run_at=now）。job_id 冲突即更新——恢复安全。
    pub async fn record_run(&self, job_id: &str, status: &str, detail: Option<&str>) -> Result<()> {
        sqlx::query(
            "INSERT INTO scheduler_state (job_id, last_run_at, last_status, last_detail) \
             VALUES ($1, now(), $2, $3) \
             ON CONFLICT (job_id) DO UPDATE SET \
               last_run_at = excluded.last_run_at, \
               last_status = excluded.last_status, \
               last_detail = excluded.last_detail",
        )
        .bind(job_id)
        .bind(status)
        .bind(detail)
        .execute(self.pool)
        .await?;
        Ok(())
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
}
