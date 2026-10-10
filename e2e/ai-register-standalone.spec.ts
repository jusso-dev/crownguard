import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pdfText } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** The standalone flow from the start screen: choose it, name the organisation, land on the register. */
async function toRegister(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "AI use-case register only" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await expect(page.getByRole("heading", { name: "Which AI tools and agents do you use?" })).toBeVisible();
}

/** Two use cases from the presets: one Microsoft 365 Copilot, one in-house agent. */
async function addTwoUseCases(page: Page) {
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  const first = page.locator("[data-ai-entry]");
  await first.getByLabel("Agency identifier (reference number)").fill("AI-2026-001");
  await first.getByLabel("Accountable use case owner (name)").fill("Priya Natarajan");
  await page.getByRole("navigation", { name: "AI use cases" }).getByRole("button", { name: "+ Add a use case" }).click();
  await page.getByRole("button", { name: "Add AI use case: In-house AI agent" }).click();
  await page.locator("[data-ai-entry]").getByLabel("Agency identifier (reference number)").fill("AI-2026-002");
}

test("the #/ai-register link opens straight into the standalone flow on a fresh visit", async ({ page }) => {
  await page.goto("./#/ai-register");

  // The link is read once and cleared, so a refresh doesn't fight saved progress.
  expect(new URL(page.url()).hash).toBe("");
  const rail = page.getByRole("navigation", { name: "Steps" });
  await expect(rail.getByRole("button")).toHaveCount(5);
  await expect(rail.getByRole("button", { name: /Organisation/ })).toBeVisible();
  await expect(rail.getByRole("button", { name: /AI register/ })).toBeVisible();
  await expect(rail.getByRole("button", { name: /Crown jewels/ })).toHaveCount(0);

  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await expect(page.getByText("Step 02 / 05")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start an AI use-case register" })).toBeVisible();
});

test("the deep link doesn't override a resumed assessment without asking", async ({ page, context }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Kept Safe Pty Ltd");
  await expect(page.getByRole("status").filter({ hasText: "Saved in this browser" })).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("crownguard:v1") ?? ""))
    .toContain("Kept Safe Pty Ltd");

  // Following the link is a fresh page load, as it would be from an email or the website.
  const link = await context.newPage();
  await link.goto("./#/ai-register");

  await expect(link.getByText("Welcome back")).toBeVisible();
  await expect(link.getByRole("heading", { name: "Kept Safe Pty Ltd" })).toBeVisible();
  await expect(link.getByText("You followed a link to the AI use-case register")).toBeVisible();
  await expect(link.getByRole("button", { name: "AI use-case register only" })).toHaveCount(0);

  // Only when the user agrees does the fresh standalone register start.
  link.once("dialog", (d) => d.accept());
  await link.getByRole("button", { name: "Start an AI use-case register instead" }).click();
  await expect(link.getByRole("navigation", { name: "Steps" }).getByRole("button")).toHaveCount(5);
  await expect(link.getByLabel("Organisation name")).toHaveValue("");
});

