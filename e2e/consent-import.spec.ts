import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();
const app = (page: Page, name: string) => page.locator(`[data-testid="found-app"][data-app="${name}"]`);

/** Organisation, one platform and one crown jewel, then walk to the AI register step. */
async function toAiStep(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await next(page);
  await next(page);
  await expect(page.getByRole("heading", { name: "Which AI tools and agents do you use?" })).toBeVisible();
}

/** Watch for any request leaving the app's origin, like e2e/privacy.spec.ts does. */
function watchOrigin(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const external: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url).origin !== origin) external.push(url);
  });
  return external;
}

test("a Microsoft Graph consent export sorts the apps into known AI, high-reach and other, with the right consent types", async ({ page, baseURL }) => {
  const external = watchOrigin(page, baseURL!);
  await toAiStep(page);
  await expect(page.getByTestId("consent-privacy")).toContainText("They list the user names and email addresses of everyone who granted consent");

  await page.getByTestId("consent-input").setInputFiles("e2e/fixtures/consent-graph.json");
  const preview = page.getByTestId("consent-preview");
  await expect(preview).toContainText("Microsoft consent export: 3 apps from 5 consent grants, given by 3 users");

  // Known AI: a note-taker, with per-user consent.
  const known = page.getByTestId("found-group-known");
  await expect(known).toContainText("Known AI");
  await expect(app(page, "Fathom Meeting Assistant")).toContainText("Meeting note-taker");
  await expect(app(page, "Fathom Meeting Assistant")).toContainText("Fathom Video");
  await expect(app(page, "Fathom Meeting Assistant")).toContainText("User consent from 3 users");
  await expect(app(page, "Fathom Meeting Assistant")).toContainText("Read everyone's calendars");

  // High-reach but not AI: an admin-consented backup tool.
  await expect(page.getByTestId("found-group-high")).toContainText("High-reach, not known AI");
  await expect(app(page, "Contoso Backup Tool")).toContainText("Admin consent for everyone in the tenant");
  await expect(app(page, "Contoso Backup Tool")).toContainText("Read all email in every mailbox");

  // Low-reach leftovers.
  await expect(page.getByTestId("found-group-other")).toContainText("Weather Add-in");
  await expect(app(page, "Weather Add-in")).toContainText("User consent from 1 user");
  expect(external).toEqual([]);
});

test("Add to AI register creates an ai-connector entry with product, access and data filled and no answers, and the save keeps no names", async ({ page, baseURL }) => {
  // Download the save rather than the browser's native save dialog, which can't be driven from a test.
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const external = watchOrigin(page, baseURL!);
  await toAiStep(page);
  await page.getByTestId("consent-input").setInputFiles("e2e/fixtures/consent-graph.json");
  await expect(page.getByTestId("consent-preview")).toBeVisible();

  await page.getByRole("button", { name: "Add to AI register: Fathom Meeting Assistant" }).click();
  await expect(page.getByTestId("consent-done")).toContainText("added to the AI use-case register as a third-party AI connector");
  await page.getByRole("button", { name: "Add to AI register: Contoso Backup Tool" }).click();
  await expect(app(page, "Fathom Meeting Assistant").getByTestId("found-added")).toBeVisible();

  // Per-user consent becomes "acts as the signed-in user"; admin consent becomes organisation-wide.
  const entries = page.getByRole("navigation", { name: "AI use cases" });
  await entries.getByRole("button", { name: "Fathom Meeting Assistant" }).click();
  const fathom = page.locator("[data-ai-entry]");
  await expect(fathom.getByText("Third-party AI connector or OAuth app")).toBeVisible();
  await expect(fathom.getByTestId("ai-found-by")).toContainText("Found by import · Microsoft consent inventory import");
  await expect(fathom.getByLabel("Underpinning product")).toHaveValue("Fathom Meeting Assistant");
  await expect(fathom.getByRole("radiogroup", { name: "Access level" }).getByRole("radio", { name: "Acts as the signed-in user" })).toHaveAttribute("aria-checked", "true");
  await expect(fathom.getByRole("checkbox", { name: /^Internal or OFFICIAL/ })).toBeChecked();
  await expect(fathom.getByRole("checkbox", { name: /^Personal information/ })).toBeChecked();
  // Every readiness question is left unanswered.
  await expect(fathom.getByText(/^0 of \d+ answered$/)).toBeVisible();
  await expect(fathom.locator('article[data-ai-question] [role="radio"][aria-checked="true"]')).toHaveCount(0);

  await entries.getByRole("button", { name: "Contoso Backup Tool" }).click();
  const backup = page.locator("[data-ai-entry]");
  await expect(backup.getByRole("radiogroup", { name: "Access level" }).getByRole("radio", { name: "Its own access, organisation-wide" })).toHaveAttribute("aria-checked", "true");
  await expect(backup.getByText(/^0 of \d+ answered$/)).toBeVisible();

  // What's saved carries the register entry's needs and no user names or email addresses.
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file" }).click();
  const saved = (await readFile(await (await dl).path())).toString("utf8");
  expect(saved).toContain("Contoso Backup Tool");
  expect(saved).toContain("Microsoft consent inventory import");
  expect(saved).not.toContain("@");
  expect(saved).not.toContain("ana.ivanovic");
  expect(saved).not.toContain("contoso.example");
  expect(external).toEqual([]);
});

test("a Google OAuth log export does the same and flags grants made by an agent", async ({ page, baseURL }) => {
  const external = watchOrigin(page, baseURL!);
  await toAiStep(page);
  await page.getByTestId("consent-input").setInputFiles("e2e/fixtures/consent-google-oauth.csv");
  const preview = page.getByTestId("consent-preview");
  await expect(preview).toContainText("Google OAuth log export: 3 apps from 5 consent grants, given by 3 users");
  await expect(preview).toContainText("By an agent");

  await expect(app(page, "Fathom Meeting Assistant")).toContainText("Meeting note-taker");
  await expect(app(page, "Fathom Meeting Assistant")).toContainText("User consent from 2 users");
  await expect(app(page, "Fathom Meeting Assistant").getByTestId("by-agent")).toBeVisible();
  await expect(page.getByTestId("found-group-high")).toContainText("Contoso Backup Tool");
  await expect(app(page, "Contoso Backup Tool")).toContainText("Read all email in Gmail");
  await expect(page.getByTestId("found-group-other")).toContainText("Weather Add-in");
  await expect(app(page, "Weather Add-in").getByTestId("by-agent")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("the app-consent section links to the found apps panel on the AI register step", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await page.getByRole("navigation", { name: "Control sections" }).getByRole("button", { name: /Apps & consent/ }).click();
  const link = page.getByTestId("found-apps-link");
  await expect(link).toContainText("Find the apps people have connected");
  await link.getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Which AI tools and agents do you use?" })).toBeVisible();
  await expect(page.getByTestId("found-apps")).toBeVisible();
});

test("a file that isn't a consent export is rejected with a plain-English message", async ({ page }) => {
  await toAiStep(page);
  await page.getByTestId("consent-input").setInputFiles("e2e/fixtures/m365-secure-scan.json");
  await expect(page.getByTestId("consent-error")).toContainText("no OAuth2 permission grants or service principals");
});
