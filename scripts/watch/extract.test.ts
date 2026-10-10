import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractHtml, lifecycleDates, lifecycleLine } from "./extract";
import { checkFeeds, parseFeed, parseHtmlHistory } from "./feeds";
import type { FeedMemo } from "./types";
import { compareUrl, createGitHub, markdownBody } from "./github";
import { licenceFor, profileFor } from "./hosts";
import { parseToc, sectionOf, tocHref, tocUrlFor } from "./learn";

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

describe("feeds", () => {
  it("warns when a feed's window skipped entries no run read, or dropped items still waiting in the pull request", async () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>2</id><title>Newer post</title><link href="https://blog.test/2"/><published>2026-10-05T00:00:00Z</published></entry><entry><id>1</id><title>Post</title><link href="https://blog.test/1"/><published>2026-09-25T00:00:00Z</published></entry></feed>`;
    const fetcher = { fetchPage: async (url: string) => ({ requestedUrl: url, finalUrl: url, redirects: [], elapsedMs: 1, status: 200, outcome: "ok" as const, body: xml }) };
    const def = { id: "t", name: "Test", url: "https://feeds.test/atom", kind: "posts" as const, include: [/nothing matches/] };
    const cursor = { t: { latest: "2026-09-01T00:00:00.000Z", seen: [] } };
    const memory: Record<string, FeedMemo> = { t: { lastRead: "2026-09-10T00:00:00.000Z", reported: { abc123: "2026-09-12T00:00:00.000Z" } } };
    const behind = await checkFeeds([def], cursor, fetcher, new Map(), memory);
    expect(behind.skipped.join(" ")).toMatch(/entries between 2026-09-10 and 2026-09-25 were never read/);
    expect(behind.skipped.join(" ")).toMatch(/1 item reported earlier left the feed's window/);
    expect(memory.t).toEqual({ lastRead: "2026-10-05T00:00:00.000Z", reported: {} });
    // A strict filter keeps the cursor behind, but everything was read last time: nothing to warn about.
    const again = await checkFeeds([def], cursor, fetcher, new Map(), memory);
    expect(again.skipped).toEqual([]);
  });

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
    const def = {
      id: "scc",
      name: "Security Command Center",
      url: "https://x.test/feed",
      kind: "release-notes" as const,
      noteTypes: ["Deprecated"],
      linksToCited: true,
      excerpts: true,
      licence: { label: "CC BY 4.0, Google", url: "https://creativecommons.org/licenses/by/4.0/" },
    };
    const first = await checkFeeds([def], {}, fetcher, cited);
    expect(first.findings.map((f) => f.kind)).toEqual(["baseline"]);
    // Entries the filter drops don't move the cursor.
    const quiet = await checkFeeds([{ ...def, noteTypes: ["Breaking"], linksToCited: false }], { scc: { latest: "2026-10-01T00:00:00.000Z" } }, fetcher, cited);
    expect(quiet.findings).toEqual([]);
    expect(quiet.feeds.scc.latest).toBe("2026-10-01T00:00:00.000Z");
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

describe("GitHub releases Atom and Security Hub history", () => {
  it("parses a releases Atom feed and reports mapping review with the pinned version", async () => {
    const xml = fixture("prowler-releases.atom");
    const entries = parseFeed(xml);
    expect(entries.map((e) => e.title)).toEqual(["Prowler 5.45.0", "Prowler 5.44.0", "Prowler 5.43.0"]);
    const fetcher = {
      fetchPage: async (url: string) => ({ requestedUrl: url, finalUrl: url, redirects: [], elapsedMs: 1, status: 200, outcome: "ok" as const, body: xml }),
    };
    const def = {
      id: "prowler-releases",
      name: "Prowler releases",
      url: "https://github.com/prowler-cloud/prowler/releases.atom",
      kind: "posts" as const,
      include: [/^\s*Prowler\s+\d+\.\d+/i],
      reviewMapping: { file: "content/imports/prowler-aws.yaml", pinned: "5.44.0" },
      max: 3,
    };
    // Cursor after 5.44.0 so only 5.45.0 is new.
    const run = await checkFeeds([def], { "prowler-releases": { latest: "2026-09-30T00:00:00.000Z", seen: [] } }, fetcher, new Map());
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].title).toBe("Prowler 5.45.0");
    expect(run.findings[0].detail).toMatch(/mapping may need review \(pinned 5\.44\.0 in content\/imports\/prowler-aws\.yaml\)/);
  });

  it("filters Security Hub document-history rows to Bedrock, AgentCore and FSBP", () => {
    const page = "https://docs.aws.amazon.com/securityhub/latest/userguide/doc-history.html";
    const entries = parseHtmlHistory(fixture("aws-securityhub-doc-history.html"), page);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    const def = {
      id: "aws-securityhub-doc-history",
      name: "AWS Security Hub CSPM document history",
      url: page,
      kind: "html-history" as const,
      include: [/\b(?:Bedrock|AgentCore|FSBP|Foundational Security Best Practices)\b/i],
      max: 5,
    };
    const fetcher = {
      fetchPage: async () => ({
        requestedUrl: page,
        finalUrl: page,
        redirects: [],
        elapsedMs: 1,
        status: 200,
        outcome: "ok" as const,
        body: fixture("aws-securityhub-doc-history.html"),
      }),
    };
    return checkFeeds([def], { "aws-securityhub-doc-history": { latest: "2026-06-01T00:00:00.000Z", seen: [] } }, fetcher, new Map()).then((run) => {
      const blob = run.findings.map((f) => `${f.title}\n${f.detail}\n${f.candidate?.summary ?? ""}`).join("\n");
      expect(blob).toMatch(/Bedrock|AgentCore|FSBP|Foundational/i);
      expect(run.findings.length).toBeGreaterThanOrEqual(2);
      expect(run.findings.every((f) => !/Clarified IAM\.1/.test(`${f.title}\n${f.detail}\n${f.candidate?.summary ?? ""}`))).toBe(true);
    });
  });
});
