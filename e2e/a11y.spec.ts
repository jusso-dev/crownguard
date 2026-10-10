import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fillAiRegister } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** WCAG 2.0 / 2.1 / 2.2 A and AA. */
const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Colours and focus states settle instantly: axe must not sample mid-transition (the app honours reduced motion).
test.use({ reducedMotion: "reduce" });

/**
 * Proven false positives only. Prefer fixing real violations.
 * Format: rule id, why it is a false positive for this UI, and (optionally) a pattern every failing node must match,
 * which keeps the allowance as narrow as possible.
 */
const allowlist: { id: string; reason: string; target?: RegExp }[] = [
  {
    id: "target-size",
    target: /-mb-px/,
    reason:
      "The section chips (Controls sections, SOC domains, AI use cases — the `-mb-px` tabs) are read as shrunk " +
      "whenever the sticky header overlays them on the way past at phone widths. They are 42px tall and fully " +
      "operable whenever they are on screen, and every scrolled element passes under a sticky header at some scroll " +
      "position, so this is the overlay case SC 2.5.8 does not mean — not a small target. Only those chips are " +
      "allowed; any other target-size finding, or one on these chips for another reason, fails the build.",
  },
];

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  const allowed = (v: (typeof results.violations)[number]) =>
    allowlist.some((a) => a.id === v.id && (!a.target || v.nodes.every((n) => a.target!.test(n.target.join(" ")))));
  const violations = results.violations.filter((v) => !allowed(v));
  expect(violations, `${label}: ${violations.map((v) => `${v.id} (${v.nodes.length})`).join("; ")}`).toEqual([]);
}

/** Reach the named step of a full assessment for one platform, with the minimum inputs to unlock it. */
async function toStep(page: Page, platform: string, target: "org" | "env" | "jewels" | "controls" | "soc" | "ai" | "review" | "branding" | "report") {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  if (target === "org") return;
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  if (target === "env") return;
  await page.getByRole("checkbox", { name: new RegExp(platform) }).check();
  await next(page);
  if (target === "jewels") return;
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  if (target === "controls") return;
  await next(page);
  if (target === "soc") return;
  await next(page);
  if (target === "ai") return;
  await next(page);
  if (target === "review") return;
  await next(page);
  if (target === "branding") return;
  await next(page);
}

const platforms = ["Microsoft 365", "Google Workspace", "AWS"] as const;
const steps = ["org", "env", "jewels", "controls", "soc", "ai", "review", "branding", "report"] as const;

for (const platform of platforms) {
  test.describe(`axe · ${platform}`, () => {
    for (const step of steps) {
      test(`${step} step`, async ({ page }) => {
        await toStep(page, platform, step);
        await expectAxeClean(page, `${platform} ${step}`);
      });
    }
  });
}

test("axe · start card", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expectAxeClean(page, "start");
});

test("axe · resume card", async ({ page }) => {
  await toStep(page, "Microsoft 365", "controls");
  await page.reload();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expectAxeClean(page, "resume");
});

test("axe · AI register add panel", async ({ page }) => {
  await toStep(page, "Microsoft 365", "ai");
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await expect(page.getByRole("button", { name: /Add AI use case:/ }).first()).toBeVisible();
  await expectAxeClean(page, "ai add panel");
});

test("axe · AI register with entries", async ({ page }) => {
  await toStep(page, "Microsoft 365", "ai");
  await fillAiRegister(page);
  await expectAxeClean(page, "ai filled");
});

test("axe · scan import panel", async ({ page }) => {
  await toStep(page, "Microsoft 365", "controls");
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/m365-secure-scan.json");
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await expectAxeClean(page, "scan import");
});

test("axe · report step", async ({ page }) => {
  await toStep(page, "Microsoft 365", "report");
  await expect(page.getByRole("button", { name: "Generate PDF report" })).toBeVisible();
  await expectAxeClean(page, "report");
});

test("axe · mobile 390px on key steps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expectAxeClean(page, "mobile start");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await expectAxeClean(page, "mobile org");
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await expectAxeClean(page, "mobile env");
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await expectAxeClean(page, "mobile controls");
  await next(page);
  await next(page);
  await next(page);
  await next(page);
  await next(page);
  await expectAxeClean(page, "mobile report");
});

