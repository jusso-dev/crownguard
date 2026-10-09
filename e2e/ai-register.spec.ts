import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectReport, runJourney } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

async function toAiStep(page: Page) {
  await page.goto("./");
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

test("Microsoft 365 journey with an AI register adds a labelled register section to the PDF", async ({ page }) => {
  const pages = await runJourney(page, "Microsoft 365", { ai: true });
  expectReport(pages);
  const all = pages.join("\n");
  for (const phrase of [
    "AI use-case register",
    "Optional AI use-case register: 4 use cases",
    "3 of these entries are example data",
    "Microsoft 365 Copilot",
    "Priya Natarajan",
    "Example: Grant application triage agent",
    "Key dates",
    "Where the sources are unclear",
    "Digital Transformation Agency",
  ])
    expect(all, phrase).toContain(phrase);
});

test("the agent questions follow the oversight model, and suggested exposures change the crown jewel", async ({ page }) => {
  await toAiStep(page);
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await expect(page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" })).toBeFocused();
  await page.getByRole("button", { name: "Add AI use case: Third-party AI connector or OAuth app" }).click();
  const entry = page.locator("[data-ai-entry]");
  await expect(entry.getByRole("heading", { level: 2 })).toBeFocused();
  const questions = entry.locator("article[data-ai-question]");

  await entry.getByRole("radiogroup", { name: "Oversight model" }).getByRole("radio", { name: "Gives output only" }).click();
  await expect(entry.locator('[data-ai-question="AIR-OFF-001"]')).toHaveCount(0);
  const assistantCount = await questions.count();
  await entry.getByRole("radiogroup", { name: "Oversight model" }).getByRole("radio", { name: /^Acts under supervision/ }).click();
  await expect(entry.locator('[data-ai-question="AIR-OFF-001"]')).toHaveCount(1);
  expect(await questions.count()).toBeGreaterThan(assistantCount);

  await entry.getByRole("checkbox", { name: /^None of these/ }).check({ force: true });
  await expect(page.getByTestId("ai-scope")).toContainText("Not in scope");

  // Link the crown jewel, then tick the exposure the register suggests.
  const jewel = entry.getByRole("group", { name: /Crown jewels it can reach/ }).getByRole("checkbox").first();
  await jewel.check({ force: true });
  const tick = page.getByTestId("ai-exposures").getByRole("button").first();
  await expect(tick).toBeVisible();
  const before = await page.getByTestId("ai-exposures").getByRole("button").count();
  await tick.click();
  await expect(page.getByTestId("ai-exposures").getByRole("button")).toHaveCount(before - 1);

  // N/A needs a reason, like the Controls step.
  const first = questions.first();
  await first.getByRole("radio", { name: "N/A", exact: true }).click();
  await expect(first.getByText("reason needed")).toBeVisible();
  await first.getByLabel(/Why doesn't this apply/).fill("Covered by the vendor's own owner.");
  await expect(first.getByText("✓ answered")).toBeVisible();
});

test("example entries are labelled, export to CSV and XLSX, and come out in one step", async ({ page }) => {
  await toAiStep(page);
  await page.getByRole("button", { name: "Load example entries" }).click();
  await expect(page.getByRole("note")).toContainText("Example data.");
  await expect(page.getByTestId("ai-summary")).toContainText("3");
  await expect(page.locator("[data-ai-entry]").getByText("Example", { exact: true })).toBeVisible();

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^riverbend-health-ai-use-case-register-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = (await readFile(await csv.path())).toString("utf8");
  expect(text.startsWith("\uFEFFUse case name,Agency identifier (reference number),Description,AI technology type,Lifecycle stage")).toBe(true);
  expect(text.split("\r\n").filter(Boolean)).toHaveLength(4);
  expect(text).toContain("Yes: example data, not a real use case");

  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download XLSX" }).click();
  const xlsx = await xlsxDownload;
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const bytes = await readFile(await xlsx.path());
  expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(bytes.includes(Buffer.from("xl/worksheets/sheet2.xml"))).toBe(true);

  await page.getByRole("button", { name: "Remove example entries" }).click();
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
});
