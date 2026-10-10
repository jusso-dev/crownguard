import { expect, test } from "@playwright/test";

test("every step fits a 390px phone screen without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const noOverflow = async (name: string) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, name).toBeLessThanOrEqual(390);
  };
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await noOverflow("start");
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await noOverflow("org");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await noOverflow("env");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await noOverflow("jewels");
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await page.getByRole("button", { name: /^Next:/ }).click();
  await page.locator("article[data-question] details").first().click();
  await noOverflow("controls");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await noOverflow("soc intro");
  await page.getByRole("button", { name: "Include SOC maturity in this report" }).click();
  await page.locator("article[data-soc-question] details").first().click();
  await noOverflow("soc");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await noOverflow("review");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await noOverflow("brand");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await noOverflow("report");
});
