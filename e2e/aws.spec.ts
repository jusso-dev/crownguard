import { expect, test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("AWS journey produces a complete branded PDF with AWS benchmark mappings", async ({ page }) => {
  const pages = await runJourney(page, "Amazon Web Services", { dsl: "DSL-3" });
  expectReport(pages);
  const all = pages.join("\n");
  for (const text of ["Amazon Web Services", "CIS AWS v7", "AWS FSBP"]) expect(all, text).toContain(text);
});
