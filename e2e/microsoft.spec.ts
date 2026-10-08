import { test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("Microsoft 365 journey produces a complete branded PDF", async ({ page }) => {
  const pages = await runJourney(page, "Microsoft 365");
  expectReport(pages);
});
