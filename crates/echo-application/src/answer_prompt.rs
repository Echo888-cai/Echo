//! 作答提示词构造——从领域事实拼出 system 红线 + user 事实块，喂给模型网关生成答案。
//!
//! 作答纪律集中在这里：不编数字、缺就说「未核到」、无实时财报禁给具体财务数字、不提买卖建议。
//! 同业对照、网页证据、回购与对比研究都通过结构化事实块显式接入。
//!
//! 全是纯函数（事实进、字符串出），不碰网络/时钟，可离线单测每条红线分支。

use crate::DecisionPanel;
use echo_domain::{Filing, Financials, MarketSnapshot};
use rust_decimal::Decimal;

/// 作答上下文——本请求这一家公司的全部已核事实（单一主体，无跨公司泄漏面）。
pub struct AnswerContext<'a> {
    pub question: &'a str,
    pub name_zh: Option<&'a str>,
    pub panel: &'a DecisionPanel,
    pub market: &'a MarketSnapshot,
    pub financials: &'a Financials,
    pub filings: &'a [Filing],
}

/// 固定的 system 红线——研究助手人设 + 不可逾越的护栏。与 composer 的 system 段同义：
/// 不构成投资建议、不提买卖、缺数说「未核到」、财务数字只能引用已核到的实时财报、不编造。
#[must_use]
pub fn build_system_prompt() -> String {
    [
        "你是严谨的股票研究助手，只做美股与港股科技股的基本面研究。铁律：",
        "· 以下内容仅供分析参考，不构成投资建议，绝不给出任何买入/卖出/加减仓指令。",
        "· 凡收入/利润/利润率/现金流/EPS/回购分红的具体数字，只能引用下面「已核到的实时财报」块；本地印象/常识一律不得当作财务数字来源，标注「约」「大约」「行业常见范围」也不行。",
        "· 任一数据缺失就明说「当前未核到/来源缺失」，置信度下降，但可继续给定性推断。",
        "· 不用「暂不评分」「完整度xx%」这类产品状态词，改用研究语言（未核到、置信度下降）。",
    ]
    .join("\n")
}

/// 把一个可选定点数渲染成事实行的值；缺就「未核到」。
fn field(value: Option<Decimal>, unit: &str) -> String {
    match value {
        Some(v) => format!("{v}{unit}"),
        None => "未核到".to_string(),
    }
}

/// 估值区间事实行——给不出可信带子（`cannot_value_reason`）时如实说未核到，绝不硬凑数字。
fn valuation_line(panel: &DecisionPanel) -> String {
    let v = &panel.valuation;
    if !v.is_valued() {
        let reason = v.cannot_value_reason.as_deref().unwrap_or("数据不足");
        return format!("估值区间：未核到（{reason}）");
    }
    let bear = field(v.bear, "");
    let base = field(v.base, "");
    let bull = field(v.bull, "");
    let upside = v.upside.as_deref().unwrap_or("未核到");
    format!(
        "估值区间（{}）：熊 {bear} / 基准 {base} / 牛 {bull}；相对现价空间 {upside}",
        v.method
    )
}

