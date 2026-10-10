import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

async function toSecondControlsSection(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Save Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  const second = page.getByRole("button", { name: /\d+\/\d+$/ }).nth(1);
  const section = (await second.textContent())!.replace(/\d+\/\d+$/, "").trim();
  await second.click();
  await page.locator("article[data-question]").nth(1).scrollIntoViewIfNeeded();
  return section;
}

test("Save file writes in place and keeps you on the same question", async ({ page }) => {
  // Stand in for the browser's native save dialog and record what gets written.
  await page.addInitScript(() => {
    const w = window as unknown as { __picks: number; __writes: string[]; showSaveFilePicker: unknown };
    w.__picks = 0;
    w.__writes = [];
    w.showSaveFilePicker = async () => {
      w.__picks++;
      return {
        name: "save-health.crownguard.json",
        createWritable: async () => ({ write: async (d: string) => void w.__writes.push(d), close: async () => {} }),
      };
    };
  });
  const section = await toSecondControlsSection(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await page.getByRole("button", { name: "Save file" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved to save-health.crownguard.json" })).toBeVisible();
  await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
  // Saving must not move the page: the scroll margin that clears the sticky header for focused elements doesn't
  // drag the document when focus lands on the header's own buttons.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // Answer something, then save again with the keyboard: same file, no second dialog.
  await page.locator("article[data-question]").nth(1).getByRole("radio", { name: "Yes", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length)).toBe(2);
  const { picks, last } = await page.evaluate(() => {
    const w = window as unknown as { __picks: number; __writes: string[] };
    return { picks: w.__picks, last: JSON.parse(w.__writes.at(-1)!) };
  });
  expect(picks).toBe(1);
  expect(last.org.name).toBe("Save Health");
  expect(Object.values(last.answers)).toContain("yes");
  expect(last.progress.step).toBe(3);
  await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
});

test("without a native save dialog it downloads and still stays put", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const section = await toSecondControlsSection(page);
  const url = page.url();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file" }).click();
  expect((await dl).suggestedFilename()).toBe("save-health.crownguard.json");
  expect(page.url()).toBe(url);
  await expect(page.getByRole("heading", { name: section, level: 2 })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Downloaded save-health.crownguard.json" })).toBeVisible();
});

test("N/A needs a reason before it counts as answered", async ({ page }) => {
  await toSecondControlsSection(page);
  const card = page.locator("article[data-question]").first();
  const progress = page.getByText(/^\d+ of \d+ answered$/);
  const before = await progress.textContent();

  await card.getByRole("radio", { name: "N/A", exact: true }).click();
  const reason = card.getByLabel(/Why doesn't this apply/);
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(card.getByText("reason needed")).toBeVisible();
  await expect(progress).toHaveText(before!);

  await reason.fill("We don't run Exchange on-premises.");
  await expect(reason).toHaveAttribute("aria-invalid", "false");
  await expect(progress).not.toHaveText(before!);
});

test("ABN is checked against the ATO check digit", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  const abn = page.getByLabel(/^ABN/);
  await abn.fill("51 824 753 557");
  await abn.blur();
  await expect(page.getByText(/fails the ATO check-digit test/)).toBeVisible();
  await abn.fill("51824753556");
  await expect(abn).toHaveValue("51 824 753 556");
  await expect(page.getByText(/fails the ATO check-digit test/)).toHaveCount(0);
});

test("an older saved file can be reopened to add a logo and ABN, then regenerated", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByRole("button", { name: "Open saved file" }).click({ trial: true });
  await page.getByTestId("import-input").setInputFiles("e2e/fixtures/legacy.crownguard.json");
  await expect(page.getByText("Opened Legacy Health. Picking up at Organisation.")).toBeVisible();

  await page.getByLabel(/^ABN/).fill("53004085616");
  await page.getByTestId("org-logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await expect(page.getByAltText("Current logo")).toBeVisible();

  await page.getByRole("button", { name: /Report$/ }).click();
  const { downloadPdf } = await import("./journey");
  const pages = await downloadPdf(page);
  expect(pages[0]).toContain("Legacy Health");
  expect(pages[0]).toContain("ABN 53 004 085 616");
  expect(pages[0]).toMatch(/Answers as at: \d{1,2} \w+ 2026/);
  expect(pages.join("\n")).toContain("About this report");
});

test("the file it writes matches the published JSON Schema", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: string[]; showSaveFilePicker: unknown };
    w.__writes = [];
    w.showSaveFilePicker = async () => ({
      name: "save-health.crownguard.json",
      createWritable: async () => ({ write: async (d: string) => void w.__writes.push(d), close: async () => {} }),
    });
  });
  await toSecondControlsSection(page);
  await page.getByRole("button", { name: "Save file" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length)).toBe(1);

  const saved = JSON.parse(await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes[0]));
  // The published schema is versioned; find it rather than pinning the name, so bumping the format can't break this.
  const published = (await readdir(join("public", "schema"))).filter((f) => /^crownguard-assessment\.v\d+\.json$/.test(f));
  expect(published).toHaveLength(1);
  const schema = JSON.parse(await readFile(join("public", "schema", published[0]), "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  expect(validate(saved), JSON.stringify(validate.errors, null, 2)).toBe(true);

  expect(saved.$schema).toContain(published[0]);
  expect(saved.schemaVersion).toBe(Number(/v(\d+)\.json$/.exec(published[0])![1]));
  expect(saved.savedBy.app).toBe("crownguard");
  expect(saved.savedBy.contentHash).toMatch(/^[0-9a-f]{16}$/);
});
