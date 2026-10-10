import { expect, test, type Page } from "@playwright/test";

/**
 * What axe can't check: keyboard-only operation, focus order and visibility, the skip link, page titles, the step
 * rail's announcements, focus not obscured by the sticky header, the radio widgets, target size (SC 2.5.8) and
 * reflow at 400% zoom.
 */
const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

async function startFull(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
}

/** Organisation → Environment (Microsoft 365) → one crown jewel → Controls. */
async function toControls(page: Page) {
  await startFull(page);
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.locator("form").first().getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await expect(page.getByRole("heading", { name: "How well are they protected?" })).toBeVisible();
}

test("Tab from page load reaches 'Skip to main content' first, and it puts focus in main", async ({ page }) => {
  await page.goto("./");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  // Visible only on focus, and clear of the top-left corner.
  await expect(skip).toBeInViewport();
  const box = (await skip.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(24);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("the document title names the step and the organisation on every step", async ({ page }) => {
  await startFull(page);
  await expect(page).toHaveTitle("Organisation | Riverbend Health | crownguard");
  await next(page);
  await expect(page).toHaveTitle("Environment | Riverbend Health | crownguard");
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await expect(page).toHaveTitle("Crown jewels | Riverbend Health | crownguard");
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.locator("form").first().getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await expect(page).toHaveTitle("Controls | Riverbend Health | crownguard");
});

test("the resume card's title says where the assessment was left", async ({ page }) => {
  await startFull(page);
  await next(page);
  await page.reload();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page).toHaveTitle("Welcome back | Riverbend Health | crownguard");
});

test("after Next the new step's heading has focus and the step is announced", async ({ page }) => {
  await startFull(page);
  // Keyboard-only: reach Next with the keyboard and press it.
  await page.getByRole("button", { name: /^Next:/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Your environment" })).toBeFocused();
  await expect(page.locator("#step-announce")).toHaveText("Step 2 of 9, Environment");
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await expect(page.getByRole("heading", { level: 1, name: "Identify your crown jewels" })).toBeFocused();
  await expect(page.locator("#step-announce")).toHaveText("Step 3 of 9, Crown jewels");
});

test("the step rail announces completed and locked steps, and locked steps explain themselves", async ({ page }) => {
  await startFull(page);
  await next(page);
  const rail = page.getByRole("navigation", { name: "Steps" });

  // The accessibility snapshot: the done step is announced as completed, the current step is marked, and the
  // locked steps carry the explanation for why they're locked.
  const snapshot = await rail.ariaSnapshot();
  expect(snapshot).toContain("Completed: Organisation");
  expect(snapshot).toContain('"02 Environment"');
  expect(snapshot).toContain('"03 Crown jewels" [disabled]');
  expect(snapshot).toContain("Complete Environment first");
  await expect(rail.getByRole("button", { name: "02 Environment" })).toHaveAttribute("aria-current", "step");

  // Locked steps are discoverable (focusable, not `disabled`) and say what unlocks them.
  const locked = rail.getByRole("button", { name: "03 Crown jewels" });
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await expect(locked).toHaveAttribute("aria-describedby", "step-lock-hint");
  await expect(page.locator("#step-lock-hint")).toHaveText("Complete Environment first");
  await locked.focus();
  await expect(locked).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle("Environment | Riverbend Health | crownguard");

  // Completing the step unlocks the next one, which is then announced as completed once you move on.
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await expect(rail.getByRole("button", { name: "03 Crown jewels" })).not.toHaveAttribute("aria-disabled", "true");
  await next(page);
  await expect(rail.getByRole("button", { name: "Completed: Environment" })).toBeVisible();
});

test("keyboard focus is visible and follows the visual order from the top", async ({ page }) => {
  // A fresh load starts focused nowhere, so the first Tab is the first stop of the page.
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return {
        name: el.getAttribute("aria-label") ?? el.textContent?.trim().replace(/\s+/g, " ").slice(0, 30) ?? el.tagName,
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });
    // 2.4.7 Focus visible: every keyboard stop paints a focus ring.
    expect(focused.outline, `${focused.name} focus ring`).toMatch(/^(solid|auto|dotted|dashed) [1-9]/);
    seen.push(focused.name);
  }
  // 2.4.3 Focus order: skip link first, then the header's actions left to right.
  expect(seen[0]).toBe("Skip to main content");
  expect(seen[1]).toContain("Save file");
  expect(seen[2]).toContain("Open file");
});

test("no focused element is hidden under the sticky header when tabbing backwards", async ({ page }) => {
  await toControls(page);
  const header = page.locator("header").first();
  // Start below the fold and work backwards up the page, as a keyboard user would.
  await page.getByRole("button", { name: /^Next:/ }).focus();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Shift+Tab");
    const spot = await page.evaluate((headerBottom) => {
      const el = document.activeElement as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        name: el.getAttribute("aria-label") ?? el.textContent?.trim().replace(/\s+/g, " ").slice(0, 30) ?? el.tagName,
        inHeader: !!el.closest("header"),
        top: r.top,
        bottom: r.bottom,
        headerBottom,
        height: window.innerHeight,
      };
    }, (await header.boundingBox())!.y + (await header.boundingBox())!.height);
    // Elements inside the header (or the fixed skip link) can't be obscured by it.
    if (spot.inHeader || spot.name === "Skip to main content") continue;
    if (spot.bottom <= 0 || spot.top >= spot.height) continue;
    expect(spot.top, `${spot.name} is under the sticky header`).toBeGreaterThanOrEqual(spot.headerBottom - 1);
  }
});

