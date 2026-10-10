import { expect, test, type Page } from "@playwright/test";
import { downloadPdf } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();
const card = (page: Page, id: string) => page.locator(`article[data-question="${id}"]`);

/** An AWS assessment with one crown jewel, on the data-protection questions the scan can answer. */
async function toControls(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Example Co");
  await next(page);
  await page.getByRole("checkbox", { name: /Amazon Web Services/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel: AWS data stores/ }).click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await page.getByRole("button", { name: /^Data protection/ }).click();
}

test("a Prowler scan pre-fills answers with per-resource counts, and the report names the scanner", async ({ page }) => {
  await toControls(page);

  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/prowler-aws.csv");
  const preview = page.getByTestId("scan-preview");
  await expect(preview).toContainText("Example Co");
  await expect(preview).toContainText("Prowler (AWS) 5.44.0");
  await expect(preview).toContainText("1 failing check crownguard has no question for");
  await preview.getByRole("button", { name: /^Apply \d+ answers?$/ }).click();
  await expect(page.getByText(/Imported \d+ answers? from the scan of Example Co/)).toBeVisible();

  // Two publicly accessible databases, no private ones: the check fails, so the answer is No.
  const data = card(page, "AWS-DATA-003");
  await expect(data.getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(data.getByTestId("evidence")).toContainText("2 of 2 resources failing");

  await page.getByRole("button", { name: /Report$/ }).click();
  const text = (await downloadPdf(page)).join("\n");
  expect(text).toMatch(/pre-filled from an automated Prowler \(AWS\) 5\.44\.0 scan of Example Co/);
  expect(text).toContain("Scan evidence (Prowler (AWS) 5.44.0, account 123456789012");
  expect(text).toContain("2 of 2 resources failing");
  expect(text).toContain("Prowler (AWS) 5.44.0.");
});

test("the same scan as JSON-OCSF gives the same answers", async ({ page }) => {
  await toControls(page);
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/prowler-aws.json");
  const preview = page.getByTestId("scan-preview");
  await expect(preview).toContainText("Prowler (AWS) 5.44.0");
  await preview.getByRole("button", { name: /^Apply \d+ answers?$/ }).click();
  await expect(card(page, "AWS-DATA-003").getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "AWS-DATA-003").getByTestId("evidence")).toContainText("2 of 2 resources failing");
});

test("a scan from a platform that isn't in scope explains why nothing was applied", async ({ page }) => {
  await toControls(page);
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/prowler-azure.json");
  await expect(page.getByRole("alert")).toContainText("This is a Prowler (Azure) scan.");
  await expect(page.getByRole("alert")).toContainText("so nothing was applied");
  await expect(page.getByTestId("scan-preview")).toHaveCount(0);
});
