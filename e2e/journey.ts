import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const ORG = "Riverbend Health";
export const MARKING = "OFFICIAL: Sensitive";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** Walks the whole wizard for one platform and returns the downloaded PDF's text per page. */
export async function runJourney(page: Page, platformName: string, jewelCount = 4): Promise<string[]> {
  await page.goto("/");
  await page.getByLabel("Organisation name").fill(ORG);
  await page.getByLabel("Sector").selectOption("Health");
  await page.getByRole("checkbox", { name: /Privacy Act/ }).check({ force: true });
  await next(page);

  await page.getByRole("checkbox", { name: new RegExp(platformName) }).check();
  await next(page);

  const addButtons = page.getByRole("button", { name: /^Add crown jewel:/ });
  await expect(addButtons.first()).toBeVisible();
  const total = await addButtons.count();
  for (let i = 0; i < Math.min(jewelCount, total); i++) {
    await addButtons.nth(i).click();
    const form = page.locator("form").first();
    await form.getByRole("radio", { name: /confidentiality 5/ }).click();
    await form.locator("label", { hasText: /./ }).filter({ has: page.locator("input[type=checkbox]") }).first().click();
    await form.getByRole("button", { name: "Save crown jewel" }).click();
  }
  await next(page);

  // Answer every question, cycling through answers so the report has a mix.
  const cycle = ["Yes", "No", "Partial", "Yes", "Unknown", "No"];
  const chips = page.getByRole("button", { name: /\d+\/\d+$/ });
  const chipCount = await chips.count();
  let n = 0;
  for (let c = 0; c < chipCount; c++) {
    await chips.nth(c).click();
    const cards = page.locator("article[data-question]");
    const count = await cards.count();
    for (let i = 0; i < count; i++) await cards.nth(i).getByRole("radio", { name: cycle[n++ % cycle.length], exact: true }).click();
  }
  await expect(page.getByText(/(\d+) of \1 answered/)).toBeVisible();
  await next(page);

  await expect(page.getByRole("heading", { name: "Risk heatmap" })).toBeVisible();
  await next(page);

  await page.getByTestId("logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await expect(page.getByAltText("Logo preview")).toBeVisible();
  await page.getByLabel("Prepared by").fill("Alex Chen, IT Manager");
  await next(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^riverbend-health-crown-jewel-risk-\d{4}-\d{2}-\d{2}\.pdf$/);
  const path = await download.path();
  return pdfText(new Uint8Array(await readFile(path)));
}

export async function pdfText(data: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " "));
  }
  return pages;
}

export function expectReport(pages: string[]) {
  const all = pages.join("\n");
  expect(pages[0]).toContain(ORG);
  for (const heading of [
    "Executive summary",
    "Crown-jewel register",
    "Risk register",
    "Findings by domain",
    "Remediation roadmap",
    "Framework alignment",
    "Method and limitations",
    "References",
  ])
    expect(all, `missing section ${heading}`).toContain(heading);
  // Letter-spaced cover text extracts with gaps between glyphs, so compare without whitespace.
  const squash = (t: string) => t.replace(/\s+/g, "");
  for (const [i, p] of pages.entries()) expect(squash(p), `page ${i + 1} marking`).toContain(squash(MARKING));
  expect(pages.length).toBeGreaterThanOrEqual(6);
  expect(pages.length).toBeLessThan(120);
}
