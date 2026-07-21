//! Echo 的唯一外部数据入口。
//!
//! 选择顺序固定为“授权允许 → 数据质量等级 → 延迟”，商用模式绝不会把免费研究接口
//! 当最后兜底。供应商数字先转为 [`rust_decimal::Decimal`]，经过质量门后才允许写入仓库。

mod fmp;
mod fundamentals;
mod market;
mod quality;
mod quote;
mod router;
mod search;

pub use fundamentals::{
    FundamentalsError, FundamentalsResult, FundamentalsRow, FundamentalsService, pct_change, pct_of,
};
pub use market::{Market, detect_market, normalize_ticker};
pub use quality::{QualityIssue, QualityReport, Severity, check_quote};
pub use quote::{ProviderStatus, Quote, QuoteError, QuoteService, RoutedQuote};
pub use router::{AdapterAuthorization, AdapterDescriptor, LicenseTier, select_adapter_chain};
pub use search::{
    FmpSearchService, FmpSymbolHit, SearchError, US_MAIN_EXCHANGES, best_us_name_hit,
    is_us_main_exchange,
};
