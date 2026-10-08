import { expect, test } from "@playwright/test";

test("every step fits a 390px phone screen without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const noOverflow = async (name: string) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, name).toBeLessThanOrEqual(390);
  };
  await page.goto("/");
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
  await noOverflow("review");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await noOverflow("brand");
  await page.getByRole("button", { name: /^Next:/ }).click();
  await noOverflow("report");
});
