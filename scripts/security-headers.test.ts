import { describe, expect, it } from "vitest";
import { csp, securityHeaders } from "../vite.config";
import { readRepoFile } from "./lib/repo";

describe("docs/self-hosting.md matches securityHeaders", () => {
  const doc = readRepoFile("docs/self-hosting.md");

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
