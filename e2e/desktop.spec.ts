/**
 * The desktop build (`vite build --mode desktop`) under the desktop webview's rules: the CSP from tauri.conf.json
 * (connect-src limited to the IPC bridge), a frozen Object.prototype (`freezePrototype: true`) and no global Tauri
 * object. The Rust side is replaced by an in-memory stand-in for SQLite, the native dialogs and the file system, so
 * these journeys check everything the webview does without a display. The real binary is checked by
 * docs/desktop/offline-test.md on each operating system.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectReport, pdfText, runJourney } from "./journey";

interface Desktop {
  /** The autosave table, key → value, as the Rust side would hold it. */
  db: Map<string, string>;
  /** Files written through the fs plugin, by path. */
  files: Map<string, Uint8Array>;
  /** What the next open dialog returns. */
  openPaths: string[];
  /** Every command that crossed the IPC bridge, with its arguments. */
  calls: { cmd: string; args: unknown }[];
  opened: string[];
  asked: string[];
  unknown: string[];
  /** Requests that left the app's origin, and CSP violations reported by the page. */
  external: string[];
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

/** Load the desktop build with a stand-in for the Tauri runtime. The state survives reloads, like SQLite does. */
async function desktop(page: Page, baseURL: string, state?: Desktop): Promise<Desktop> {
  const d: Desktop = state ?? { db: new Map(), files: new Map(), openPaths: [], calls: [], opened: [], asked: [], unknown: [], external: [] };
  const origin = new URL(baseURL).origin;
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith("data:") && !url.startsWith("blob:") && new URL(url).origin !== origin) d.external.push(url);
  });
  page.on("pageerror", (e) => d.unknown.push(`pageerror: ${e.message}`));
  await page.exposeFunction("__cgIpc", (cmd: string, args: Record<string, unknown> | number[] | null, headers: Record<string, string> | null) => {
    d.calls.push({ cmd, args });
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "autosave_load":
        return Object.fromEntries(d.db);
      case "autosave_set":
        d.db.set(a.key as string, a.value as string);
        return null;
      case "autosave_remove":
        d.db.delete(a.key as string);
        return null;
      case "recent_record":
      case "recent_forget":
      case "settings_set_update_check":
        return null;
      case "recent_list":
        return [];
      case "launch_file_take":
        return null;
      case "settings_get":
        return { updateCheck: false, updateAvailableInBuild: false };
      case "plugin:event|listen":
        return 1;
      case "plugin:event|unlisten":
        return null;
      case "plugin:dialog|save":
        return `/home/tester/Documents/${(a.options as { defaultPath: string }).defaultPath}`;
      case "plugin:dialog|open":
        return d.openPaths.shift() ?? null;
      case "plugin:dialog|message": {
        // The user picks the first (OK / Yes) button; the plugin returns its label.
        d.asked.push(String(a.message));
        const buttons = a.buttons as { OkCancelCustom?: string[]; OkCustom?: string } | string | undefined;
        if (typeof buttons === "object") return buttons.OkCancelCustom?.[0] ?? buttons.OkCustom;
        return buttons === "YesNo" ? "Yes" : "Ok";
      }
      case "plugin:fs|write_text_file":
      case "plugin:fs|write_file":
        d.files.set(decodeURIComponent(headers!.path), Uint8Array.from(args as number[]));
        return null;
      case "plugin:fs|read_text_file": {
        const f = d.files.get(a.path as string);
        if (!f) throw new Error(`no such file: ${a.path}`);
        return Array.from(f);
      }
      case "plugin:opener|open_url":
        d.opened.push(a.url as string);
        return null;
      default:
        d.unknown.push(cmd);
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  await page.addInitScript(() => {
    // What Tauri's freezePrototype does before any app script runs.
    Object.freeze(Object.prototype);
    const w = window as unknown as Record<string, unknown> & { __cgIpc: (...a: unknown[]) => Promise<unknown> };
    let next = 1;
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
      transformCallback: () => next++,
      unregisterCallback: () => {},
      convertFileSrc: (p: string) => p,
      invoke: (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) =>
        w.__cgIpc(cmd, args instanceof Uint8Array ? Array.from(args) : (args ?? null), options?.headers ?? null),
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (w as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (w as unknown as { __csp: string[] }).__csp.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`));
  });
  return d;
}

/** Generate the PDF through the native save dialog and return what was written. */
const savePdf = (d: Desktop) => async (page: Page) => {
  const before = d.files.size;
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  await expect.poll(() => d.files.size, { timeout: 60_000 }).toBe(before + 1);
  const [path, bytes] = [...d.files].at(-1)!;
  expect(path).toMatch(/riverbend-health-crown-jewel-risk-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
  return bytes;
};

/**
 * CSP violations the page reported. One is expected and harmless: yoga's Emscripten loader first tries to fetch its
 * inlined WebAssembly from a data: URL, which connect-src refuses, and then decodes the same bytes itself.
 */
const cspViolations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.filter((v) => !/^connect-src data .*\/assets\/generate-/.test(v)));
const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

for (const platform of ["Microsoft 365", "Google Workspace", "Amazon Web Services"]) {
  test(`${platform}: a full assessment and PDF, offline, with no outbound connections`, async ({ page, baseURL }) => {
    const d = await desktop(page, baseURL!);
    const pages = await runJourney(page, platform, { jewelCount: 2, generatePdf: savePdf(d) });
    expectReport(pages);
    expect(d.external).toEqual([]);
    expect(d.unknown).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    // Autosave went to the SQLite store, not to browser storage.
    expect(JSON.parse(d.db.get("crownguard:v1")!).state.assessment.org.name).toBe("Riverbend Health");
    expect(await page.evaluate(() => localStorage.getItem("crownguard:v1"))).toBeNull();
  });
}

test("scan imports (M365-Secure, Prowler, ScubaGoggles) and the XLSX register export work offline", async ({ page, baseURL }) => {
  const d = await desktop(page, baseURL!);
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Example Co");
  await next(page);
  for (const p of ["Microsoft 365", "Google Workspace", "Amazon Web Services"]) await page.getByRole("checkbox", { name: new RegExp(p) }).check();
  await next(page);
  for (const name of ["Microsoft Entra ID tenant", "Gmail mailboxes", "AWS data stores"]) {
    await page.getByRole("button", { name: new RegExp(`^Add crown jewel: ${name}`) }).click();
    await page.getByRole("button", { name: "Save crown jewel" }).click();
  }
  await next(page);
  for (const fixture of ["m365-secure-scan.json", "prowler-aws.csv", "ScubaResults.json"]) {
    await page.getByTestId("scan-input").setInputFiles(`e2e/fixtures/${fixture}`);
    const preview = page.getByTestId("scan-preview");
    await preview.getByRole("button", { name: /^Apply \d+ answers?$/ }).click();
    await expect(page.getByText(/Imported \d+ answers? from the scan of/).last()).toBeVisible();
  }
  const imports = JSON.parse(d.db.get("crownguard:v1")!).state.assessment.imports as { source: string }[];
  expect(imports.map((i) => i.source)).toHaveLength(3);

  await next(page);
  await next(page);
  await expect(page.getByRole("heading", { name: "Which AI tools and agents do you use?" })).toBeVisible();
  await page.getByRole("button", { name: "Load example entries" }).click();
  await page.getByRole("button", { name: "Download XLSX" }).click();
  await expect.poll(() => [...d.files.keys()].find((k) => k.endsWith(".xlsx"))).toBeTruthy();
  const xlsx = d.files.get([...d.files.keys()].find((k) => k.endsWith(".xlsx"))!)!;
  expect(text(xlsx.slice(0, 2))).toBe("PK");
  expect(d.external).toEqual([]);
  expect(d.unknown).toEqual([]);
});

test("closing and reopening restores the assessment, step and section from SQLite", async ({ page, context, baseURL }) => {
  const d = await desktop(page, baseURL!);
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Resume Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Microsoft 365/ }).check();
  await next(page);
  await page.getByRole("button", { name: /^Add crown jewel:/ }).first().click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  const second = page.getByRole("button", { name: /\d+\/\d+$/ }).nth(1);
  const section = (await second.textContent())!.replace(/\d+\/\d+$/, "").trim();
  await second.click();
  await page.locator("article[data-question]").first().getByRole("radio", { name: "No", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();
  await expect.poll(() => JSON.parse(d.db.get("crownguard:v1") ?? "{}").state?.assessment?.progress?.section).toBeTruthy();
  await page.close();

  // A new window over the same database: nothing carried over in browser storage.
  const again = await context.newPage();
  await desktop(again, baseURL!, d);
  await again.goto("./");
  expect(await again.evaluate(() => localStorage.length)).toBe(0);
  await expect(again.getByText("Welcome back")).toBeVisible();
  await again.getByRole("button", { name: "Continue where you left off" }).click();
  await expect(again.getByRole("heading", { name: section, level: 2 })).toBeVisible();
  await expect(again.locator("article[data-question]").first().getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("an encrypted assessment reaches SQLite and disk only as its envelope", async ({ page, baseURL }) => {
  const d = await desktop(page, baseURL!);
  await page.goto("./");
  await page.getByRole("button", { name: "Protect with a passphrase" }).click();
  await page.getByRole("textbox", { name: /^Passphrase/ }).fill("correct horse battery");
  await page.getByLabel("Confirm passphrase").fill("correct horse battery");
  await page.getByRole("button", { name: "Apply passphrase" }).click();
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Secretive Holdings");
  await next(page);
  await expect.poll(() => d.db.get("crownguard:v1") ?? "").toContain("crownguardEncrypted");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => d.files.size).toBe(1);

  // Every value that crossed into "SQLite" or onto "disk" is ciphertext.
  const everything = JSON.stringify(d.calls) + [...d.files.values()].map(text).join("");
  expect(everything).not.toContain("Secretive Holdings");
  expect(JSON.parse(d.db.get("crownguard:v1")!)).toHaveProperty("crownguardEncrypted", 1);
  expect(JSON.parse(text([...d.files.values()][0]))).toHaveProperty("crownguardEncrypted", 1);
});

test("files round-trip between the web app and the desktop app, and Ctrl/⌘ S saves back to the opened file", async ({ page, browser, baseURL }) => {
  const d = await desktop(page, baseURL!);
  // A file saved by the web app opens on desktop through the native dialog.
  const webFile = await readFile("e2e/fixtures/current.crownguard.json");
  d.files.set("/home/tester/from-web.crownguard.json", new Uint8Array(webFile));
  d.openPaths.push("/home/tester/from-web.crownguard.json");
  await page.goto("./");
  await page.getByRole("button", { name: "Open file" }).click();
  const org = JSON.parse(webFile.toString()).org.name as string;
  await expect(page.getByText(`Opened ${org}. Picking up at`, { exact: false })).toBeVisible();

  // Save goes straight back to the same file: no save dialog.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status").filter({ hasText: "Saved to from-web.crownguard.json" })).toBeVisible();
  expect(d.calls.filter((c) => c.cmd === "plugin:dialog|save")).toHaveLength(0);
  const saved = d.files.get("/home/tester/from-web.crownguard.json")!;
  expect(JSON.parse(text(saved)).org.name).toBe(org);

  // The desktop file opens in the web app, and the web app saves exactly the same file (apart from when it was saved).
  const web = await browser.newPage({ baseURL: "http://localhost:4173" });
  await web.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await web.goto("./");
  await web.getByTestId("import-input").setInputFiles({ name: "from-desktop.crownguard.json", mimeType: "application/json", buffer: Buffer.from(saved) });
  await expect(web.getByText(`Opened ${org}. Picking up at`, { exact: false })).toBeVisible();
  const download = web.waitForEvent("download");
  await web.getByRole("button", { name: "Save file" }).click();
  const fromWeb = JSON.parse(await readFile(await (await download).path(), "utf8"));
  const fromDesktop = JSON.parse(text(saved));
  for (const f of [fromWeb, fromDesktop]) delete f.savedBy.savedAt;
  expect(fromDesktop).toEqual(fromWeb);
  await web.close();
  expect(d.unknown).toEqual([]);
});

test("the CSP blocks network requests from the webview, and external links open only after confirming", async ({ page, baseURL }) => {
  const d = await desktop(page, baseURL!);
  await page.goto("./");
  const result = await page.evaluate(() =>
    fetch("https://example.com").then(
      () => "allowed",
      (e: Error) => `blocked: ${e.message}`,
    ),
  );
  expect(result).toMatch(/^blocked/);
  expect(await cspViolations(page)).toContainEqual(expect.stringMatching(/^connect-src https:\/\/example\.com/));
  expect(d.external).toEqual([]);

  // A footer link: no navigation, a confirmation, then the system browser.
  await page.getByRole("link", { name: "GitHub issue" }).click();
  await expect.poll(() => d.opened).toEqual(["https://github.com/jusso-dev/crownguard/issues"]);
  expect(d.asked[0]).toContain("https://github.com/jusso-dev/crownguard/issues");
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
});

test("the PDF is generated from bundled fonts only", async ({ page, baseURL }) => {
  const d = await desktop(page, baseURL!);
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (/\.(ttf|woff2?)$/.test(r.url())) fonts.push(new URL(r.url()).origin);
  });
  await page.goto("./#/ai-register");
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Microsoft 365 Copilot" }).click();
  await next(page);
  await next(page);
  await next(page);
  await page.getByRole("button", { name: "Generate PDF report" }).click();
  await expect.poll(() => [...d.files.keys()].find((k) => k.endsWith(".pdf")), { timeout: 60_000 }).toBeTruthy();
  const pdf = d.files.get([...d.files.keys()].find((k) => k.endsWith(".pdf"))!)!;
  expect((await pdfText(pdf))[0]).toContain("Riverbend Health");
  expect(new Set(fonts)).toEqual(new Set([new URL(baseURL!).origin]));
  expect(d.external).toEqual([]);
});
