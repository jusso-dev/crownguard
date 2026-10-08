import { expect, test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("Google journey with SOC maturity produces a complete branded PDF", async ({ page }) => {
  const pages = await runJourney(page, "Google Workspace", { soc: true });
  expectReport(pages);
  const all = pages.join("\n");
  for (const text of ["SOC maturity (indicative)", "Aspect profile", "run by a managed provider", "Left out of scoring", "Rob van Os", "creativecommons.org/licenses/by-sa/4.0"])
    expect(all, text).toContain(text);
});
