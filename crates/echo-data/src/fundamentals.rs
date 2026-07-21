//! FMP `stable` 美股三表 fundamentals。
//!
//! 边界与旧 `fmpFundamentalsAdapter` 对齐：免费档三表只对美股代码可用；HK/CN 会
//! 返回 premium 错误体，因此 `supports` 严格 US-only。商用模式禁止未授权免费源。
//! 季度 EPS 不得用于反推 PE——调用方应优先使用本结果的 `pe_ttm`。

use crate::fmp::{self, FmpError, decimal_at, fetch_json, string_at};
use crate::{Market, detect_market, normalize_ticker};
use echo_config::DataSourceConfig;
use rust_decimal::Decimal;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FundamentalsRow {
    pub currency: Option<String>,
    pub revenue: Option<Decimal>,
    pub gross_profit: Option<Decimal>,
    pub operating_income: Option<Decimal>,
    pub net_income: Option<Decimal>,
    pub operating_cash_flow: Option<Decimal>,
    pub cash_and_equivalents: Option<Decimal>,
    pub net_cash: Option<Decimal>,
    /// 单季 EPS，仅供展示；估值应用 `pe_ttm`，并把 `eps_annualized` 视为 false。
    pub eps: Option<Decimal>,
    pub pe_ttm: Option<Decimal>,
    pub revenue_prior: Option<Decimal>,
    pub net_income_prior: Option<Decimal>,
    pub period_end: Option<String>,
    pub published_at: Option<String>,
    pub period_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FundamentalsResult {
    pub provider_ok: bool,
    pub source: String,
    pub rows: Vec<FundamentalsRow>,
}

impl FundamentalsResult {
    #[must_use]
    pub fn missing(source: impl Into<String>) -> Self {
        Self {
            provider_ok: false,
            source: source.into(),
            rows: Vec::new(),
        }
    }

    #[must_use]
    pub fn latest(&self) -> Option<&FundamentalsRow> {
        self.rows.first()
    }
}

pub type FundamentalsError = FmpError;

#[derive(Clone)]
pub struct FundamentalsService {
    client: reqwest::Client,
    config: DataSourceConfig,
}

impl FundamentalsService {
    pub fn new(config: DataSourceConfig) -> Result<Self, FundamentalsError> {
        Ok(Self {
            client: fmp::build_client()?,
            config,
        })
    }

    /// 取最新可用美股财报行。未配 key / 非美股 / 商用模式 / 上游失败 → `missing`，不抛给主链路。
    pub async fn fetch(&self, raw_ticker: &str) -> FundamentalsResult {
        match self.fetch_strict(raw_ticker).await {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(ticker = raw_ticker, error = %error, "FMP fundamentals 未核到");
                FundamentalsResult::missing("FMP")
            }
        }
    }

    async fn fetch_strict(
        &self,
        raw_ticker: &str,
    ) -> Result<FundamentalsResult, FundamentalsError> {
        if self.config.commercial_mode {
            return Err(FundamentalsError::CommercialBlocked);
        }
        let Some(api_key) = self.config.fmp_api_key.as_deref() else {
            return Err(FundamentalsError::MissingApiKey);
        };
        let ticker = normalize_ticker(raw_ticker);
        if detect_market(&ticker) != Market::Us {
            return Err(FundamentalsError::UnsupportedMarket(ticker));
        }

        let income_path = format!(
            "income-statement?symbol={}&period=quarter&limit=2",
            encode(&ticker)
        );
        let cash_path = format!(
            "cash-flow-statement?symbol={}&period=quarter&limit=1",
            encode(&ticker)
        );
        let balance_path = format!(
            "balance-sheet-statement?symbol={}&period=quarter&limit=1",
            encode(&ticker)
        );
        let ratios_path = format!("ratios-ttm?symbol={}", encode(&ticker));

        let (income, cash_flow, balance_sheet, ratios_ttm) = tokio::join!(
            fetch_json(&self.client, api_key, &income_path),
            fetch_json(&self.client, api_key, &cash_path),
            fetch_json(&self.client, api_key, &balance_path),
            fetch_json(&self.client, api_key, &ratios_path),
        );

        let income = income?;
        let cash = cash_flow.ok();
        let balance = balance_sheet.ok();
        let ratios = ratios_ttm.ok();

        let current = first_object(&income);
        let prior = nth_object(&income, 1);
        let Some(current) = current else {
            return Ok(FundamentalsResult::missing("FMP"));
        };
        let cash_row = cash.as_ref().and_then(first_object);
        let balance_row = balance.as_ref().and_then(first_object);
        let ratios_row = ratios.as_ref().and_then(first_object);

        let pe_ttm = ratios_row
            .and_then(|row| decimal_at(row, "priceToEarningsRatioTTM"))
            .filter(|value| *value > Decimal::ZERO);

        let fiscal_year = string_at(current, "fiscalYear");
        let period = string_at(current, "period");
        let period_label = match (fiscal_year, period) {
            (Some(year), Some(period)) => Some(format!("{year} {period}")),
            _ => None,
        };

        let net_debt = balance_row.and_then(|row| decimal_at(row, "netDebt"));
        let row = FundamentalsRow {
            currency: string_at(current, "reportedCurrency"),
            revenue: decimal_at(current, "revenue"),
            gross_profit: decimal_at(current, "grossProfit"),
            operating_income: decimal_at(current, "operatingIncome"),
            net_income: decimal_at(current, "netIncome"),
            operating_cash_flow: cash_row
                .and_then(|row| decimal_at(row, "netCashProvidedByOperatingActivities")),
            cash_and_equivalents: balance_row
                .and_then(|row| decimal_at(row, "cashAndCashEquivalents")),
            net_cash: net_debt.map(|debt| -debt),
            eps: decimal_at(current, "epsDiluted").or_else(|| decimal_at(current, "eps")),
            pe_ttm,
            revenue_prior: prior.and_then(|row| decimal_at(row, "revenue")),
            net_income_prior: prior.and_then(|row| decimal_at(row, "netIncome")),
            period_end: string_at(current, "date"),
            published_at: string_at(current, "filingDate"),
            period_label,
        };

        Ok(FundamentalsResult {
            provider_ok: true,
            source: "FMP".into(),
            rows: vec![row],
        })
    }
}

fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn first_object(body: &Value) -> Option<&Value> {
    nth_object(body, 0)
}

fn nth_object(body: &Value, index: usize) -> Option<&Value> {
    body.as_array()?.get(index).filter(|item| item.is_object())
}

/// 把 FMP 行映射成估值/护栏可用的派生字段（同比%、利润率）。
#[must_use]
pub fn pct_of(part: Option<Decimal>, whole: Option<Decimal>) -> Option<Decimal> {
    match (part, whole) {
        (Some(part), Some(whole)) if !whole.is_zero() => Some(part * Decimal::from(100) / whole),
        _ => None,
    }
}

#[must_use]
pub fn pct_change(current: Option<Decimal>, prior: Option<Decimal>) -> Option<Decimal> {
    match (current, prior) {
        (Some(current), Some(prior)) if !prior.is_zero() => {
            Some((current - prior) * Decimal::from(100) / prior)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;
    use serde_json::json;

    #[test]
    fn maps_stable_fixture_like_retired_adapter() {
        let income = json!([
            {
                "date": "2026-03-28",
                "filingDate": "2026-05-01",
                "reportedCurrency": "USD",
                "fiscalYear": "2026",
                "period": "Q2",
                "revenue": 95_359_000_000i64,
                "grossProfit": 44_867_000_000i64,
                "operatingIncome": 29_552_000_000i64,
                "netIncome": 24_780_000_000i64,
                "eps": 1.65,
                "epsDiluted": 1.65
            },
            {
                "revenue": 89_498_000_000i64,
                "netIncome": 22_292_000_000i64
            }
        ]);
        let cash = json!([{ "netCashProvidedByOperatingActivities": 29_000_000_000i64 }]);
        let balance = json!([{
            "cashAndCashEquivalents": 30_000_000_000i64,
            "netDebt": -10_000_000_000i64
        }]);
        let ratios = json!([{ "priceToEarningsRatioTTM": 28.5 }]);

        let current = first_object(&income).expect("current");
        let prior = nth_object(&income, 1);
        let cash_row = first_object(&cash);
        let balance_row = first_object(&balance);
        let ratios_row = first_object(&ratios);
        let pe_ttm = ratios_row
            .and_then(|row| decimal_at(row, "priceToEarningsRatioTTM"))
            .filter(|value| *value > Decimal::ZERO);
        let net_debt = balance_row.and_then(|row| decimal_at(row, "netDebt"));
        let row = FundamentalsRow {
            currency: string_at(current, "reportedCurrency"),
            revenue: decimal_at(current, "revenue"),
            gross_profit: decimal_at(current, "grossProfit"),
            operating_income: decimal_at(current, "operatingIncome"),
            net_income: decimal_at(current, "netIncome"),
            operating_cash_flow: cash_row
                .and_then(|row| decimal_at(row, "netCashProvidedByOperatingActivities")),
            cash_and_equivalents: balance_row
                .and_then(|row| decimal_at(row, "cashAndCashEquivalents")),
            net_cash: net_debt.map(|debt| -debt),
            eps: decimal_at(current, "epsDiluted").or_else(|| decimal_at(current, "eps")),
            pe_ttm,
            revenue_prior: prior.and_then(|row| decimal_at(row, "revenue")),
            net_income_prior: prior.and_then(|row| decimal_at(row, "netIncome")),
            period_end: string_at(current, "date"),
            published_at: string_at(current, "filingDate"),
            period_label: Some("2026 Q2".into()),
        };

        assert_eq!(row.eps, Some(dec!(1.65)));
        assert_eq!(row.pe_ttm, Some(dec!(28.5)));
        assert_eq!(row.net_cash, Some(dec!(10000000000)));
        let growth = pct_change(row.revenue, row.revenue_prior).expect("growth");
        assert!(growth > dec!(6) && growth < dec!(7));
        let margin = pct_of(row.net_income, row.revenue).expect("margin");
        assert!(margin > dec!(25) && margin < dec!(27));
    }

    #[tokio::test]
    async fn commercial_mode_and_hk_never_call_out() {
        let commercial = FundamentalsService::new(DataSourceConfig {
            commercial_mode: true,
            fmp_api_key: Some("x".into()),
            ..Default::default()
        })
        .expect("service");
        assert!(!commercial.fetch("AAPL").await.provider_ok);

        let research = FundamentalsService::new(DataSourceConfig {
            fmp_api_key: Some("x".into()),
            ..Default::default()
        })
        .expect("service");
        assert!(!research.fetch("0700.HK").await.provider_ok);
    }

    #[tokio::test]
    async fn missing_key_is_honest_missing() {
        let service = FundamentalsService::new(DataSourceConfig::default()).expect("service");
        assert!(!service.fetch("AAPL").await.provider_ok);
    }
}
