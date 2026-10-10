import { expect, test } from "@playwright/test";

const next = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Next:/ }).click();

test("SOC maturity answers work like radio buttons from the keyboard, and each step keeps its own place", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  // Controls: open a later section, then move on.
  const sections = page.getByRole("button", { name: /\d+\/\d+$/ });
  await sections.nth(1).click();
  const controlsSection = (await sections.nth(1).textContent())!.replace(/\d+\/\d+$/, "").trim();
  await next(page);

  await page.getByRole("button", { name: "Include SOC maturity in this report" }).click();
  // Focus lands on the first question of the step.
  await expect(page.getByRole("radiogroup", { name: "Who runs your security operations?" }).getByRole("radio").first()).toBeFocused();

  const group = page.locator("article[data-soc-question]").first().getByRole("radiogroup");
  await group.getByRole("radio", { name: /^1 / }).click();
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: /^2 / })).toBeFocused();
  await expect(group.getByRole("radio", { name: /^2 / })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("End");
  await expect(group.getByRole("radio", { name: "Unknown" })).toHaveAttribute("aria-checked", "true");
  // Only the checked option is a tab stop.
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);

  // Pick another SOC domain, go back to Controls: it reopens the section left there.
  await page.getByRole("navigation", { name: "SOC maturity domains" }).getByRole("button", { name: /^People/ }).click();
  await page.getByRole("button", { name: /Back$/ }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${controlsSection}`) })).toHaveAttribute("aria-current", "true");
  await next(page);
  await expect(page.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
});
