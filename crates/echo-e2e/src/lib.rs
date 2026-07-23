//! 真实浏览器验收。先启动 `echo-api` 与 `trunk serve`，再启动 chromedriver/geckodriver，
//! 用 `cargo test -p echo-e2e -- --ignored` 执行；没有驱动时默认不阻塞普通 Rust CI。

#[cfg(test)]
mod tests {
    use fantoccini::{ClientBuilder, Locator};

    #[tokio::test]
    #[ignore = "需要运行中的 WebDriver(127.0.0.1:4444)、echo-api 与 trunk serve"]
    async fn research_library_settings_core_flow() -> Result<(), Box<dyn std::error::Error>> {
        let client = ClientBuilder::rustls()?
            .connect("http://127.0.0.1:4444")
            .await?;
        client.goto("http://127.0.0.1:5191/").await?;
        client
            .find(Locator::Css("textarea[placeholder*='想研究什么']"))
            .await?
            .send_keys("AAPL 的估值判断")
            .await?;
        client
            .find(Locator::Css("input[placeholder*='研究对象']"))
            .await?
            .send_keys("AAPL")
            .await?;
        client
            .find(Locator::Css("button.composer-send"))
            .await?
            .click()
            .await?;
        client.find(Locator::Css(".answer-card")).await?;
        // 发送后研究对象保持确认态（chip 常驻），追问不需要重填公司。
        client.find(Locator::Css(".company-chip")).await?;
        client
            .find(Locator::XPath("//button[normalize-space()='资料库']"))
            .await?
            .click()
            .await?;
        client
            .find(Locator::Css("input[placeholder*='Ticker']"))
            .await?;
        client
            .find(Locator::XPath("//button[normalize-space()='持仓']"))
            .await?
            .click()
            .await?;
        client
            .find(Locator::Css("input[placeholder='平均成本']"))
            .await?;
        client
            .find(Locator::XPath("//button[normalize-space()='设置']"))
            .await?
            .click()
            .await?;
        client.find(Locator::Css(".settings-card")).await?;
        client.close().await?;
        Ok(())
    }
}
