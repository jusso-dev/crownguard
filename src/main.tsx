import "./zodConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./index.css";
import { App } from "./App";

/**
 * React sets some DOM properties via innerHTML (style/script hoistables). With
 * `require-trusted-types-for 'script'`, those assignments need a Trusted Types policy.
 * A `default` policy lets the browser pass strings through that sink; we don't mint HTML from untrusted input ourselves.
 */
type TrustedTypePolicyFactory = {
  defaultPolicy: unknown;
  createPolicy: (
    name: string,
    rules: { createHTML?: (s: string) => string; createScript?: (s: string) => string; createScriptURL?: (s: string) => string },
  ) => unknown;
};
const tt = (window as unknown as { trustedTypes?: TrustedTypePolicyFactory }).trustedTypes;
if (tt && !tt.defaultPolicy) {
  tt.createPolicy("default", {
    createHTML: (s: string) => s,
    createScript: (s: string) => s,
    createScriptURL: (s: string) => s,
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
