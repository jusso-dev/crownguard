/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Everything is served from our own origin. 'wasm-unsafe-eval' is needed by the PDF layout engine (yoga wasm).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": csp,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Emits a `_headers` file (read by many static hosts) so production gets the same headers as `vite preview`. */
const headersFile = (): Plugin => ({
  name: "crownguard-headers",
  apply: "build",
  generateBundle() {
    const lines = Object.entries(securityHeaders).map(([k, v]) => `  ${k}: ${v}`);
    this.emitFile({ type: "asset", fileName: "_headers", source: `/*\n${lines.join("\n")}\n` });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), headersFile()],
  preview: { headers: securityHeaders },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});