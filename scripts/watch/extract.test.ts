import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractHtml, lifecycleDates, lifecycleLine } from "./extract";
import { licenceFor, profileFor } from "./hosts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const learn = profileFor("learn.microsoft.com");

function learnHtml(body: string, opts: { h1?: string; meta?: string; parts?: number } = {}) {
  const h1 = opts.h1 ?? "Require MFA for all users";
  const extra = opts.parts === 3 ? '<div class="content"><p>stray</p></div>' : "";
  return `<html><head><title>SEO title that changes | Microsoft Learn</title>
<meta property="og:title" content="SEO title that changes">
<meta name="original_content_git_url" content="https://github.com/MicrosoftDocs/entra-docs-pr/blob/live/docs/ca/page.md">
<meta name="git_commit_id" content="${"c".repeat(40)}">
<meta name="github_feedback_content_git_url" content="https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/ca/page.md">
<meta name="document_id" content="d-1"><meta name="toc_rel" content="../toc.json"><meta name="ms.date" content="2026-03-24T00:00:00Z">
${opts.meta ?? ""}</head><body><main id="main"><div data-main-column><div>
<div class="content"><h1>${h1}</h1><div id="article-metadata"><div id="user-feedback">Feedback</div></div></div>
<div class="content">${body}</div>${extra}
</div></div>
<div id="article-metadata-footer"><span>Last updated on <local-time datetime="2026-03-12T08:00:00.000Z" data-article-date-source="calculated">2026-03-12</local-time></span></div>
</main></body></html>`;
}

describe("extractHtml on Learn", () => {
  it("reads the h1, both content parts, sections, metadata and the displayed date", () => {
    const e = extractHtml(learnHtml("<h2>Overview</h2><p>MFA matters.</p><h2>Steps</h2><p>Create a policy.</p><script>track()</script>"), learn);
    expect(e.title).toBe("Require MFA for all users");
    expect(e.text).toBe("Require MFA for all users\nOverview\nMFA matters.\nSteps\nCreate a policy.");
    expect(e.sections.map((s) => s.h)).toEqual(["(top)", "Overview", "Steps"]);
    expect(e.updated).toBe("2026-03-12");
    expect(e.matchedSelector).toBe(true);
    expect(e.learn).toMatchObject({
      sourceRepo: "MicrosoftDocs/entra-docs-pr",
      path: "docs/ca/page.md",
      commit: "c".repeat(40),
      publicRepo: "MicrosoftDocs/entra-docs",
      publicBranch: "main",
      documentId: "d-1",
      tocRel: "../toc.json",
    });
  });

  it("keeps hidden tab panels, which Learn uses for tabbed content", () => {
    const e = extractHtml(learnHtml('<div class="tabGroup"><section>Portal steps</section><section hidden>PowerShell steps</section></div>'), learn);
    expect(e.text).toContain("PowerShell steps");
  });

  it("says when the layout no longer matches", () => {
    expect(extractHtml(learnHtml("<p>x</p>", { parts: 3 }), learn).matchedSelector).toBe(false);
    expect(extractHtml("<html><body><main><p>Something else</p></main></body></html>", learn).matchedSelector).toBe(false);
  });

  it("recognises retired and archived pages, but not notes about a feature retiring", () => {
    expect(extractHtml(learnHtml("<p>x</p>", { h1: "Old agent (retired)" }), learn).retired).toBe("title marks it as retired");
    expect(extractHtml(learnHtml("<p>x</p>", { meta: '<meta name="is_archived" content="true">' }), learn).retired).toMatch(/archived/);
    const notice = extractHtml(learnHtml('<div class="NOTE"><p>Note</p><p>This article is for the classic version of DSPM for AI that is now replaced with a new version.</p></div><p>Body</p>'), learn);
    expect(notice.retired).toBe('a notice at the top says "classic version of"');
    const feature = extractHtml(learnHtml('<p>Intro</p><div class="WARNING"><p>The legacy risk policies will be retired on October 1, 2026.</p></div>'), learn);
    expect(feature.retired).toBeUndefined();
    expect(feature.terms).toContain("will be retired");
  });

  it("only takes notices above the first section heading as page-level retirement", () => {
    const deep = extractHtml(learnHtml('<h2>Overview</h2><p>Body</p><h2>Legacy MFA</h2><div class="NOTE"><p>This feature is deprecated. Convert per-user MFA to Conditional Access.</p></div>'), learn);
    expect(deep.retired).toBeUndefined();
    const top = extractHtml(learnHtml('<div class="IMPORTANT"><p>This feature is deprecated.</p></div><h2>Overview</h2><p>Body</p>'), learn);
    expect(top.retired).toBe('a notice at the top says "this feature is deprecated"');
  });

  it("reads Google DevSite deprecation asides", () => {
    const html = `<html lang="en"><head><meta property="og:title" content="Old tool | Admin | Google Workspace Help"></head><body>
<article class="devsite-article"><div class="devsite-article-body"><aside class="caution">This feature is deprecated and no longer supported.</aside><p>Body</p></div></article></body></html>`;
    expect(extractHtml(html, profileFor("knowledge.workspace.google.com")).retired).toBe('a notice at the top says "this feature is deprecated"');
  });

  it("falls back to og:locale when a page has no html lang, as AWS blog posts do", () => {
    const aws = profileFor("aws.amazon.com");
    const page = (head: string, lang = "") =>
      `<html${lang}><head>${head}</head><body><main id="aws-page-content-main"><h2>Steps</h2><p>Grant temporary elevated access.</p></main></body></html>`;
    expect(extractHtml(page('<meta property="og:locale" content="en_US">'), aws).lang).toBe("en-US");
    expect(aws.lang?.test("en-US")).toBe(true);
    expect(extractHtml(page('<meta property="og:locale" content="fr_FR">', ' lang="en-US"'), aws).lang).toBe("en-US");
    expect(extractHtml(page(""), aws).lang).toBeUndefined();
  });

  it("flags hub pages as landing pages", () => {
    const e = extractHtml(learnHtml('<ul><li><a href="a">Alpha</a></li><li><a href="b">Beta</a></li></ul>', { meta: '<meta name="ms.topic" content="landing-page">' }), learn);
    expect(e.isLanding).toBe(true);
  });
});

