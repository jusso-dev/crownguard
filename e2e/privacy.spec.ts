import { expect, test } from "@playwright/test";
import { runJourney } from "./journey";

test("no request leaves the app's origin during a full assessment", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url).origin !== origin) external.push(url);
  });
  await runJourney(page, "Microsoft 365", 2);
  expect(external).toEqual([]);
});

test("production build carries a strict content security policy", async ({ page }) => {
  await page.goto("./");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
});
