import { test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("Google journey produces a complete branded PDF", async ({ page }) => {
  const pages = await runJourney(page, "Google Workspace");
  expectReport(pages);
});