test("two use cases from presets export to CSV and XLSX, and the standalone PDF carries only the register", async ({ page }) => {
  await toRegister(page);
  await addTwoUseCases(page);

  // Crown jewels are a full-assessment concern; the standalone register says where they'd appear.
  await expect(page.getByRole("group", { name: /Crown jewels it can reach/ })).toHaveCount(0);
  await expect(page.getByTestId("ai-no-jewels")).toContainText("links each use case to the crown jewels it can reach");

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^riverbend-health-ai-use-case-register-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = (await readFile(await csv.path())).toString("utf8");
  expect(text.startsWith("\uFEFFUse case name,Agency identifier (reference number),Description,AI technology type,Lifecycle stage")).toBe(true);
  expect(text.split("\r\n").filter(Boolean)).toHaveLength(3);
  expect(text).toContain("AI-2026-001");
  expect(text).toContain("Priya Natarajan");
  expect(text).toContain("AI-2026-002");

  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download XLSX" }).click();
  const xlsx = await xlsxDownload;
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  expect((await readFile(await xlsx.path())).subarray(0, 4).toString("hex")).toBe("504b0304");

  // Review in the standalone flow: the register's tiles and its open gaps, nothing about risk.
  await next(page);
  await expect(page.getByTestId("ai-review-summary")).toContainText("2");
  await expect(page.getByTestId("ai-review-gaps")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk heatmap" })).toHaveCount(0);

  await next(page);
  await next(page);
  await expect(page.getByRole("button", { name: "Turn this into a full crown-jewel assessment" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe("riverbend-health-ai-register.pdf");
  const pages = await pdfText(new Uint8Array(await readFile(await pdf.path())));
  const all = pages.join("\n");
  for (const phrase of ["AI use-case register", "About this register", "Readiness is an indicative self-check", "AI-2026-001", "Priya Natarajan", "AI-2026-002", "Key dates", "Where the sources are unclear"])
    expect(all, phrase).toContain(phrase);
  for (const absent of ["Risk register", "Remediation roadmap", "Essential Eight", "Crown-jewel register"])
    expect(all, `should not contain ${absent}`).not.toContain(absent);
});

test("example entries stay labelled as examples in the app, CSV and PDF", async ({ page }) => {
  await toRegister(page);
  await page.getByRole("button", { name: "Load example entries" }).click();
  await expect(page.getByRole("note")).toContainText("3 example entries are loaded");
  await expect(page.locator("[data-ai-entry]").getByText("Example", { exact: true })).toBeVisible();

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = (await readFile(await (await csvDownload).path())).toString("utf8");
  expect(csv).toContain("Yes: example data, not a real use case");

  await next(page);
  await next(page);
  await next(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const pages = await pdfText(new Uint8Array(await readFile(await (await download).path())));
  expect(pages.join("\n")).toContain("EXAMPLE");
  expect(pages.join("\n")).toContain("example data");
});

test("upgrading to a full assessment keeps every register entry, answer and note", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await toRegister(page);
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  const entry = page.locator("[data-ai-entry]");
  await entry.getByLabel("Accountable use case owner (name)").fill("Priya Natarajan");
  await entry.getByRole("checkbox", { name: /^Criterion 4/ }).check({ force: true });
  const first = entry.locator("article[data-ai-question]").first();
  await first.getByRole("radio", { name: "N/A", exact: true }).click();
  await first.getByLabel(/Why doesn't this apply/).fill("Covered by the vendor's own owner.");

  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file" }).click();
  const saveName = (await saved).suggestedFilename();
  expect(saveName).toBe("riverbend-health-ai-register.crownguard.json");

  await next(page);
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Turn this into a full crown-jewel assessment" }).click();

  // Full mode again: nine steps, at Environment, with the register untouched behind it.
  await expect(page.getByRole("navigation", { name: "Steps" }).getByRole("button")).toHaveCount(9);
  await expect(page.getByText("Step 02 / 09")).toBeVisible();
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await next(page);
  await next(page);
  const reopened = page.locator("[data-ai-entry]");
  await expect(reopened.getByLabel("Accountable use case owner (name)")).toHaveValue("Priya Natarajan");
  await expect(reopened.getByRole("checkbox", { name: /^Criterion 4/ })).toBeChecked();
  await expect(reopened.locator("article[data-ai-question]").first().getByLabel(/Why doesn't this apply/)).toHaveValue("Covered by the vendor's own owner.");
});

test("the standalone steps fit a 390px phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const noOverflow = async (name: string) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, name).toBeLessThanOrEqual(390);
  };
  await page.goto("./");
  await noOverflow("start");
  await page.getByRole("button", { name: "AI use-case register only" }).click();
  await noOverflow("org");
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await noOverflow("register intro");
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  await noOverflow("register entry");
  await next(page);
  await noOverflow("review");
  await next(page);
  await noOverflow("brand");
  await next(page);
  await noOverflow("report");
});

test("an older saved file still opens in the full assessment at the right step", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("import-input").setInputFiles("e2e/fixtures/legacy.crownguard.json");
  await expect(page.getByText("Opened Legacy Health. Picking up at Organisation.")).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Steps" });
  await expect(rail.getByRole("button")).toHaveCount(9);
  await expect(rail.getByRole("button", { name: /Crown jewels/ })).toBeVisible();
  await expect(rail.getByRole("button", { name: /AI register/ })).toBeVisible();
});
