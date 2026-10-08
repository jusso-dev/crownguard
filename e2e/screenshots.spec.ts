import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { answerSoc, pdfText } from "./journey";

/**
 * Refreshes the README screenshots in docs/screenshots. Not part of the normal suite:
 *   SCREENSHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts
 * Needs pdftoppm (poppler) for the PDF pages.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh the README screenshots");
test.setTimeout(300_000);

const OUT = join(process.cwd(), "docs", "screenshots");
const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage, animations: "disabled" });

test.use({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });

test("README screenshots", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto("./");

  // 1. Organisation
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await page.getByLabel(/^ABN/).fill("51824753556");
  await page.getByLabel("Sector").selectOption("Health");
  await page.getByRole("checkbox", { name: /Privacy Act/ }).check({ force: true });
  await page.getByTestId("org-logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await shot(page, "01-organisation");
  await next(page);

  // 2. Environment
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await shot(page, "02-environment");
  await next(page);

  // 3. Crown jewels: add four (two with an IDCF level), open the form on the last one for the screenshot.
  const add = page.getByRole("button", { name: /^Add crown jewel:/ });
  await expect(add.first()).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await add.nth(i).click();
    const form = page.locator("form").first();
    await form.getByRole("radio", { name: /confidentiality 5/ }).click();
    await form.locator("label", { hasText: /./ }).filter({ has: page.locator("input[type=checkbox]") }).first().click();
    if (i === 0 || i === 3) await form.getByLabel("IDCF Data Security Level").selectOption({ label: "DSL-3" });
    if (i < 3) await form.getByRole("button", { name: "Save crown jewel" }).click();
  }
  await shot(page, "03-crown-jewels");
  await page.locator("form").first().getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);

  // 4. Controls: a realistic spread of answers, mostly in place.
  const pattern = ["Yes", "Yes", "Partial", "Yes", "No", "Yes", "Unknown", "Yes", "Partial", "Yes", "No", "Yes"];
  const chips = page.getByRole("button", { name: /\d+\/\d+$/ });
  let n = 0;
  for (let c = 0; c < (await chips.count()); c++) {
    await chips.nth(c).click();
    const cards = page.locator("article[data-question]");
    for (let i = 0; i < (await cards.count()); i++) await cards.nth(i).getByRole("radio", { name: pattern[n++ % pattern.length], exact: true }).click();
  }
  await chips.first().click();
  await page.locator("article[data-question] details").first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "04-controls");
  await next(page);

  // 5. SOC maturity (optional)
  await answerSoc(page);
  await page.getByRole("navigation", { name: "SOC maturity domains" }).getByRole("button").first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "05-soc-maturity");
  await next(page);

  // 6. Review, and its SOC card
  await expect(page.getByRole("heading", { name: "Risk heatmap" })).toBeVisible();
  await shot(page, "06-review");
  await page.getByTestId("soc-card").screenshot({ path: join(OUT, "07-review-soc.png"), animations: "disabled" });
  await next(page);

  // 7. Branding
  await page.getByLabel("Prepared by").fill("Alex Chen, IT Manager");
  await shot(page, "08-branding");
  await next(page);

  // 8. Report: download the PDF and render its key pages.
  await shot(page, "09-report");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  const pdfPath = join(OUT, "report.pdf");
  await (await download).saveAs(pdfPath);
  const pages = await pdfText(new Uint8Array(readFileSync(pdfPath)));
  const pageOf = (heading: string) => pages.findIndex((p) => p.includes(heading)) + 1;
  const wanted: [string, number][] = [
    ["10-pdf-cover", 1],
    ["11-pdf-about", pageOf("Standards and guidance assessed against")],
    ["12-pdf-summary", pageOf("Executive summary")],
    ["13-pdf-risk-register", pageOf("Risk register")],
    ["14-pdf-roadmap", pageOf("Remediation roadmap")],
    ["15-pdf-frameworks", pageOf("Framework alignment")],
    // The page with the per-jewel Rule 2 checks, after the DSL tables.
    ["16-pdf-idcf", pageOf("Under IDCF Rule 2")],
    ["17-pdf-soc", pageOf("SOC maturity (indicative)")],
    ["18-pdf-soc-priorities", pageOf("Priorities to reach target")],
  ];
  for (const [name, p] of wanted) {
    if (p < 1) continue;
    execFileSync("pdftoppm", ["-png", "-r", "110", "-f", String(p), "-l", String(p), "-singlefile", pdfPath, join(OUT, name)]);
  }
  rmSync(pdfPath);

  // 9. Phone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Controls/ }).click();
  await shot(page, "19-mobile");
});
