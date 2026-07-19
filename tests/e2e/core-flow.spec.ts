import { expect, test } from "@playwright/test";

test("research → follow → portfolio → notification works through the final stack", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /让每一个判断/ })).toBeVisible();

  const composer = page.getByRole("textbox", { name: /输入公司名/ });
  await composer.fill("0700.HK 最近怎么样？");
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "发送" }).click();
  // Direct questions intentionally render a concise answer without forcing a
  // report-style "结论" heading. Assert the actual answer surface and subject,
  // so E2E protects completion without undoing depth-aware intent routing.
  await expect(page.locator(".answer-card")).toContainText("腾讯控股", { timeout: 20_000 });

  // Research uses a distraction-free sidebar on desktop (the global topbar is
  // intentionally absent there), so cross-surface E2E enters the watch route
  // directly. Watch/portfolio/settings retain the global navigation.
  await page.goto("/watch");
  await expect(page).toHaveURL(/\/watch/);
  const emptyAdd = page.getByRole("button", { name: /直接添加代码关注/ });
  const headerAdd = page.getByRole("button", { name: "＋ 添加" });
  await expect(emptyAdd.or(headerAdd)).toBeVisible({ timeout: 10_000 });
  if (await emptyAdd.isVisible()) await emptyAdd.click();
  else await headerAdd.click();
  await page.getByPlaceholder(/公司名或代码/).fill("0700.HK");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByPlaceholder(/公司名或代码/)).toBeHidden();
  await expect(page.locator(".wd-ticker", { hasText: "0700.HK" })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: "持仓", exact: true }).click();
  await page.getByRole("button", { name: "＋ 记一笔持仓" }).click();
  await page.getByLabel("股票代码").fill("0700.HK");
  await page.getByLabel("公司名称").fill("腾讯控股");
  await page.getByLabel("持有股数").fill("100");
  await page.getByLabel("平均成本").fill("420");
  await page.getByLabel("止损线").fill("350");
  await page.getByRole("button", { name: "保存持仓" }).click();
  await expect(page.getByRole("heading", { name: "1 笔持仓" })).toBeVisible({ timeout: 10_000 });

  // 删除闭环：移出关注/删除持仓 → 刷新 → 不复活（回归 watchDesk 复活 bug）。
  await page.getByRole("link", { name: "看盘", exact: true }).click();
  await expect(page).toHaveURL(/\/watch/);
  await expect(page.locator(".wd-ticker", { hasText: "0700.HK" })).toBeVisible({ timeout: 10_000 });
  // Scope to 0700.HK's own card: the desk is watchlist ∪ 持仓 ∪ 公司画像, so any
  // extra researched company puts another 移出关注 button on the page and an
  // unscoped locator dies on strict mode — and would remove the wrong company.
  const tencentCard = page.locator(".wl-item", { has: page.locator(".wd-ticker", { hasText: "0700.HK" }) });
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("watch.untrack") && res.ok()),
    tencentCard.getByRole("button", { name: /移出关注/ }).click()
  ]);
  await page.reload();
  await expect(page.locator(".wd-ticker", { hasText: "0700.HK" })).not.toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "持仓", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1 笔持仓" })).toBeVisible({ timeout: 10_000 });
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("portfolio.remove") && res.ok()),
    page.getByRole("button", { name: "删除持仓" }).click()
  ]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 笔持仓" })).not.toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("heading", { name: "离线与桌面安装" })).toBeVisible();
  await expect(page.getByText("Temporal", { exact: true })).toBeVisible();
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
