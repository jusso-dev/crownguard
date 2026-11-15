import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decrypt } from "../src/format/crypto";

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
  await expect(page.getByRole("status").filter({ hasText: /Saved in this browser.*encrypted/ })).toBeVisible();
  await expect(page.getByText("Local protection incomplete.", { exact: false })).toHaveCount(0);

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

// The file is frozen: written once by the build at 0e5fdf0 and never regenerated. The passphrase is public and synthetic.
test("a passphrase-protected file saved by an earlier build still opens", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("import-input").setInputFiles("e2e/fixtures/encrypted-file-v1.json");
  await expect(page.getByText(/protected with a passphrase/i)).toBeVisible();
  await page.getByLabel(/Passphrase for this file/).fill("crownguard-public-fixture-passphrase");
  await page.getByRole("button", { name: "Unlock file" }).click();
  await expect(page.getByText(/Opened Schema Five Co\. Picking up at/)).toBeVisible();
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Organisation/ }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue("Schema Five Co");
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

for (const kind of ["plaintext", "encrypted"]) {
  test(`leaving ephemeral mode restores ${kind} recovery without an active passphrase`, async ({ page }) => {
    const raw = kind === "plaintext" ? "{original recovery\r\n" : await readFile("e2e/fixtures/encrypted-progress-v1.json", "utf8");
    await page.goto("./");
    await page.evaluate((value) => localStorage.setItem("crownguard:v1:unreadable", value), raw);
    await page.reload();
    const downloadButton = page.getByRole("button", { name: "Download the unreadable data" });
    await expect(downloadButton).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    const ephemeral = page.getByLabel(/Don't keep this assessment in this browser/);
    await ephemeral.check();
    await expect(downloadButton).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem("crownguard:v1:unreadable"))).toBeNull();
    await ephemeral.uncheck();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("crownguard:v1:unreadable"))).toBe(raw);
    await page.reload();
    const download = page.waitForEvent("download");
    await downloadButton.click();
    expect(await readFile(await (await download).path(), "utf8")).toBe(raw);
  });
}

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


test("protection stays pending until encryption completes", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("crownguard:v1", "{private raw"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Download the unreadable data" })).toBeVisible();
  await page.evaluate(() => {
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    const w = window as unknown as { releaseEncryption: () => void; encryptionStarted: boolean };
    const gate = new Promise<void>((resolve) => { w.releaseEncryption = resolve; });
    crypto.subtle.encrypt = async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
      w.encryptionStarted = true;
      await gate;
      return original(...args);
    };
  });
  await page.getByRole("button", { name: "Protect with a passphrase" }).click();
  await page.locator("#start-pass").fill("pending-pass-1234");
  await page.locator("#start-confirm").fill("pending-pass-1234");
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { encryptionStarted: boolean }).encryptionStarted)).toBe(true);
  await expect(page.getByText("Updating protection…", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Protected with a passphrase/)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { releaseEncryption: () => void }).releaseEncryption());
  await expect(page.getByText(/^Protected with a passphrase/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("crownguard:v1:unreadable")!).crownguardEncrypted)).toBe(1);
});


test("recovery download uses protected current bytes before and after reload; change and clear retain original key", async ({ page }) => {
  const raw = "  {private original 秘密\r\n";
  await page.goto("./");
  await page.evaluate((value) => localStorage.setItem("crownguard:v1", value), raw);
  await page.reload();
  await expect(page.getByRole("button", { name: "Download the unreadable data" })).toBeVisible();
  await setPassphrase(page, "original-passphrase");
  const backup = await page.evaluate(() => localStorage.getItem("crownguard:v1:unreadable"));
  expect(await decrypt(JSON.parse(backup!), "original-passphrase")).toBe(raw);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the unreadable data" }).click();
    expect(await readFile(await (await download).path(), "utf8")).toBe(backup);
  }
  await page.getByLabel("Passphrase").fill("original-passphrase");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("button", { name: "Change passphrase" }).click();
  await page.locator("#resume-pass, #start-pass").fill("changed-passphrase");
  await page.locator("#resume-confirm, #start-confirm").fill("changed-passphrase");
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await expect(page.getByText(/^Protected with a passphrase/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1:unreadable"))).toBe(backup);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("original passphrase");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Remove protection", exact: true }).click();
  await expect(page.getByRole("button", { name: "Protect with a passphrase" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("crownguard:v1")!).state)).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1:unreadable"))).toBe(backup);
  await expect(decrypt(JSON.parse(backup!), "changed-passphrase")).rejects.toThrow();
});

test("backup quota failure stays visible and retries without losing recovery", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("crownguard:v1", "{original"));
  await page.reload();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "crownguard:v1:unreadable") throw new DOMException("quota", "QuotaExceededError");
      original.call(this, key, value);
    };
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => { Storage.prototype.setItem = original; };
  });
  await page.getByRole("button", { name: "Protect with a passphrase" }).click();
  await page.locator("#start-pass").fill("retry-passphrase");
  await page.locator("#start-confirm").fill("retry-passphrase");
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Protection is incomplete" })).toBeVisible();
  await expect(page.getByText(/^Protected with a passphrase/)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("crownguard:v1:unreadable"))).toBe("{original");
  await expect(page.getByText(/Unprotected raw recovery data/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await expect(page.getByText(/^Protected with a passphrase/)).toBeVisible();
});


test("forget during pending protection cannot restore a key or recovery copy", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("crownguard:v1", "{forgotten raw"));
  await page.reload();
  await page.evaluate(() => {
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    const w = window as unknown as { releaseEncryption: () => void; finished: number; started: number };
    w.finished = 0;
    w.started = 0;
    const gate = new Promise<void>((resolve) => { w.releaseEncryption = resolve; });
    crypto.subtle.encrypt = async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
      w.started++;
      await gate;
      try { return await original(...args); } finally { w.finished++; }
    };
  });
  await page.getByRole("button", { name: "Protect with a passphrase" }).click();
  await page.locator("#start-pass").fill("forgotten-passphrase");
  await page.locator("#start-confirm").fill("forgotten-passphrase");
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await expect(page.getByText("Updating protection…", { exact: true }).first()).toBeVisible();
  // Unmount the form, then explicitly forget while its crypto is still pending.
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await page.evaluate(() => (window as unknown as { releaseEncryption: () => void }).releaseEncryption());
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { started: number; finished: number };
    return w.finished > 0 && w.finished === w.started;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "Protect with a passphrase" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download the unreadable data" })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.getItem("crownguard:v1"), localStorage.getItem("crownguard:v1:unreadable")])).toEqual([null, null]);
});
