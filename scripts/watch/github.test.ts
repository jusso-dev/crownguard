import { describe, expect, it } from "vitest";
import { compareUrl, createGitHub, markdownBody } from "./github";

describe("github helpers", () => {
  it("compares Learn Markdown without front matter or comments", () => {
    expect(markdownBody("---\ntitle: X\nms.date: 01/01/2026\n---\n# Title\n\n<!-- hidden -->\nBody  text\n")).toBe("# Title\nBody text");
    expect(compareUrl("MicrosoftDocs/entra-docs", "aaa", "bbb", "docs/a.md")).toMatch(/^https:\/\/github\.com\/MicrosoftDocs\/entra-docs\/compare\/aaa\.\.\.bbb#diff-[0-9a-f]{64}$/);
  });

  it("checks a mirror once per run and stops at the rate limit", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (url.endsWith("/repos/MicrosoftDocs/entra-docs")) return new Response(JSON.stringify({ private: false }), { status: 200 });
      if (url.endsWith("/repos/MicrosoftDocs/security")) return new Response("{}", { status: 404 });
      return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" } });
    }) as typeof fetch;
    const gh = createGitHub({ fetchImpl });
    expect(await gh.repoExists("MicrosoftDocs/entra-docs")).toBe(true);
    expect(await gh.repoExists("MicrosoftDocs/entra-docs")).toBe(true);
    expect(await gh.repoExists("MicrosoftDocs/security")).toBe(false);
    expect(await gh.repoExists("not a repo")).toBe(false);
    expect(calls).toBe(2);
    expect(await gh.commitsBetween("MicrosoftDocs/entra-docs", "docs/a.md", "a", "b")).toBeUndefined();
    expect(gh.limited()).toMatch(/rate limit/);
    expect(await gh.commitsBetween("MicrosoftDocs/entra-docs", "docs/a.md", "a", "b")).toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe("github size cap", () => {
  it("treats a raw file or API response larger than maxBytes as a miss without reading it all", async () => {
    let pulled = 0;
    const big = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            if (pulled > 1000) controller.close();
            else controller.enqueue(new Uint8Array(1024).fill(0x5b));
          },
        }),
        { status: 200 },
      );
    const gh = createGitHub({ fetchImpl: (async () => big()) as typeof fetch, maxBytes: 8 * 1024 });
    expect(await gh.fileAt("MicrosoftDocs/entra-docs", "main", "docs/a.md")).toBeUndefined();
    expect(pulled).toBeLessThan(20);
    pulled = 0;
    expect(await gh.repoExists("MicrosoftDocs/entra-docs")).toBe(false);
    expect(pulled).toBeLessThan(20);
    const small = createGitHub({ fetchImpl: (async () => new Response("# Title\n", { status: 200 })) as typeof fetch, maxBytes: 8 * 1024 });
    expect(await small.fileAt("MicrosoftDocs/entra-docs", "main", "docs/a.md")).toBe("# Title\n");
  });
});
