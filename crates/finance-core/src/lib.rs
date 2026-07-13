//! Deterministic financial arithmetic for Echo Research.
//!
//! This crate deliberately accepts and returns decimal values. Binary floating
//! point belongs at the display boundary, never in money, ratios or valuation.

use rust_decimal::{Decimal, RoundingStrategy};
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Currency {
    Cny,
    Hkd,
    Usd,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Money {
    amount: Decimal,
    currency: Currency,
}

impl Money {
    #[must_use]
    pub const fn new(amount: Decimal, currency: Currency) -> Self {
        Self { amount, currency }
    }

    #[must_use]
    pub const fn amount(self) -> Decimal {
        self.amount
    }

    #[must_use]
    pub const fn currency(self) -> Currency {
        self.currency
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FinanceError {
    CurrencyMismatch,
    NonPositiveShares,
    ArithmeticOverflow,
}

impl fmt::Display for FinanceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CurrencyMismatch => formatter.write_str("currency mismatch"),
            Self::NonPositiveShares => formatter.write_str("shares must be positive"),
            Self::ArithmeticOverflow => formatter.write_str("decimal arithmetic overflow"),
        }
    }
}

impl std::error::Error for FinanceError {}

/// `(actual - estimate) / |estimate| × 100`, rounded to one decimal place.
/// A zero estimate has no meaningful percentage surprise and returns `None`.
pub fn surprise_percent(
    actual: Decimal,
    estimate: Decimal,
) -> Result<Option<Decimal>, FinanceError> {
    if estimate.is_zero() {
        return Ok(None);
    }
    let delta = actual
        .checked_sub(estimate)
        .ok_or(FinanceError::ArithmeticOverflow)?;
    let ratio = delta
        .checked_div(estimate.abs())
        .ok_or(FinanceError::ArithmeticOverflow)?;
    let percent = ratio
        .checked_mul(Decimal::ONE_HUNDRED)
        .ok_or(FinanceError::ArithmeticOverflow)?;
    Ok(Some(percent.round_dp_with_strategy(
        1,
        RoundingStrategy::MidpointAwayFromZero,
    )))
}

/// Enterprise-value multiple × metric + net cash = implied equity value.
pub fn equity_value_from_multiple(
    metric: Money,
    multiple: Decimal,
    net_cash: Money,
) -> Result<Money, FinanceError> {
    if metric.currency != net_cash.currency {
        return Err(FinanceError::CurrencyMismatch);
    }
    let enterprise_value = metric
        .amount
        .checked_mul(multiple)
        .ok_or(FinanceError::ArithmeticOverflow)?;
    let equity_value = enterprise_value
        .checked_add(net_cash.amount)
        .ok_or(FinanceError::ArithmeticOverflow)?;
    Ok(Money::new(equity_value, metric.currency))
}

/// Convert total equity value into a per-share value with explicit precision.
pub fn per_share(
    equity_value: Money,
    diluted_shares: Decimal,
    decimal_places: u32,
) -> Result<Money, FinanceError> {
    if diluted_shares <= Decimal::ZERO {
        return Err(FinanceError::NonPositiveShares);
    }
    let value = equity_value
        .amount
        .checked_div(diluted_shares)
        .ok_or(FinanceError::ArithmeticOverflow)?
        .round_dp_with_strategy(decimal_places, RoundingStrategy::MidpointAwayFromZero);
    Ok(Money::new(value, equity_value.currency))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn earnings_surprise_has_exact_decimal_rounding() {
        assert_eq!(
            surprise_percent(Decimal::new(105, 2), Decimal::new(100, 2)),
            Ok(Some(Decimal::new(50, 1)))
        );
        assert_eq!(
            surprise_percent(Decimal::new(95, 2), Decimal::new(100, 2)),
            Ok(Some(Decimal::new(-50, 1)))
        );
        assert_eq!(surprise_percent(Decimal::ONE, Decimal::ZERO), Ok(None));
    }

    #[test]
    fn valuation_keeps_currency_and_never_uses_binary_float() {
        let revenue = Money::new(Decimal::new(650_000_000, 0), Currency::Usd);
        let net_cash = Money::new(Decimal::new(1_390_000_000, 0), Currency::Usd);
        let equity = equity_value_from_multiple(revenue, Decimal::new(10, 0), net_cash).unwrap();
        let price = per_share(equity, Decimal::new(550_000_000, 0), 2).unwrap();
        assert_eq!(equity.amount(), Decimal::new(7_890_000_000, 0));
        assert_eq!(price, Money::new(Decimal::new(1435, 2), Currency::Usd));
    }

    #[test]
    fn invalid_financial_dimensions_fail_loudly() {
        let usd = Money::new(Decimal::ONE, Currency::Usd);
        let hkd = Money::new(Decimal::ONE, Currency::Hkd);
        assert_eq!(
            equity_value_from_multiple(usd, Decimal::ONE, hkd),
            Err(FinanceError::CurrencyMismatch)
        );
        assert_eq!(
            per_share(usd, Decimal::ZERO, 2),
            Err(FinanceError::NonPositiveShares)
        );
    }
}
