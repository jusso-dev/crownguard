import { expect, test } from "@playwright/test";
import { runJourney } from "./journey";

test("no request leaves the app's origin during a full assessment", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url).origin !== origin) external.push(url);
  });
  await runJourney(page, "Microsoft 365", { jewelCount: 2 });
  expect(external).toEqual([]);
});

test("no request leaves the app's origin during the standalone AI register journey", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url).origin !== origin) external.push(url);
  });
  await page.goto("./#/ai-register");
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  const next = () => page.getByRole("button", { name: /^Next:/ }).click();
  await next();
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  await page.getByRole("navigation", { name: "AI use cases" }).getByRole("button", { name: "+ Add a use case" }).click();
  await page.getByRole("button", { name: "Add AI use case: In-house AI agent" }).click();
  await page.getByRole("button", { name: "Download CSV" }).click();
  await next();
  await next();
  await next();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  await download;
  expect(external).toEqual([]);
});

test("production build carries a strict content security policy", async ({ page }) => {
  await page.goto("./");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
});

test("short journey reports no Trusted Types / CSP violations", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const detail = [e.violatedDirective, e.effectiveDirective, e.blockedURI, e.originalPolicy?.slice(0, 80), e.sample?.slice(0, 80)]
        .filter(Boolean)
        .join(" | ");
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(detail);
    });
  });
  await page.goto("./");
  await expect.poll(async () => page.evaluate(() => !!(window as unknown as { trustedTypes?: { defaultPolicy?: unknown } }).trustedTypes?.defaultPolicy)).toBe(true);
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("CSP Check Co");
  await page.getByRole("button", { name: /^Next:/ }).click();
  const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
  expect(violations, violations.join("\n")).toEqual([]);
});
