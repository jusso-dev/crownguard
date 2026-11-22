import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pdfText } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** Asset URLs requested while interacting — used to assert per-platform chunks. */
function trackJs(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/assets/") && /\.m?js(\?|$)/.test(u)) urls.push(u);
  });
  return urls;
}

test("choosing only Google loads no Microsoft or AWS question data", async ({ page }) => {
  const urls = trackJs(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);

  await page.getByRole("checkbox", { name: /Google Workspace/ }).check();
  await next(page);
  await expect(page.getByRole("button", { name: /^Add crown jewel:/ }).first()).toBeVisible({ timeout: 30_000 });

  const joined = urls.join("\n");
  expect(joined, joined).toMatch(/\/assets\/google-/);
  // Other platforms' question chunks must not load.
  expect(joined, joined).not.toMatch(/\/assets\/microsoft-/);
  expect(joined, joined).not.toMatch(/\/assets\/aws-/);
});

test("large PDF uses the worker and keeps the UI responsive", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);

  const addButtons = page.getByRole("button", { name: /^Add crown jewel:/ });
  await expect(addButtons.first()).toBeVisible();
  const total = await addButtons.count();
  for (let i = 0; i < Math.min(6, total); i++) {
    await addButtons.nth(i).click();
    const form = page.locator("form").first();
    await form.getByRole("radio", { name: /confidentiality 5/ }).click();
    await form.locator("label", { hasText: /./ }).filter({ has: page.locator("input[type=checkbox]") }).first().click();
    await form.getByRole("button", { name: "Save crown jewel" }).click();
  }
  await next(page);

  const cycle = ["Yes", "No", "Partial", "N/A", "Yes", "Unknown", "No"];
  const chips = page.getByRole("button", { name: /\d+\/\d+$/ });
  const chipCount = await chips.count();
  let n = 0;
  for (let c = 0; c < chipCount; c++) {
    await chips.nth(c).click();
    const cards = page.locator("article[data-question]");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const choice = cycle[n++ % cycle.length];
      await cards.nth(i).getByRole("radio", { name: choice, exact: true }).click();
      if (choice === "N/A") await cards.nth(i).getByLabel(/Why doesn't this apply/).fill("Cloud-only organisation; not in use.");
    }
  }
  await next(page); // leave Controls → SOC
  await next(page); // → AI
  await next(page); // → Review
  await next(page); // → Branding
  await next(page); // → Report
  await expect(page.getByRole("button", { name: "Generate PDF report" })).toBeVisible({ timeout: 30_000 });

  const downloadPromise = page.waitForEvent("download", {
    predicate: (download) => download.suggestedFilename().endsWith(".pdf"),
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  await expect(page.getByRole("button", { name: "Building PDF…" })).toBeVisible();

  const savedPromise = page.waitForEvent("download", {
    predicate: (download) => download.suggestedFilename().endsWith(".crownguard.json"),
  });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Save file" }).click({ timeout: 1_000 });
  const reactedIn = Date.now() - t0;

  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pages = await pdfText(new Uint8Array(bytes));
  expect(pages[0]).toContain("Riverbend Health");
  expect(pages.join("\n")).toContain("Crown-jewel register");
  expect(await (await savedPromise).failure()).toBeNull();
  const path = await page.evaluate(() => (window as unknown as { __crownguardPdfPath?: string }).__crownguardPdfPath);

  expect(path, "expected worker render path").toBe("worker");
  expect(reactedIn, `UI click during PDF render took ${reactedIn}ms`).toBeLessThanOrEqual(200);
});

test("PDF worker falls back when Worker is stubbed out", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: undefined });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "AI use-case register only" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  await next(page);
  await next(page);
  await next(page);
  const downloadPromise = page.waitForEvent("download", {
    predicate: (download) => download.suggestedFilename().endsWith(".pdf"),
  });
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pages = await pdfText(new Uint8Array(bytes));
  expect(pages[0]).toContain("Riverbend Health");
  expect(pages.join("\n")).toContain("Microsoft 365 Copilot");
  const path = await page.evaluate(() => (window as unknown as { __crownguardPdfPath?: string }).__crownguardPdfPath);
  expect(path).toBe("main-thread");
});
