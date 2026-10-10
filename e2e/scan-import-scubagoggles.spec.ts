import { expect, test, type Page } from "@playwright/test";
import { downloadPdf } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();
const card = (page: Page, id: string) => page.locator(`article[data-question="${id}"]`);
const BREAK_GLASS = "break.glass.admin@example.com";

/** A Google assessment with one Gmail crown jewel, on the questions the scan can answer. */
async function toControls(page: Page) {
  await page.goto("./");
  await page.getByLabel("Organisation name").fill("Example Co");
  await next(page);
  await page.getByRole("checkbox", { name: /Google Workspace/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel: Gmail mailboxes/ }).click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await page.getByRole("navigation", { name: "Control sections" }).getByRole("button", { name: /^Gmail/ }).click();
}

test("a ScubaGoggles report pre-fills Google answers, and the report names the scanner", async ({ page }) => {
  await toControls(page);

  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/ScubaResults.json");
  const preview = page.getByTestId("scan-preview");
  await expect(preview).toContainText("ScubaGoggles 1.0.1");
  await expect(preview).toContainText("example.com");
  await expect(preview).toContainText("1 failing check crownguard has no question for");
  await preview.getByRole("button", { name: /^Apply \d+ answers?$/ }).click();
  await expect(page.getByText(/Imported \d+ answers? from the scan of example\.com/)).toBeVisible();

  // DMARC is at p=none where the control wants p=reject: the check fails, so the answer is No.
  const auth = card(page, "GO-GML-001");
  await expect(auth.getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(auth.getByTestId("evidence")).toContainText("GWS.GMAIL.4.2v1 (Gmail, shall)");

  await page.getByRole("button", { name: /Report$/ }).click();
  const text = (await downloadPdf(page)).join("\n");
  expect(text).toMatch(/pre-filled from an automated ScubaGoggles 1\.0\.1 scan of example\.com/);
  expect(text).toContain("Scan evidence (ScubaGoggles 1.0.1");
  expect(text).toContain("GWS.GMAIL.4.2v1 (Gmail, shall)");

  // Nothing from the report's Raw section (super admin and break-glass accounts) survives.
  expect(text).not.toContain(BREAK_GLASS);
  const stored = await page.evaluate(() => Object.values(localStorage).join("\n"));
  expect(stored).not.toContain(BREAK_GLASS);
});

test("a ScubaGear (Microsoft 365) report is refused with a plain message", async ({ page }) => {
  await toControls(page);
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/ScubaResults-scubagear.json");
  await expect(page.getByRole("alert")).toContainText("ScubaGear report for Microsoft 365");
  await expect(page.getByRole("alert")).toContainText("ScubaGoggles reports for Google Workspace");
  await expect(page.getByTestId("scan-preview")).toHaveCount(0);
});
