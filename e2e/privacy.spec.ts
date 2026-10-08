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

test("answers persist across reloads and can be cleared", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Organisation name").fill("Persisted Org");
  await page.reload();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Persisted Org");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear data" }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("");
});

test("export then import round-trips the assessment and rejects bad files", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Organisation name").fill("Round Trip Pty Ltd");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await (await dl).path();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear data" }).click();
  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByLabel("Organisation name")).toHaveValue("Round Trip Pty Ltd");

  await page.getByTestId("import-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2}') });
  await expect(page.getByText(/Couldn't import that file/)).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Round Trip Pty Ltd");
});
