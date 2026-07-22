//! Finnhub 同业候选列表——只取 ticker 名单，每个候选自身的财报数字复用既有
//! `FundamentalsService`（避免为同业再起一套 HTTP 客户端）。
//!
//! 免费档、非商用；无 key / 商用模式 / 上游失败一律返回空列表，不阻断主研究链。

use crate::market::normalize_ticker;
use echo_config::DataSourceConfig;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use thiserror::Error;

const MAX_PEERS: usize = 6;

#[derive(Debug, Error)]
pub enum PeersError {
    #[error("FINNHUB_API_KEY 未配置")]
    MissingApiKey,
    #[error("商用模式不允许未授权的 Finnhub 免费源")]
    CommercialBlocked,
    #[error(transparent)]
    Http(#[from] reqwest::Error),
}

#[derive(Clone)]
pub struct PeersService {
    client: reqwest::Client,
    config: DataSourceConfig,
}

impl PeersService {
    pub fn new(config: DataSourceConfig) -> Result<Self, PeersError> {
        Ok(Self {
            client: reqwest::Client::builder()
                .user_agent("EchoResearch/1.0")
                .timeout(Duration::from_secs(8))
                .build()?,
            config,
        })
    }

    /// 取同业候选 ticker（已排除自身、去重、截断到 `MAX_PEERS`）。
    pub async fn fetch_peer_tickers(&self, raw_ticker: &str) -> Vec<String> {
        match self.fetch_strict(raw_ticker).await {
            Ok(tickers) => tickers,
            Err(error) => {
                tracing::warn!(ticker = raw_ticker, error = %error, "Finnhub 同业列表未核到");
                Vec::new()
            }
        }
    }

    async fn fetch_strict(&self, raw_ticker: &str) -> Result<Vec<String>, PeersError> {
        if self.config.commercial_mode {
            return Err(PeersError::CommercialBlocked);
        }
        let Some(api_key) = self.config.finnhub_api_key.as_deref() else {
            return Err(PeersError::MissingApiKey);
        };
        let ticker = normalize_ticker(raw_ticker);
        let body: Value = self
            .client
            .get("https://finnhub.io/api/v1/stock/peers")
            .query(&[("symbol", ticker.as_str()), ("token", api_key)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(extract_peer_tickers(&body, &ticker))
    }
}

fn extract_peer_tickers(body: &Value, self_ticker: &str) -> Vec<String> {
    let Some(items) = body.as_array() else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(Value::as_str)
        .map(normalize_ticker)
        .filter(|candidate| candidate != self_ticker && seen.insert(candidate.clone()))
        .take(MAX_PEERS)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_dedupes_excludes_self_and_caps() {
        let body = json!([
            "AAPL", "MSFT", "MSFT", "GOOGL", "META", "AMZN", "NFLX", "ORCL"
        ]);
        let peers = extract_peer_tickers(&body, "AAPL");
        assert_eq!(peers, vec!["MSFT", "GOOGL", "META", "AMZN", "NFLX", "ORCL"]);
    }

    #[test]
    fn non_array_body_yields_empty() {
        let body = json!({ "error": "limit reached" });
        assert!(extract_peer_tickers(&body, "AAPL").is_empty());
    }

    #[tokio::test]
    async fn missing_key_returns_empty_without_network_call() {
        let service = PeersService::new(DataSourceConfig {
            finnhub_api_key: None,
            fmp_api_key: None,
            commercial_mode: false,
        })
        .expect("client build");
        assert!(service.fetch_peer_tickers("AAPL").await.is_empty());
    }

    #[tokio::test]
    async fn commercial_mode_blocks_even_with_key() {
        let service = PeersService::new(DataSourceConfig {
            finnhub_api_key: Some("test-key".into()),
            fmp_api_key: None,
            commercial_mode: true,
        })
        .expect("client build");
        assert!(service.fetch_peer_tickers("AAPL").await.is_empty());
    }
}
