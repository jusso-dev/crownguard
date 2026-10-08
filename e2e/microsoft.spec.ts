import { expect, test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("Microsoft 365 journey with an IDCF level produces a complete branded PDF", async ({ page }) => {
  const pages = await runJourney(page, "Microsoft 365", { dsl: "DSL-3" });
  expectReport(pages);
  const all = pages.join("\n");
  expect(all).toContain("IDCF Data Security Levels (indicative)");
  expect(all).toMatch(/is labelled DSL-3\. Under IDCF Rule 2/);
  expect(all).not.toContain("SOC maturity (indicative)");
});
