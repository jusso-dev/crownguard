import { expect, test } from "@playwright/test";

const primaryHex = (page: import("@playwright/test").Page) => page.getByLabel("Primary colour", { exact: true });

test("colours can be typed as hex codes, and bad codes are rejected", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("import-input").setInputFiles("e2e/fixtures/branded.crownguard.json");
  await expect(page.getByRole("heading", { name: "Brand the report" })).toBeVisible();

  await primaryHex(page).fill("#0b5");
  await primaryHex(page).blur();
  await expect(primaryHex(page)).toHaveValue("#00BB55");
  await expect(page.getByLabel("Primary colour picker")).toHaveValue("#00bb55");

  await primaryHex(page).fill("#12");
  await primaryHex(page).blur();
  await expect(page.getByText("Use a hex code like #0B5D4B or #0B5.")).toBeVisible();
  await expect(page.getByLabel("Primary colour picker")).toHaveValue("#00bb55");
});

test("reopening a saved file restores its colours, and a new logo doesn't overwrite them", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("import-input").setInputFiles("e2e/fixtures/branded.crownguard.json");
  await expect(primaryHex(page)).toHaveValue("#7A1F5C");
  await expect(page.getByLabel("Accent colour", { exact: true })).toHaveValue("#E0A100");

  await page.getByTestId("logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await expect(page.getByText("Kept your report colours.")).toBeVisible();
  await expect(primaryHex(page)).toHaveValue("#7A1F5C");

  await page.getByRole("button", { name: "Use logo colours" }).click();
  await expect(primaryHex(page)).not.toHaveValue("#7A1F5C");
});

test("on a new assessment the logo sets the colours automatically", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Organisation name").fill("Fresh Co");
  await page.getByTestId("org-logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await expect(page.getByAltText("Current logo")).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("crownguard:v1")!).state.assessment.branding.primary);
  expect(stored).not.toBe("#1f3a5f");
});
