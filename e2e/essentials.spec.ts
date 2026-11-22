import { expect, test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("ASD Essentials sits beside the Essential Eight in the PDF, by phase and domain, without converting levels", async ({ page }) => {
  const pages = await runJourney(page, "Microsoft 365", { essentials: "enterprise-it" });
  expectReport(pages);
  const all = pages.join("\n");
  // Both frameworks appear, each with its own heading.
  expect(all).toContain("ASD Essential Eight (indicative maturity)");
  expect(all).toContain("ASD Essentials (indicative)");
  expect(all).toContain("Summary by phase and domain");
  expect(all).toContain("Gap analysis finding, not a rating");
  expect(all).toContain("Phases are ASD's order for doing the work, not a rating");
  expect(all).toContain("not a formal Essentials assessment");
  // Per-question references carry the action and domain.
  expect(all).toMatch(/Essentials IT\.PRO-13\.\d \(IS/);
  await expect(page.getByText("ASD Essentials for enterprise IT, indicative")).toBeVisible();
});
