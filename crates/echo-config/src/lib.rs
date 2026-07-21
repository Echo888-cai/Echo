//! 服务进程配置的单一入口。
//!
//! 环境变量只在进程边界读取；解析和默认值是纯函数，可并行测试且不会修改全局环境。

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

const DEFAULT_API_PORT: u16 = 4180;
const DEFAULT_DB_CONNECTIONS: u32 = 5;

/// 外部数据源配置。所有密钥只在进程组合根读取，再显式注入数据层。
/// 故意不实现 `Debug`，避免密钥进入日志或错误快照。
#[derive(Clone, Default)]
pub struct DataSourceConfig {
    pub finnhub_api_key: Option<String>,
    pub fmp_api_key: Option<String>,
    pub tavily_api_key: Option<String>,
    pub commercial_mode: bool,
}

impl DataSourceConfig {
    fn from_lookup<F>(lookup: &mut F) -> Self
    where
        F: FnMut(&str) -> Option<String>,
    {
        Self {
            finnhub_api_key: non_empty(lookup("FINNHUB_API_KEY")),
            fmp_api_key: non_empty(lookup("FMP_API_KEY")),
            tavily_api_key: non_empty(lookup("TAVILY_API_KEY")),
            commercial_mode: flag(non_empty(lookup("ECHO_COMMERCIAL_MODE"))),
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{key} 不是合法端口: {value}")]
    InvalidPort { key: &'static str, value: String },
    #[error("{key} 不是合法 IP 地址: {value}")]
    InvalidIp { key: &'static str, value: String },
    #[error("{key} 必须是大于 0 的整数: {value}")]
    InvalidPositiveInteger { key: &'static str, value: String },
    #[error("缺少必需环境变量 {0}")]
    Missing(&'static str),
}

/// API 进程配置。故意不实现 `Debug`，避免未来把数据库凭据打印进日志。
pub struct ApiConfig {
    pub listen_addr: SocketAddr,
    pub database_url: Option<String>,
    pub max_connections: u32,
    pub auth_disabled: bool,
    pub auth_disabled_user_id: String,
    pub secure_cookie: bool,
    pub data_sources: DataSourceConfig,
}

impl ApiConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup<F>(mut lookup: F) -> Result<Self, ConfigError>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let host = non_empty(lookup("API_HOST"))
            .unwrap_or_else(|| Ipv4Addr::UNSPECIFIED.to_string())
            .parse::<IpAddr>()
            .map_err(|_| ConfigError::InvalidIp {
                key: "API_HOST",
                value: non_empty(lookup("API_HOST")).unwrap_or_default(),
            })?;
        // API_PORT 是唯一正式名字；迁移期兼容 Rust 竖切曾使用的 PORT，最终清掉后者。
        let (port_key, port_value) = non_empty(lookup("API_PORT"))
            .map(|value| ("API_PORT", value))
            .or_else(|| non_empty(lookup("PORT")).map(|value| ("PORT", value)))
            .unwrap_or_else(|| ("API_PORT", DEFAULT_API_PORT.to_string()));
        let port = port_value
            .parse::<u16>()
            .map_err(|_| ConfigError::InvalidPort {
                key: port_key,
                value: port_value,
            })?;
        let max_connections = positive_u32(
            "DATABASE_MAX_CONNECTIONS",
            non_empty(lookup("DATABASE_MAX_CONNECTIONS")),
            DEFAULT_DB_CONNECTIONS,
        )?;
        let data_sources = DataSourceConfig::from_lookup(&mut lookup);
        Ok(Self {
            listen_addr: SocketAddr::new(host, port),
            database_url: non_empty(lookup("DATABASE_URL")),
            max_connections,
            auth_disabled: flag(non_empty(lookup("ECHO_AUTH_DISABLED"))),
            auth_disabled_user_id: non_empty(lookup("ECHO_AUTH_DISABLED_USER_ID"))
                .unwrap_or_else(|| "local".into()),
            secure_cookie: flag(non_empty(lookup("ECHO_TRUST_PROXY"))),
            data_sources,
        })
    }
}

/// Worker 配置。数据库是可恢复调度的硬依赖，缺失时拒绝启动。
pub struct WorkerConfig {
    pub database_url: String,
    pub max_connections: u32,
    pub tick_seconds: u64,
    pub backup_dir: String,
    pub data_sources: DataSourceConfig,
}

impl WorkerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup<F>(mut lookup: F) -> Result<Self, ConfigError>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let database_url =
            non_empty(lookup("DATABASE_URL")).ok_or(ConfigError::Missing("DATABASE_URL"))?;
        let max_connections = positive_u32(
            "DATABASE_MAX_CONNECTIONS",
            non_empty(lookup("DATABASE_MAX_CONNECTIONS")),
            DEFAULT_DB_CONNECTIONS,
        )?;
        let tick_seconds = positive_u64(
            "WORKER_TICK_SECONDS",
            non_empty(lookup("WORKER_TICK_SECONDS")),
            60,
        )?;
        let data_sources = DataSourceConfig::from_lookup(&mut lookup);
        Ok(Self {
            database_url,
            max_connections,
            tick_seconds,
            backup_dir: non_empty(lookup("ECHO_BACKUP_DIR"))
                .unwrap_or_else(|| "backups/postgres".into()),
            data_sources,
        })
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn flag(value: Option<String>) -> bool {
    value.is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
}

fn positive_u32(
    key: &'static str,
    value: Option<String>,
    default: u32,
) -> Result<u32, ConfigError> {
    let Some(value) = value else {
        return Ok(default);
    };
    value
        .parse::<u32>()
        .ok()
        .filter(|parsed| *parsed > 0)
        .ok_or(ConfigError::InvalidPositiveInteger { key, value })
}

fn positive_u64(
    key: &'static str,
    value: Option<String>,
    default: u64,
) -> Result<u64, ConfigError> {
    let Some(value) = value else {
        return Ok(default);
    };
    value
        .parse::<u64>()
        .ok()
        .filter(|parsed| *parsed > 0)
        .ok_or(ConfigError::InvalidPositiveInteger { key, value })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup<'a>(values: &'a [(&'a str, &'a str)]) -> impl FnMut(&str) -> Option<String> + 'a {
        let values: HashMap<_, _> = values.iter().copied().collect();
        move |key| values.get(key).map(ToString::to_string)
    }

    #[test]
    fn api_defaults_are_stable() {
        let config = ApiConfig::from_lookup(lookup(&[])).expect("config");
        assert_eq!(config.listen_addr, "0.0.0.0:4180".parse().expect("addr"));
        assert!(config.database_url.is_none());
        assert_eq!(config.max_connections, 5);
        assert!(!config.auth_disabled);
        assert!(!config.secure_cookie);
    }

    #[test]
    fn api_port_wins_over_legacy_port() {
        let config = ApiConfig::from_lookup(lookup(&[("API_PORT", "9000"), ("PORT", "8000")]))
            .expect("config");
        assert_eq!(config.listen_addr.port(), 9000);
    }

    #[test]
    fn invalid_host_and_port_fail_loudly() {
        assert!(matches!(
            ApiConfig::from_lookup(lookup(&[("API_HOST", "localhost")])),
            Err(ConfigError::InvalidIp { .. })
        ));
        assert!(matches!(
            ApiConfig::from_lookup(lookup(&[("API_PORT", "99999")])),
            Err(ConfigError::InvalidPort { .. })
        ));
    }

    #[test]
    fn worker_requires_database_and_positive_tick() {
        assert!(matches!(
            WorkerConfig::from_lookup(lookup(&[])),
            Err(ConfigError::Missing("DATABASE_URL"))
        ));
        assert!(matches!(
            WorkerConfig::from_lookup(lookup(&[
                ("DATABASE_URL", "postgresql:///echo"),
                ("WORKER_TICK_SECONDS", "0")
            ])),
            Err(ConfigError::InvalidPositiveInteger { .. })
        ));
    }
}
