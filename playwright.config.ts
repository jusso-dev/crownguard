import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const desktopPort = 4174;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${port}`,
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /desktop\.spec\.ts/ },
    // The desktop build in a browser, with the desktop CSP and a stand-in for the Tauri runtime (e2e/desktop.spec.ts).
    { name: "desktop", use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${desktopPort}` }, testMatch: /desktop\.spec\.ts/ },
  ],
  // Test the production builds so the CSP headers are exercised.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        { command: `pnpm build && pnpm preview --port ${port} --strictPort`, port, reuseExistingServer: !process.env.CI, timeout: 180_000 },
        {
          command: `pnpm build:desktop && pnpm exec vite preview --mode desktop --port ${desktopPort} --strictPort`,
          port: desktopPort,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ],
});