/// user 提示词：本公司的事实块 + 随实时财报有无切换的数字纪律。`provider_ok=false` 时**硬性禁止**
/// 任何具体财务数字（对齐 composer 里 `hasLiveFin` 为假的分支——研究质量病灶的封堵点）。
#[must_use]
pub fn build_user_prompt(ctx: &AnswerContext) -> String {
    let name = ctx.name_zh.unwrap_or(&ctx.panel.ticker);
    let has_live_fin = ctx.financials.provider_ok;

    let mut out = String::new();
    out.push_str(&format!("研究对象：{name}（{}）\n", ctx.panel.ticker));
    out.push_str(&format!("用户问题：{}\n\n", ctx.question));

    out.push_str("== 已核到的事实（只用这些数字）==\n");
    out.push_str(&format!("现价：{}\n", field(ctx.market.price, "")));
    out.push_str(&valuation_line(ctx.panel));
    out.push('\n');
    out.push_str(&format!(
        "连通数据源：{}\n",
        if ctx.panel.connected_sources.is_empty() {
            "无（本轮多为定性判断）".to_string()
        } else {
            ctx.panel.connected_sources.join("、")
        }
    ));

    if has_live_fin {
        out.push_str("\n== 已核到的实时财报（财务数字只能引用这里）==\n");
        let cur = ctx.financials.currency.as_deref().unwrap_or("");
        out.push_str(&format!("营收：{}\n", field(ctx.financials.revenue, cur)));
        out.push_str(&format!(
            "净利润：{}\n",
            field(ctx.financials.net_income, cur)
        ));
        out.push_str(&format!("EPS：{}\n", field(ctx.financials.eps, "")));
        out.push_str(&format!(
            "净利率：{}\n",
            field(ctx.financials.net_margin, "%")
        ));
        out.push_str(&format!(
            "毛利率：{}\n",
            field(ctx.financials.gross_margin, "%")
        ));
        out.push_str(&format!(
            "自由现金流：{}\n",
            field(ctx.financials.free_cash_flow, cur)
        ));
        out.push_str(
            "\n本轮有实时财报：必须用上面的真实数字支撑财务判断，不要再写「未核到完整三表」。",
        );
    } else {
        out.push_str(
            "\n本轮无实时财报：严禁给出任何具体财务数字或其估算值（收入/利润/EPS/利润率/现金流的\n\
             绝对值，以及「约」「大约」「行业常见范围」这类措辞都不行），只能定性描述赚钱机制与\n\
             风险并说明置信度下降；要数字就明说「需核最新财报」。",
        );
    }

    if let Some(hv) = &ctx.financials.historical_valuation {
        out.push_str("\n\n== 已核到的历史估值分位（近5年月度PE，仅美股）==\n");
        out.push_str(&format!("当前分位：{}\n", field(hv.percentile, "%")));
        out.push_str(&format!(
            "历史区间：{} ~ {}（中位 {}）\n",
            field(hv.min, "x"),
            field(hv.max, "x"),
            field(hv.median, "x")
        ));
    }

    if !ctx.filings.is_empty() {
        out.push_str("\n\n== 已核到的最新公司公告（SEC filings，可引用表单类型与日期）==\n");
        for filing in ctx.filings {
            let date = filing.filed_date.as_deref().unwrap_or("未核到日期");
            out.push_str(&format!(
                "{} · {date} · {}\n",
                filing.form, filing.source_url
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DecisionPanel, ResolvedCompany};
    use echo_domain::{Company, MarketSnapshot, display_valuation};
    use rust_decimal_macros::dec;

    fn panel_with(price: Option<Decimal>, provider_ok: bool) -> (DecisionPanel, Financials) {
        let company = ResolvedCompany {
            ticker: "AAPL".into(),
            name_zh: Some("苹果".into()),
            company: Company {
                price,
                ..Default::default()
            },
        };
        let market = MarketSnapshot {
            price,
            ..Default::default()
        };
        let financials = Financials {
            provider_ok,
            revenue: provider_ok.then(|| dec!(383000)),
            net_income: provider_ok.then(|| dec!(97000)),
            eps: provider_ok.then(|| dec!(6.13)),
            currency: Some("USD".into()),
            ..Default::default()
        };
        let valuation = display_valuation(&company.company, &market, &financials, None);
        let panel = crate::build_panel(&company, &market, &financials, None, &[]);
        let _ = valuation;
        (panel, financials)
    }

    #[test]
    fn system_prompt_states_no_trade_advice() {
        let sys = build_system_prompt();
        assert!(sys.contains("不构成投资建议"));
        assert!(sys.contains("买入/卖出"));
    }

    #[test]
    fn no_live_financials_forbids_concrete_numbers() {
        let (panel, financials) = panel_with(Some(dec!(190)), false);
        let market = MarketSnapshot {
            price: Some(dec!(190)),
            ..Default::default()
        };
        let prompt = build_user_prompt(&AnswerContext {
            question: "苹果现在贵不贵？",
            name_zh: Some("苹果"),
            panel: &panel,
            market: &market,
            financials: &financials,
            filings: &[],
        });
        assert!(prompt.contains("严禁给出任何具体财务数字"));
        assert!(!prompt.contains("已核到的实时财报"));
        assert!(prompt.contains("研究对象：苹果（AAPL）"));
    }

    #[test]
    fn live_financials_block_appears_and_lifts_ban() {
        let (panel, financials) = panel_with(Some(dec!(190)), true);
        let market = MarketSnapshot {
            price: Some(dec!(190)),
            ..Default::default()
        };
        let prompt = build_user_prompt(&AnswerContext {
            question: "苹果利润质量如何？",
            name_zh: Some("苹果"),
            panel: &panel,
            market: &market,
            financials: &financials,
            filings: &[],
        });
        assert!(prompt.contains("已核到的实时财报"));
        assert!(prompt.contains("383000USD"));
        assert!(prompt.contains("必须用上面的真实数字"));
        assert!(!prompt.contains("严禁给出任何具体财务数字"));
    }

    #[test]
    fn missing_price_renders_unverified_not_zero() {
        let (panel, financials) = panel_with(None, false);
        let market = MarketSnapshot::default();
        let prompt = build_user_prompt(&AnswerContext {
            question: "现价多少？",
            name_zh: None,
            panel: &panel,
            market: &market,
            financials: &financials,
            filings: &[],
        });
        assert!(prompt.contains("现价：未核到"));
    }

    #[test]
    fn filings_block_cites_form_and_source_url() {
        let (panel, financials) = panel_with(Some(dec!(190)), false);
        let market = MarketSnapshot {
            price: Some(dec!(190)),
            ..Default::default()
        };
        let filings = vec![Filing {
            form: "10-K".into(),
            filed_date: Some("2026-05-01".into()),
            source_url: "https://www.sec.gov/example".into(),
        }];
        let prompt = build_user_prompt(&AnswerContext {
            question: "最近有什么公告？",
            name_zh: Some("苹果"),
            panel: &panel,
            market: &market,
            financials: &financials,
            filings: &filings,
        });
        assert!(prompt.contains("已核到的最新公司公告"));
        assert!(prompt.contains("10-K"));
        assert!(prompt.contains("2026-05-01"));
        assert!(prompt.contains("https://www.sec.gov/example"));
    }

    #[test]
    fn empty_filings_omit_the_block() {
        let (panel, financials) = panel_with(Some(dec!(190)), false);
        let market = MarketSnapshot {
            price: Some(dec!(190)),
            ..Default::default()
        };
        let prompt = build_user_prompt(&AnswerContext {
            question: "最近有什么公告？",
            name_zh: Some("苹果"),
            panel: &panel,
            market: &market,
            financials: &financials,
            filings: &[],
        });
        assert!(!prompt.contains("已核到的最新公司公告"));
    }
}
