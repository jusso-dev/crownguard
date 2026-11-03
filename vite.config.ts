/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crownguardContent } from "./scripts/vite-content";

/**
 * Production CSP. React `style` props go through the CSSOM and are not blocked.
 * `style-src 'self'` without `'unsafe-inline'` is intentional: production CSS is extracted to files.
 * If a dependency later needs inline `<style>` elements, prefer `style-src-elem` / `style-src-attr` over
 * restoring a blanket `'unsafe-inline'`, and document which dependency needs it.
 *
 * `require-trusted-types-for 'script'` is enforced; there is no `innerHTML` / `dangerouslySetInnerHTML` /
 * `eval` in `src/`. React assigns some hoistable markup via `innerHTML`, so `main.tsx` installs a
 * `default` Trusted Types policy (pass-through). Allow it explicitly so createPolicy is not blocked.
 */
export const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types default",
];
// frame-ancestors only works as a header, so it's left out of the meta tag.
export const csp = [...cspDirectives, "frame-ancestors 'none'"].join("; ");

/**
 * The desktop app's policy (`app.security.csp` in src-tauri/tauri.conf.json, checked against this by
 * scripts/desktop-config.test.ts). Same as the web policy, except that the webview may talk only to the Tauri IPC
 * bridge: no data:, blob: or network origins in connect-src. Tauri sends it as a header, so frame-ancestors applies.
 */
export const desktopCspDirectives = [
  ...cspDirectives.map((d) => (d.startsWith("connect-src ") ? "connect-src 'self' ipc: http://ipc.localhost" : d)),
  "frame-ancestors 'none'",
];

export const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": csp,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/**
 * GitHub Pages can't send custom headers, so production builds carry the policy as meta tags.
 * Dev skips them because Vite's hot reload injects inline scripts.
 */
const securityMeta = (): Plugin => ({
  name: "crownguard-security-meta",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: cspDirectives.join("; ") }, injectTo: "head-prepend" },
    { tag: "meta", attrs: { name: "referrer", content: "no-referrer" }, injectTo: "head-prepend" },
  ],
});

export default defineConfig(({ mode }) => ({
  // Served from /crownguard/ on GitHub Pages; BASE_PATH is set by the Pages workflow. The desktop build (mode
  // "desktop", run by `pnpm tauri:build`) is served by Tauri from its own root and gets its CSP from tauri.conf.json.
  base: mode === "desktop" ? "/" : (process.env.BASE_PATH ?? "/"),
  plugins: [crownguardContent(), react(), tailwindcss(), ...(mode === "desktop" ? [] : [securityMeta()])],
  build: mode === "desktop" ? { outDir: "dist-desktop" } : undefined,
  // `pnpm tauri:dev` loads the dev server from this fixed local port (build.devUrl in tauri.conf.json).
  server: mode === "desktop" ? { port: 1420, strictPort: true, host: "localhost" } : undefined,
  // The desktop preview (e2e/desktop.spec.ts) serves the desktop build with the policy Tauri would send.
  preview: { headers: mode === "desktop" ? { ...securityHeaders, "Content-Security-Policy": desktopCspDirectives.join("; ") } : securityHeaders },
  worker: {
    format: "es",
    // Worker bundles are a separate environment; they need the same content virtual modules.
    plugins: () => [crownguardContent()],
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["src/content/catalogue.setup.ts"],
  },
}));
