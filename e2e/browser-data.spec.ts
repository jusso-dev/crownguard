import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

async function startNamed(page: Page, org: string) {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill(org);
  await next(page);
}

async function setPassphrase(page: Page, pass: string) {
  await page.getByRole("button", { name: "Protect with a passphrase" }).click();
  await page.locator("#start-pass").fill(pass);
  await page.locator("#start-confirm").fill(pass);
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await expect(page.getByText(/Protected with a passphrase/)).toBeVisible();
}

test("passphrase encrypts localStorage; reload unlocks; wrong passphrase fails cleanly", async ({ page }) => {
  await page.goto("./");
  await setPassphrase(page, "test-pass-1234");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  const before = await page.evaluate(() => localStorage.getItem("crownguard:v1"));
  await page.getByLabel("Organisation name").fill("Encrypted Org Pty Ltd");
  await next(page);

  // PBKDF2 encrypt is async; wait until a *new* envelope is written after the org name change.
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => localStorage.getItem("crownguard:v1"));
      if (!raw || raw === before) return "pending";
      if (raw.includes("Encrypted Org")) return "plaintext";
      try {
        const j = JSON.parse(raw);
        return j.crownguardEncrypted === 1 ? "envelope" : "other";
      } catch {
        return "bad-json";
      }
    })
    .toBe("envelope");

  const stored = await page.evaluate(() => localStorage.getItem("crownguard:v1"));
  expect(stored).not.toContain("Encrypted Org");
  expect(stored).not.toContain('"answers"');

  await page.reload();
  await expect(page.getByRole("heading", { name: "Enter passphrase" })).toBeVisible();
  await page.getByLabel("Passphrase").fill("wrong-passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText(/Wrong passphrase|damaged/i);
  await expect(page.getByLabel("Organisation name")).toHaveCount(0);

  await page.getByLabel("Passphrase").fill("test-pass-1234");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Encrypted Org Pty Ltd" })).toBeVisible();
  await page.getByRole("button", { name: "Continue where you left off" }).click();
  // Progress was on Environment after Next; open Organisation to confirm the name restored.
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Organisation/ }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Encrypted Org Pty Ltd");
});

test("encrypted save and open round trip", async ({ page }) => {
  await page.goto("./");
  await setPassphrase(page, "file-pass-5678");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Secret Crown Co");
  await next(page);

  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file" }).click();
  const download = await dl;
  const path = await download.path();
  const text = await readFile(path!, "utf8");
  expect(text).not.toContain("Secret Crown Co");
  expect(JSON.parse(text).crownguardEncrypted).toBe(1);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();

  await page.getByTestId("import-input").setInputFiles(path!);
  await expect(page.getByText(/protected with a passphrase/i)).toBeVisible();
  await page.getByLabel(/Passphrase for this file/).fill("wrong");
  await page.getByRole("button", { name: "Unlock file" }).click();
  await expect(page.getByRole("alert")).toContainText(/Wrong passphrase|damaged/i);
  await expect(page.getByLabel("Organisation name")).toHaveCount(0);

  await page.getByLabel(/Passphrase for this file/).fill("file-pass-5678");
  await page.getByRole("button", { name: "Unlock file" }).click();
  await expect(page.getByText(/Opened Secret Crown Co/)).toBeVisible();
  // File was saved on the Environment step; jump back to confirm the org name restored.
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Organisation/ }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Secret Crown Co");
});

test("no-persistence reload leaves no assessment in localStorage or sessionStorage", async ({ page }) => {
  await page.goto("./");
  page.once("dialog", (d) => d.accept());
  await page.getByLabel(/Don't keep this assessment in this browser/).check();
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Ephemeral Co");
  await next(page);

  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1:ephemeral"))).toBe("1");
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await page.reload();
  await expect(page.getByText("Welcome back")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1:ephemeral"))).toBe("1");
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("Remove from this browser clears the storage key", async ({ page }) => {
  await startNamed(page, "Wipe Me Co");
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("crownguard:v1") !== null))
    .toBe(true);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1"))).toBeNull();
  await page.reload();
  await expect(page.getByText("Welcome back")).toHaveCount(0);
});
