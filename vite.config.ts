/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

export default defineConfig({
  // Served from /crownguard/ on GitHub Pages; BASE_PATH is set by the Pages workflow.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), securityMeta()],
  preview: { headers: securityHeaders },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
