import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

// These tests exercise the download fallback; the native save picker has its own spec (save.spec.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

/** Start an assessment and stop part-way through the controls, in the second section. */
async function startAndStopMidway(page: Page) {
  await page.goto("./");
  await page.getByLabel("Organisation name").fill("Resume Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  const second = page.getByRole("button", { name: /\d+\/\d+$/ }).nth(1);
  const sectionName = (await second.textContent())!.replace(/\d+\/\d+$/, "").trim();
  await second.click();
  await page.locator("article[data-question]").first().getByRole("radio", { name: "No", exact: true }).click();
  return sectionName;
}

test("a fresh visit goes straight to the first step", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText("Welcome back")).toHaveCount(0);
  await expect(page.getByLabel("Organisation name")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved in this browser" })).toBeVisible();
});

test("coming back resumes at the same step and section with answers intact", async ({ page }) => {
  const section = await startAndStopMidway(page);
  await page.reload();

  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume Health" })).toBeVisible();
  await expect(page.getByText("Controls", { exact: true })).toBeVisible();
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();

  await page.getByRole("button", { name: "Continue where you left off" }).click();
  await expect(page.getByRole("heading", { name: "How well are they protected?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
  await expect(page.locator("article[data-question]").first().getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("starting a new assessment from the welcome screen clears the old one", async ({ page }) => {
  await startAndStopMidway(page);
  await page.reload();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Start a new assessment" }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("");
  await page.reload();
  await expect(page.getByText("Welcome back")).toHaveCount(0);
});

test("a saved file reopens at the same place, even after clearing the browser", async ({ page }) => {
  const section = await startAndStopMidway(page);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file" }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe("resume-health.crownguard.json");
  const file = await download.path();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear data" }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("");

  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByText(/Opened Resume Health\. Picking up at Controls\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
  await expect(page.locator("article[data-question]").first().getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("a bad file is rejected and the current assessment is untouched", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Organisation name").fill("Keep Me Pty Ltd");
  await page.getByTestId("import-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2}') });
  await expect(page.getByText(/Couldn't open that file/)).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Keep Me Pty Ltd");
});

test("a file from a newer crownguard is offered read-only and can't be written over", async ({ page }) => {
  const newer = JSON.parse(await readFile("e2e/fixtures/current.crownguard.json", "utf8"));
  await page.goto("./");
  await page.getByLabel("Organisation name").fill("My Own Work");
  await next(page);

  await page.getByTestId("import-input").setInputFiles({
    name: "future.crownguard.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...newer, schemaVersion: 99 })),
  });
  await expect(page.getByRole("status").filter({ hasText: /saved by a newer version of crownguard/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open read-only" })).toBeVisible();
  await page.getByRole("button", { name: "Open read-only" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Opened Current Co read-only/ })).toBeVisible();

  // Neither the button nor the keyboard can save over the file, or over the progress in this browser.
  await expect(page.getByRole("button", { name: "Save file" })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alert").filter({ hasText: /can't be saved from here/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "My Own Work" })).toBeVisible();
});

test("progress this browser can't read is kept aside, and the app starts clean", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("crownguard:v1", "{not json"));
  await page.goto("./");

  await expect(page.getByRole("alert").filter({ hasText: /couldn't be read/ })).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toHaveValue("");

  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the unreadable data" }).click();
  const download = await dl;
  expect(await readFile(await download.path(), "utf8")).toBe("{not json");
});

test("answers for questions that are gone are reported and kept", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Organisation name").fill("Orphan Co");
  await page.evaluate(() => {
    const key = "crownguard:v1";
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.state.assessment.answers["MS-RETIRED-001"] = "no";
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();

  await expect(page.getByRole("status").filter({ hasText: /MS-RETIRED-001/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Orphan Co" })).toBeVisible();
});