test("the crown-jewel impact ratings behave like radio buttons from the keyboard", async ({ page }) => {
  await startFull(page);
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  const group = page.locator("form").first().getByRole("radiogroup", { name: "confidentiality impact" });
  await group.getByRole("radio", { name: /^confidentiality 4/ }).click();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: /^confidentiality 5/ })).toBeFocused();
  await expect(group.getByRole("radio", { name: /^confidentiality 5/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Home");
  await expect(group.getByRole("radio", { name: /^confidentiality 1/ })).toHaveAttribute("aria-checked", "true");
  // Only the checked option is a tab stop, and the state the checkbox-style controls expose is their real state.
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
  const obligation = page.getByRole("checkbox", { name: /^Privacy Act/ });
  await obligation.check({ force: true });
  await expect(obligation).toBeChecked();
  await obligation.uncheck({ force: true });
  await expect(obligation).not.toBeChecked();
});

test("the branding colour and logo background controls work from the keyboard", async ({ page }) => {
  await startFull(page);
  await page.getByTestId("org-logo-input").setInputFiles("e2e/fixtures/logo.svg");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.locator("form").first().getByRole("button", { name: "Save crown jewel" }).click();
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Branding/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Brand the report" })).toBeFocused();

  const group = page.getByRole("radiogroup", { name: "Logo background on the cover" });
  await group.getByRole("radio", { name: "None" }).click();
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "White panel" })).toBeFocused();
  await expect(group.getByRole("radio", { name: "White panel" })).toHaveAttribute("aria-checked", "true");

  // The hex field flags invalid input and says how to fix it (3.3.1, 3.3.3).
  const hex = page.getByLabel("Primary colour", { exact: true });
  await hex.fill("nope");
  await hex.blur();
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Use a hex code like #0B5D4B or #0B5.")).toBeVisible();
});

test("every interactive target meets SC 2.5.8: 24 by 24, inline in a sentence, or clear of its neighbours", async ({ page }) => {
  await toControls(page);
  const tooSmall = await page.evaluate(() => {
    // The target of an input wrapped in a label is the label: that's what the pointer can hit.
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role='radio'], [role='button']";
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const targets = [...new Set([...document.querySelectorAll<HTMLElement>(sel)].map((el) => el.closest("label") ?? el))].filter(visible);
    const centres = targets.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const fails: string[] = [];
    targets.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) return;
      // Inline exception: a link or button inside a sentence is sized by the line height around it.
      const display = getComputedStyle(el).display;
      const inline = ["inline", "inline-block", "inline-flex"].includes(display) && el.parentElement?.textContent?.trim() !== el.textContent?.trim();
      if (inline) return;
      // Spacing exception: a 24px circle centred on the target hits no other target's circle.
      const clear = centres.every((c, j) => i === j || Math.hypot(c.x - centres[i].x, c.y - centres[i].y) >= 24);
      if (clear) return;
      fails.push(`${el.tagName}.${el.className} "${el.textContent?.trim().slice(0, 30)}" ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    });
    return fails;
  });
  expect(tooSmall).toEqual([]);
});

test.describe("400% zoom", () => {
  // WCAG 1.4.10 reflow: a 1280px window at 400% zoom is 320 CSS pixels wide.
  test.use({ viewport: { width: 320, height: 256 } });

  test("every step reflows to 320px without sideways scrolling", async ({ page }) => {
    const noOverflow = async (name: string) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(w, name).toBeLessThanOrEqual(320);
    };
    await startFull(page);
    await noOverflow("org");
    await next(page);
    await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
    await noOverflow("env");
    await next(page);
    await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
    await noOverflow("jewels");
    await page.locator("form").first().getByRole("button", { name: "Save crown jewel" }).click();
    await next(page);
    await page.locator("article[data-question] details").first().click();
    await noOverflow("controls");
    await next(page);
    await noOverflow("soc intro");
    await page.getByRole("button", { name: "Include SOC maturity in this report" }).click();
    await noOverflow("soc");
    await next(page);
    await noOverflow("ai intro");
    await next(page);
    await noOverflow("review");
    await next(page);
    await noOverflow("brand");
    await next(page);
    await noOverflow("report");
  });
});
