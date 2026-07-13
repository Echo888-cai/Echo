import { expect, test } from "@playwright/test";

test("research → follow → portfolio → notification works through the final stack", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /喧声之外/ })).toBeVisible();

  const composer = page.getByRole("textbox", { name: /输入公司名/ });
  await composer.fill("0700.HK 最近怎么样？");
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("核心判断", { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "看盘", exact: true }).click();
  await expect(page).toHaveURL(/\/watch/);
  await expect(page.getByRole("heading", { name: "腾讯控股", exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "＋ 添加" }).click();
  await page.getByPlaceholder(/公司名或代码/).fill("0700.HK");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByPlaceholder(/公司名或代码/)).toBeHidden();

  await page.getByRole("link", { name: "持仓", exact: true }).click();
  await page.getByRole("button", { name: "＋ 记一笔持仓" }).click();
  await page.getByLabel("股票代码").fill("0700.HK");
  await page.getByLabel("公司名称").fill("腾讯控股");
  await page.getByLabel("持有股数").fill("100");
  await page.getByLabel("平均成本").fill("420");
  await page.getByLabel("止损线").fill("350");
  await page.getByRole("button", { name: "保存持仓" }).click();
  await expect(page.getByRole("heading", { name: "1 笔持仓" })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("heading", { name: "离线与桌面安装" })).toBeVisible();
  await expect(page.getByText("Temporal", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "发送测试通知" }).click();
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await expect(page.getByText("通知通道测试", { exact: true })).toBeVisible();
});

test("375px and dark theme remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "切换深色 / 浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("textbox", { name: /输入公司名/ })).toBeVisible();
});
