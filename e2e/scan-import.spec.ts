import { expect, test, type Page } from "@playwright/test";
import { downloadPdf } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();
const card = (page: Page, id: string) => page.locator(`article[data-question="${id}"]`);

test("an M365-Secure scan pre-fills decisive answers with evidence, and the report says so", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Contoso Example");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  // Entra tenant + Exchange mailboxes, so identity, email and logging questions are in scope.
  for (const name of ["Microsoft Entra ID tenant", "Exchange Online mailboxes"]) {
    await page.getByRole("button", { name: new RegExp(`^Add crown jewel: ${name}`) }).click();
    await page.getByRole("button", { name: "Save crown jewel" }).click();
  }
  await next(page);

  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/m365-secure-scan.json");
  const preview = page.getByTestId("scan-preview");
  await expect(preview).toContainText("Contoso Example");
  await expect(preview).toContainText("1 other check in the scan doesn't map to a question");
  await preview.getByRole("checkbox", { name: /Set the licence tier to Microsoft 365 Business Premium/ }).check();
  await preview.getByRole("button", { name: /^Apply \d+ answers?$/ }).click();
  await expect(page.getByText(/Imported \d+ answers? from the scan of Contoso Example/)).toBeVisible();

  // MFA for all users: pass → Yes, with evidence.
  await expect(card(page, "MS-ID-001").getByRole("radio", { name: "Yes", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "MS-ID-001").getByTestId("evidence")).toContainText("M365-Secure suggests Yes");
  // Legacy auth: fail → No.
  await expect(card(page, "MS-ID-002").getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
  // Guest access: review only → left for the assessor, flagged.
  await expect(card(page, "MS-ID-008").getByTestId("evidence")).toContainText("couldn't decide");

  // Changing a pre-filled answer is allowed and noted.
  await card(page, "MS-ID-001").getByRole("radio", { name: "Partial", exact: true }).click();
  await expect(card(page, "MS-ID-001").getByTestId("evidence")).toContainText("You changed this from the scan's Yes");

  await page.getByRole("button", { name: /Report$/ }).click();
  const text = (await downloadPdf(page)).join("\n");
  expect(text).toMatch(/pre-filled from an automated M365-Secure scan of Contoso Example/);
  expect(text).toContain("Scan evidence (M365-Secure");
});

test("a file that isn't M365-Secure output is rejected", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("X");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/legacy.crownguard.json");
  await expect(page.getByText(/doesn't look like an M365-Secure results file/)).toBeVisible();
});