describe("lifecycle dates", () => {
  it("reads dates from lines about retirement or switching things off", () => {
    const lines = [
      "The legacy risk policies configured in ID Protection will be retired on October 1, 2026.",
      "Beginning 30 September 2025, methods can't be managed in the legacy policies, and they will no longer be supported.",
      "Basic authentication for SMTP AUTH will be disabled by default at the end of December 2026.",
      "Windows 10 reached end of support on 2025-10-14.",
      "Released on 12 March 2026 with new reports.",
    ];
    expect(lifecycleDates(lines)).toEqual(["2025-09-30", "2025-10-14", "2026-10-01", "2026-12-31"]);
    expect(lifecycleLine(lines, "2026-12-31")).toBe(lines[2]);
    expect(lifecycleLine(lines, "2026-03-12")).toBeUndefined();
  });

  it("reads a date from a sentence the page's HTML source hard-wraps, without changing the fingerprinted text", () => {
    const html = `<html lang="en"><head><meta property="og:title" content="Reports | Admin | Google Workspace Help"></head><body>
<article class="devsite-article"><div class="devsite-article-body"><p>The legacy reports page will be retired on
January 15, 2027. Use the new reports instead.</p></div></article></body></html>`;
    const e = extractHtml(html, profileFor("knowledge.workspace.google.com"));
    expect(e.deadlines).toEqual(["2027-01-15"]);
    expect(e.text).toBe("The legacy reports page will be retired on\nJanuary 15, 2027. Use the new reports instead.");
    expect(lifecycleLine(e.blocks, "2027-01-15")).toBe("The legacy reports page will be retired on January 15, 2027. Use the new reports instead.");
  });
});

describe("licenceFor", () => {
  it("allows quotes only from openly licensed pages", () => {
    expect(licenceFor("https://knowledge.workspace.google.com/admin/x")?.label).toBe("CC BY 4.0, Google");
    expect(licenceFor("https://support.google.com/chrome/a/answer/1")).toBeUndefined();
    expect(licenceFor("https://learn.microsoft.com/en-us/purview/x")).toBeUndefined();
    expect(licenceFor("https://learn.microsoft.com/en-us/entra/x", "MicrosoftDocs/entra-docs")?.label).toMatch(/^MIT/);
    expect(licenceFor("https://learn.microsoft.com/en-us/x", "MicrosoftDocs/defender-docs")).toBeUndefined();
    expect(licenceFor("https://www.digital.gov.au/ai/ai-in-government-policy/accountability")?.label).toMatch(/^CC BY 4\.0/);
    expect(licenceFor("not a url")).toBeUndefined();
  });
});

describe("digital.gov.au profile", () => {
  const dta = profileFor("www.digital.gov.au");
  const html = fixture("dta-accountability.html");

  it("reads main text only and keeps a stable hash across two extracts", () => {
    const a = extractHtml(html, dta);
    const b = extractHtml(html, dta);
    expect(a.matchedSelector).toBe(true);
    expect(a.text).toContain("Agencies must designate accountability");
    expect(a.text).toContain("Accountable officials");
    expect(a.text).not.toContain("Site nav");
    expect(a.text).not.toContain("Side links");
    expect(a.text).not.toContain("Was this page helpful");
    expect(a.text).not.toContain("LAST UPDATED");
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.sections.map((s) => s.h)).toEqual(["Standard for accountability", "Accountable officials"]);
  });
});
