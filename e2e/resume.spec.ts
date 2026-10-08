import { expect, test, type Page } from "@playwright/test";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** Start an assessment and stop part-way through the controls, in the second section. */
async function startAndStopMidway(page: Page) {
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await page.getByLabel("Organisation name").fill("Keep Me Pty Ltd");
  await page.getByTestId("import-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2}') });
  await expect(page.getByText(/Couldn't open that file/)).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Keep Me Pty Ltd");
});
