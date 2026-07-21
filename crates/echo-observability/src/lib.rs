//! Rust 服务的统一日志/追踪入口。

use tracing_subscriber::EnvFilter;

/// 初始化全局 subscriber。`RUST_LOG` 控制过滤；`ECHO_LOG_FORMAT=json` 输出结构化日志。
pub fn init(service: &'static str) -> Result<(), String> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let json =
        std::env::var("ECHO_LOG_FORMAT").is_ok_and(|value| value.eq_ignore_ascii_case("json"));
    if json {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .json()
            .with_current_span(true)
            .with_span_list(true)
            .try_init()
            .map_err(|error| format!("初始化 {service} tracing 失败: {error}"))
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .compact()
            .try_init()
            .map_err(|error| format!("初始化 {service} tracing 失败: {error}"))
    }
}
