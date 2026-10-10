import { expect, test } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

test("ISMs map into findings and the PDF, and a chosen baseline annotates without touching scores", async ({ page }) => {
  const pages = await runJourney(page, "Microsoft 365", { ismBaseline: "PROTECTED" });
  expectReport(pages);
  const all = pages.join("\n");
  // ISM refs sit alongside the other frameworks in the findings detail, labelled with the release.
  expect(all).toContain("ISM (Sep 2026) ISM-");
  expect(all).toContain("Australian Government Information Security Manual (September 2026 release)");
  expect(all).toContain("ISM (Sep 2026) controls");
  expect(all).toContain("not an IRAP assessment or a statement of applicability");
  // The chosen baseline annotates the findings that touch it and adds a count to the summary.
  expect(all).toContain("Touches the ISM PROTECTED baseline");
  expect(all).toMatch(/The PROTECTED baseline covers \d+ of the \d+ findings in this report/);
  await expect(page.getByText(/PROTECTED — \d+ of \d+ findings annotated/)).toBeVisible();
});
