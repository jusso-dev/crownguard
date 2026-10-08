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

test("production responses carry a strict content security policy", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()["referrer-policy"]).toBe("no-referrer");
});
