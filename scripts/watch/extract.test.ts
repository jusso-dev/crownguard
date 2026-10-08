import { describe, expect, it } from "vitest";
import { extractHtml } from "./extract";
import { checkFeeds, parseFeed } from "./feeds";
import { compareUrl, createGitHub, markdownBody } from "./github";
import { profileFor } from "./hosts";
import { parseToc, sectionOf, tocHref, tocUrlFor } from "./learn";

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
    expect(notice.retired).toMatch(/notice at the top/);
    const feature = extractHtml(learnHtml('<p>Intro</p><div class="WARNING"><p>The legacy risk policies will be retired on October 1, 2026.</p></div>'), learn);
    expect(feature.retired).toBeUndefined();
    expect(feature.terms).toContain("will be retired");
  });

  it("flags hub pages as landing pages", () => {
    const e = extractHtml(learnHtml('<ul><li><a href="a">Alpha</a></li><li><a href="b">Beta</a></li></ul>', { meta: '<meta name="ms.topic" content="landing-page">' }), learn);
    expect(e.isLanding).toBe(true);
  });
});

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
  });
});

describe("feeds", () => {
  it("reads Atom and RSS entries, newest first, skipping entries without dates or http links", () => {
    const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>a</id><title type="html">Passkeys &amp;lt;b&amp;gt;for admins&amp;lt;/b&amp;gt;</title><link rel="alternate" href="https://blog.test/a"/><published>2026-10-02T10:00:00Z</published><summary>New &lt;b&gt;controls&lt;/b&gt;</summary></entry>
<entry><id>b</id><title>No date</title><link href="https://blog.test/b"/></entry>
<entry><id>c</id><title>Bad link</title><link href="javascript:alert(1)"/><published>2026-10-03T10:00:00Z</published></entry></feed>`);
    expect(atom.map((e) => [e.title, e.url])).toEqual([["Passkeys for admins", "https://blog.test/a"]]);
    expect(atom[0].summary).toBe("New controls");
    const rss = parseFeed(`<rss><channel><item><title>Release note</title><link>https://cloud.test/n</link><guid>n1</guid><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate><description>Text</description></item></channel></rss>`);
    expect(rss).toEqual([{ id: "n1", title: "Release note", url: "https://cloud.test/n", published: "2026-10-05T00:00:00.000Z", summary: "Text", labels: [], links: [], notes: [] }]);
  });

  it("splits release notes into typed notes and reports deprecations or notes that link to cited pages", async () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>October 06, 2026</title><id>x#Oct_06</id><updated>2026-10-06T00:00:00-07:00</updated>
<link rel="alternate" href="https://docs.cloud.google.com/security-command-center/docs/release-notes#October_06_2026"/>
<content type="html"><![CDATA[<h3>Deprecated</h3><p>Artifact guard is deprecated. It will be shut down on October 30, 2026.</p>
<h3>Feature</h3><p>New detector. See <a href="https://cloud.google.com/security-command-center/docs/security-command-center-overview?hl=en">overview</a>.</p>
<h3>Feature</h3><p>Unrelated feature.</p>]]></content></entry></feed>`;
    const [entry] = parseFeed(xml);
    expect(entry.notes.map((n) => n.type)).toEqual(["Deprecated", "Feature", "Feature"]);
    const fetcher = { fetchPage: async () => ({ requestedUrl: "", finalUrl: "", redirects: [], status: 200, outcome: "ok" as const, body: xml, elapsedMs: 1 }) };
    const cited = new Map([["https://docs.cloud.google.com/security-command-center/docs/security-command-center-overview", "gcp-scc-overview"]]);
    const def = { id: "scc", name: "Security Command Center", url: "https://x.test/feed", kind: "release-notes" as const, noteTypes: ["Deprecated"], linksToCited: true, excerpts: true };
    const first = await checkFeeds([def], {}, fetcher, cited);
    expect(first.findings).toEqual([]);
    const run = await checkFeeds([def], { scc: { latest: "2026-10-01T00:00:00.000Z" } }, fetcher, cited);
    expect(run.findings.map((f) => f.title)).toEqual(["Security Command Center: Artifact guard is deprecated.", "Security Command Center: New detector."]);
    expect(run.findings[1].detail).toContain("links to cited source gcp-scc-overview");
    expect(run.feeds.scc.latest).toBe("2026-10-06T07:00:00.000Z");
  });
});

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
