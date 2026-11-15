import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { chooseImportFiles, rejectScanBeforeRead, releaseImport } from "./import-files";
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


async function toScanStep(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Import boundaries");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel: Microsoft Entra ID tenant/ }).click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
}
const assessmentSnapshot = (page: Page) => page.evaluate(() => localStorage.getItem("crownguard:v1"));
const scanFixture = () => readFile("e2e/fixtures/m365-secure-scan.json", "utf8");

test("scan limit rejection clears old Apply, preserves assessment/recovery and permits keyboard retry", async ({ page }) => {
  await toScanStep(page);
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/m365-secure-scan.json");
  await page.getByTestId("scan-preview").getByRole("button", { name: /^Apply/ }).click();
  await card(page, "MS-ID-001").getByRole("radio", { name: "Partial", exact: true }).click();
  const before = await assessmentSnapshot(page);
  expect(JSON.parse(before!).state.assessment.imports).toHaveLength(1);
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/m365-secure-scan.json");
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await rejectScanBeforeRead(page);
  expect((await new AxeBuilder({ page }).include('[aria-label="Import automated scan results"]').analyze()).violations).toEqual([]);
  expect(await assessmentSnapshot(page)).toBe(before);
  await expect(page.getByTestId("scan-input")).toHaveValue("");
  // Cancelling the picker cannot alter the assessment.
  await page.getByTestId("scan-input").setInputFiles([]);
  expect(await assessmentSnapshot(page)).toBe(before);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import another scan" }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles("e2e/fixtures/m365-secure-scan.json");
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await page.getByTestId("scan-preview").getByLabel("Use the scan's answers").check();
  await page.getByTestId("scan-preview").getByRole("button", { name: /^Apply/ }).click();
  const saved = JSON.parse((await assessmentSnapshot(page))!).state.assessment;
  expect(saved.imports).toHaveLength(2);
  expect(saved.answers["MS-ID-001"]).toBe("yes");
  await expect(page.getByTestId("scan-preview")).toHaveCount(0);
});

test("scan pending reads cannot resurrect rejected previews or overwrite a newer success", async ({ page }) => {
  await toScanStep(page);
  const text = await scanFixture();
  await chooseImportFiles(page, "scan-input", [{ name: "slow-valid", text, deferred: true }]);
  await rejectScanBeforeRead(page);
  await releaseImport(page, "slow-valid");
  await expect(page.getByRole("alert")).toContainText("8 MB");
  await expect(page.getByTestId("scan-preview")).toHaveCount(0);
  await chooseImportFiles(page, "scan-input", [{ name: "slow-failure", text, deferred: true }]);
  await chooseImportFiles(page, "scan-input", [{ name: "new-valid", text }]);
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await releaseImport(page, "slow-failure", true);
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("scan pending reads discard changed assessments and unmounted panels", async ({ page }) => {
  await toScanStep(page);
  const text = await scanFixture();
  await chooseImportFiles(page, "scan-input", [{ name: "changed", text, deferred: true }]);
  await card(page, "MS-ID-001").getByRole("radio", { name: "No", exact: true }).click();
  const before = await assessmentSnapshot(page);
  await releaseImport(page, "changed");
  await expect(page.getByRole("alert")).toContainText("assessment changed while reading");
  await expect(page.getByTestId("scan-preview")).toHaveCount(0);
  expect(await assessmentSnapshot(page)).toBe(before);
  await chooseImportFiles(page, "scan-input", [{ name: "unmounted", text, deferred: true }]);
  await page.getByRole("button", { name: /Back$/ }).click();
  await next(page);
  await releaseImport(page, "unmounted");
  await expect(page.getByTestId("scan-preview")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
