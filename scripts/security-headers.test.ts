import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csp, securityHeaders } from "../vite.config";

describe("docs/self-hosting.md matches securityHeaders", () => {
  const doc = readFileSync(join("docs", "self-hosting.md"), "utf8");

  it("documents every header name and the full CSP string", () => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      expect(doc, `missing header name ${name}`).toContain(name);
      expect(doc, `missing header value for ${name}`).toContain(value);
    }
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(securityHeaders["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
});
