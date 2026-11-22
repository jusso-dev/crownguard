import { expect, type Page } from "@playwright/test";

interface ImportProbe {
  reads: string[];
  pending: Record<string, (fail: boolean) => void>;
}
type ProbeWindow = Window & { importProbe?: ImportProbe };

/** Tiny real Files with controlled metadata and promises. No large allocation or production bypass. */
export async function chooseImportFiles(page: Page, input: string, files: { name: string; text: string; size?: number; deferred?: boolean }[]) {
  await page.getByTestId(input).evaluate((element, files) => {
    const probe = (window as ProbeWindow).importProbe ??= { reads: [], pending: {} };
    const transfer = new DataTransfer();
    for (const spec of files) {
      const file = new File([spec.text], spec.name, { type: "application/json" });
      if (spec.size !== undefined) Object.defineProperty(file, "size", { value: spec.size });
      Object.defineProperty(file, "text", { value: () => {
        probe.reads.push(spec.name);
        if (!spec.deferred) return Promise.resolve(spec.text);
        return new Promise<string>((resolve, reject) => {
          probe.pending[spec.name] = (fail) => { delete probe.pending[spec.name]; if (fail) reject(new Error("controlled read failure")); else resolve(spec.text); };
        });
      } });
      transfer.items.add(file);
    }
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, files);
}

export async function releaseImport(page: Page, name: string, fail = false) {
  await page.evaluate(async ({ name, fail }) => {
    (window as ProbeWindow).importProbe!.pending[name](fail);
    // Let the import continuation and React's state updates finish without a timing sleep.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { name, fail });
}

export const importReads = (page: Page) => page.evaluate(() => (window as ProbeWindow).importProbe?.reads ?? []);

/** Shared web/desktop assertion for the actual File.size boundary and same-file retry. */
export async function rejectScanBeforeRead(page: Page) {
  const oversized = { name: "oversized.json", text: "{}", size: 8_000_001 };
  for (let attempt = 0; attempt < 2; attempt++) {
    await chooseImportFiles(page, "scan-input", [oversized]);
    await expect(page.getByRole("alert")).toContainText("8 MB (8,000,000 byte) limit");
    await expect(page.getByTestId("scan-preview")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Apply \d+ answers?$/ })).toHaveCount(0);
  }
  expect(await importReads(page)).not.toContain("oversized.json");
}
