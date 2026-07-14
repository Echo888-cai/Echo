use echo_finance_core::{
    Currency, Money, equity_value_from_multiple, multiply, per_share, ratio, subtract,
    surprise_percent,
};
use napi::{Error, Result, Status};
use napi_derive::napi;
use rust_decimal::Decimal;
use std::str::FromStr;

fn decimal(value: &str, label: &str) -> Result<Decimal> {
    Decimal::from_str(value).map_err(|_| {
        Error::new(
            Status::InvalidArg,
            format!("{label} must be a decimal string"),
        )
    })
}

fn currency(value: &str) -> Result<Currency> {
    match value.to_ascii_uppercase().as_str() {
        "CNY" => Ok(Currency::Cny),
        "HKD" => Ok(Currency::Hkd),
        "USD" => Ok(Currency::Usd),
        _ => Err(Error::new(
            Status::InvalidArg,
            "currency must be CNY, HKD or USD",
        )),
    }
}

fn finance_error(error: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

#[napi(object)]
pub struct NativeMoney {
    pub amount: String,
    pub currency: String,
}

#[napi]
pub fn surprise_percent_decimal(actual: String, estimate: String) -> Result<Option<String>> {
    surprise_percent(decimal(&actual, "actual")?, decimal(&estimate, "estimate")?)
        .map(|value| value.map(|number| number.normalize().to_string()))
        .map_err(finance_error)
}

#[napi]
pub fn equity_value_from_multiple_decimal(
    metric: String,
    multiple: String,
    net_cash: String,
    currency_code: String,
) -> Result<NativeMoney> {
    let unit = currency(&currency_code)?;
    let value = equity_value_from_multiple(
        Money::new(decimal(&metric, "metric")?, unit),
        decimal(&multiple, "multiple")?,
        Money::new(decimal(&net_cash, "netCash")?, unit),
    )
    .map_err(finance_error)?;
    Ok(NativeMoney {
        amount: value.amount().normalize().to_string(),
        currency: currency_code.to_ascii_uppercase(),
    })
}

#[napi]
pub fn multiply_decimal(value: String, factor: String, currency_code: String) -> Result<NativeMoney> {
    let unit = currency(&currency_code)?;
    let result = multiply(
        Money::new(decimal(&value, "value")?, unit),
        decimal(&factor, "factor")?,
    )
    .map_err(finance_error)?;
    Ok(NativeMoney {
        amount: result.amount().normalize().to_string(),
        currency: currency_code.to_ascii_uppercase(),
    })
}

#[napi]
pub fn subtract_decimal(a: String, b: String, currency_code: String) -> Result<NativeMoney> {
    let unit = currency(&currency_code)?;
    let result = subtract(
        Money::new(decimal(&a, "a")?, unit),
        Money::new(decimal(&b, "b")?, unit),
    )
    .map_err(finance_error)?;
    Ok(NativeMoney {
        amount: result.amount().normalize().to_string(),
        currency: currency_code.to_ascii_uppercase(),
    })
}

#[napi]
pub fn ratio_decimal(
    numerator: String,
    denominator: String,
    currency_code: String,
) -> Result<Option<String>> {
    let unit = currency(&currency_code)?;
    ratio(
        Money::new(decimal(&numerator, "numerator")?, unit),
        Money::new(decimal(&denominator, "denominator")?, unit),
    )
    .map(|value| value.map(|number| number.normalize().to_string()))
    .map_err(finance_error)
}

#[napi]
pub fn per_share_decimal(
    equity_value: String,
    diluted_shares: String,
    decimal_places: u32,
    currency_code: String,
) -> Result<NativeMoney> {
    let value = per_share(
        Money::new(
            decimal(&equity_value, "equityValue")?,
            currency(&currency_code)?,
        ),
        decimal(&diluted_shares, "dilutedShares")?,
        decimal_places,
    )
    .map_err(finance_error)?;
    Ok(NativeMoney {
        amount: value.amount().normalize().to_string(),
        currency: currency_code.to_ascii_uppercase(),
    })
}