test("skip link is first focusable and moves focus to main", async ({ page }) => {
  await page.goto("./");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("document.title updates on start, resume and each step", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Start | New assessment | crownguard");

  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await expect(page).toHaveTitle("Organisation | New assessment | crownguard");

  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await expect(page).toHaveTitle("Organisation | Riverbend Health | crownguard");
  await next(page);
  await expect(page).toHaveTitle("Environment | Riverbend Health | crownguard");

  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await expect(page).toHaveTitle("Crown jewels | Riverbend Health | crownguard");

  await page.reload();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page).toHaveTitle("Welcome back | Riverbend Health | crownguard");
});

test("after Next, focus moves to the step heading and the live region announces", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await expect(page.locator("#step-heading")).toBeFocused();
  await expect(page.locator("#step-announce")).toHaveText("Step 2 of 9, Environment");
});

test("step nav announces completed and locked steps", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  const nav = page.getByRole("navigation", { name: "Steps" });

  // Locked steps stay focusable, explain via aria-describedby, and do not navigate.
  const locked = nav.getByRole("button", { name: /Environment/ });
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await expect(locked).toHaveAttribute("aria-describedby", "step-lock-hint");
  await expect(page.locator("#step-lock-hint")).toHaveText("Complete Organisation first");
  await locked.click({ force: true });
  await expect(page).toHaveTitle(/Organisation/);

  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);

  // Completed steps expose a "Completed:" prefix for screen readers.
  await expect(nav.getByRole("button", { name: /Completed:.*Organisation/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Completed:.*Environment/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Completed:.*Crown jewels/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Controls/ })).toHaveAttribute("aria-current", "step");
  const snapshot = await nav.ariaSnapshot();
  expect(snapshot).toMatch(/Completed:.*Organisation/);
  expect(snapshot).toMatch(/Completed:.*Crown jewels/);
  expect(snapshot).toMatch(/Controls/);
});

test("focused control near the top is not covered by the sticky header", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  // Scroll so the field would sit under the header without the content's scroll margin.
  await page.evaluate(() => window.scrollTo(0, 200));
  const field = page.getByLabel("Organisation name");
  await field.focus();
  const headerBox = await page.locator("header").first().boundingBox();
  const fieldBox = await field.boundingBox();
  expect(headerBox).toBeTruthy();
  expect(fieldBox).toBeTruthy();
  expect(fieldBox!.y + 1).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
});

// States the step walk above doesn't reach: error states, the import panels and the standalone AI register.

test("axe · controls with an N/A reason and its missing-reason error", async ({ page }) => {
  await toStep(page, "Microsoft 365", "controls");
  const first = page.locator("article[data-question]").first();
  await first.getByRole("radio", { name: "N/A", exact: true }).click();
  await expectAxeClean(page, "controls N/A missing reason");
  await first.getByLabel(/Why doesn't this apply/).fill("Cloud-only organisation; not in use.");
  await first.locator("details").first().click();
  await expectAxeClean(page, "controls N/A with reason");
});

test("axe · Found apps preview and the import error state", async ({ page }) => {
  await toStep(page, "Microsoft 365", "controls");
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/legacy.crownguard.json");
  await expect(page.getByText(/Couldn't import that scan/)).toBeVisible();
  await expectAxeClean(page, "scan import error");
  await next(page);
  await next(page);
  await page.getByTestId("consent-input").setInputFiles("e2e/fixtures/consent-graph.json");
  await expect(page.getByTestId("consent-preview")).toBeVisible();
  await expectAxeClean(page, "Found apps preview");
});

test("axe · ScubaGoggles scan import preview", async ({ page }) => {
  await toStep(page, "Google Workspace", "controls");
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/ScubaResults.json");
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await expectAxeClean(page, "ScubaGoggles preview");
});

test("axe · Prowler scan import preview", async ({ page }) => {
  await toStep(page, "Amazon Web Services", "controls");
  await page.getByTestId("scan-input").setInputFiles("e2e/fixtures/prowler-aws.csv");
  await expect(page.getByTestId("scan-preview")).toBeVisible();
  await expectAxeClean(page, "Prowler preview");
});

test("axe · standalone AI register flow", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "AI use-case register only" }).click();
  await expectAxeClean(page, "standalone org");
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await expectAxeClean(page, "standalone register intro");
  await page.getByRole("button", { name: "Load example entries" }).click();
  await expect(page.getByRole("note")).toContainText("3 example entries are loaded");
  await page.getByRole("navigation", { name: "AI use cases" }).getByRole("button", { name: "+ Add a use case" }).click();
  await expectAxeClean(page, "standalone add panel");
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  await expectAxeClean(page, "standalone entry");
  await next(page);
  await expectAxeClean(page, "standalone review");
  await next(page);
  await expectAxeClean(page, "standalone branding");
  await next(page);
  await expectAxeClean(page, "standalone report");
});
