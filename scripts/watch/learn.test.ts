import { describe, expect, it } from "vitest";
import { parseToc, sectionOf, tocHref, tocUrlFor } from "./learn";

describe("Learn tables of contents", () => {
  const tocUrl = "https://learn.microsoft.com/en-us/entra/identity/toc.json";

  it("resolves hrefs like Learn does", () => {
    expect(tocHref("conditional-access/overview", tocUrl)).toBe("https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview");
    expect(tocHref("/purview/purview?toc=/purview/toc.json&bc=/x", tocUrl)).toBe("https://learn.microsoft.com/en-us/purview/purview");
    expect(tocHref("https://example.com/x", tocUrl)).toBeUndefined();
    expect(tocUrlFor("https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview", "../toc.json")).toBe(tocUrl);
  });

  it("finds the section that lists a page", () => {
    const nodes = parseToc(
      { items: [{ toc_title: "Identity", children: [{ toc_title: "Conditional Access", children: [{ toc_title: "Overview", href: "conditional-access/overview" }, { toc_title: "Plan", href: "conditional-access/plan" }, { toc_title: "Group" }] }] }] },
      tocUrl,
    );
    const section = sectionOf(nodes, "https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan");
    expect(section?.path).toBe("Identity > Conditional Access");
    expect(section?.pages.map((p) => p.title)).toEqual(["Overview", "Plan"]);
    expect(sectionOf(nodes, "https://learn.microsoft.com/en-us/nowhere")).toBeUndefined();
    expect(sectionOf(nodes, "https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan?view=o365-worldwide")?.path).toBe("Identity > Conditional Access");
  });
});
