import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const ORG = "Riverbend Health";
export const MARKING = "OFFICIAL: Sensitive";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** Walks the whole wizard for one platform and returns the downloaded PDF's text per page. */
export async function downloadPdf(page: Page): Promise<string[]> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const download = await downloadPromise;
  return pdfText(new Uint8Array(await readFile(await download.path())));
}

export interface JourneyOptions {
  jewelCount?: number;
  /** Include the optional SOC maturity step and answer every question. */
  soc?: boolean;
  /** IDCF Data Security Level for the first crown jewel, e.g. "DSL-3". */
  dsl?: string;
  /** Include the optional AI register: load the example entries and add one real use case. */
  ai?: boolean;
}

export async function runJourney(page: Page, platformName: string, { jewelCount = 4, soc = false, dsl, ai = false }: JourneyOptions = {}): Promise<string[]> {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill(ORG);
  await page.getByLabel(/^ABN/).fill("51824753556");
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
    if (dsl && i === 0) await form.getByLabel("IDCF Data Security Level").selectOption({ label: dsl });
    await form.getByRole("button", { name: "Save crown jewel" }).click();
  }
  await next(page);

  // Answer every question, cycling through answers so the report has a mix.
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
  await expect(page.getByText(/(\d+) of \1 answered/)).toBeVisible();
  await next(page);

  // The SOC maturity step is optional.
  await expect(page.getByRole("heading", { name: "How mature are your security operations?" })).toBeVisible();
  if (soc) await answerSoc(page);
  await next(page);

  // So is the AI register.
  await expect(page.getByRole("heading", { name: "Which AI tools and agents do you use?" })).toBeVisible();
  if (ai) await fillAiRegister(page);
  await next(page);

  await expect(page.getByRole("heading", { name: "Risk heatmap" })).toBeVisible();
  if (soc) await expect(page.getByRole("heading", { name: "SOC maturity (indicative)" })).toBeVisible();
  if (ai) await expect(page.getByTestId("ai-card")).toContainText("4 use cases");
  await next(page);

  await page.getByTestId("logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await expect(page.getByAltText("Logo preview")).toBeVisible();
  await page.getByLabel("Prepared by").fill("Alex Chen, IT Manager");
  await next(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^riverbend-health-crown-jewel-risk-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
  const path = await download.path();
  return pdfText(new Uint8Array(await readFile(path)));
}

/** Include SOC maturity, leave network monitoring out of scoring and rate every other question. */
export async function answerSoc(page: Page) {
  await page.getByRole("button", { name: "Include SOC maturity in this report" }).click();
  await page.getByRole("radiogroup", { name: "Who runs your security operations?" }).getByRole("radio", { name: "Managed provider (MSSP or MDR)" }).click();
  const picks = ["3", "2", "4", "1", "3", "Unknown", "2"];
  const domains = page.getByRole("navigation", { name: "SOC maturity domains" }).getByRole("button");
  let n = 0;
  for (let d = 0; d < (await domains.count()); d++) {
    await domains.nth(d).click();
    const scope = page.locator('[data-aspect="network-monitoring"]').getByRole("checkbox");
    if (await scope.count()) await scope.check();
    const cards = page.locator("article[data-soc-question]");
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i);
      // Maturity questions go to 5 and capability questions to 3; the last radio is Unknown.
      const top = (await card.getByRole("radio").count()) - 2;
      const pick = picks[n++ % picks.length];
      await card.getByRole("radio", { name: pick === "Unknown" ? "Unknown" : new RegExp(`^${Math.min(Number(pick), top)} `) }).click();
    }
  }
  await expect(page.getByText(/(\d+) of \1 answered/)).toBeVisible();
}

/** Load the example entries, then add a real Microsoft 365 Copilot use case and answer its readiness questions. */
export async function fillAiRegister(page: Page) {
  await page.getByRole("button", { name: "Load example entries" }).click();
  await expect(page.getByRole("note")).toContainText("3 example entries are loaded");
  await page.getByRole("navigation", { name: "AI use cases" }).getByRole("button", { name: "+ Add a use case" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  const entry = page.locator("[data-ai-entry]");
  await entry.getByLabel("Agency identifier (reference number)").fill("AI-2026-001");
  await entry.getByRole("textbox", { name: /^Description/ }).fill("Copilot for staff in the corporate area, for drafting and summarising.");
  await entry.getByRole("radiogroup", { name: "Lifecycle stage" }).getByRole("radio", { name: "Operate" }).click();
  await entry.getByRole("radiogroup", { name: "Use of the Technical standard" }).getByRole("radio", { name: "Partially applied" }).click();
  await entry.getByLabel("Accountable use case owner (name)").fill("Priya Natarajan");
  await entry.getByLabel("Accountable use case owner (email address)").fill("priya.natarajan@riverbend.example");
  await entry.getByRole("checkbox", { name: /^Criterion 4/ }).check({ force: true });
  await expect(page.getByTestId("ai-scope")).toContainText("In scope");
  await entry.getByRole("radiogroup", { name: "Inherent risk rating" }).getByRole("radio", { name: "Medium" }).click();
  await entry.getByRole("radiogroup", { name: "Residual risk rating" }).getByRole("radio", { name: "Low" }).click();
  await entry.getByLabel("Date the AI impact assessment was last updated").fill("2026-09-01");
  await entry.getByRole("checkbox", { name: /^Personal information/ }).check({ force: true });
  const cycle = ["Yes", "Partial", "No", "Unknown"];
  const cards = entry.locator("article[data-ai-question]");
  for (let i = 0; i < (await cards.count()); i++) await cards.nth(i).getByRole("radio", { name: cycle[i % cycle.length], exact: true }).click();
  await expect(entry.getByText(/(\d+) of \1 answered/)).toBeVisible();
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
  expect(pages[0]).toContain("ABN 51 824 753 556");
  // Point-in-time stamp on the cover and in every page footer.
  expect(pages[0]).toMatch(/Generated: \d{1,2} \w+ \d{4} at \d{1,2}:\d{2}/);
  for (const [i, p] of pages.slice(1).entries()) expect(p, `page ${i + 2} timestamp`).toMatch(/Generated \d{1,2} \w+ \d{4}/);
  for (const heading of [
    "About this report",
    "A point-in-time assessment",
    "Standards and guidance assessed against",
    "NIST Cybersecurity Framework 2.0",
    "Executive summary",
    "Crown-jewel register",
    "Risk register",
    "Findings by domain",
    "Controls marked not applicable",
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
