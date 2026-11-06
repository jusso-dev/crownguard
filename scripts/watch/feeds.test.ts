import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFeeds, parseFeed, parseHtmlHistory } from "./feeds";
import type { FeedMemo } from "./types";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

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

  it("ignores entries dated after the run, so one future-dated post can't carry the cursor past later real posts", async () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    const entry = (id: string, date: string) => `<entry><id>${id}</id><title>Security update ${id}</title><link href="https://blog.test/${id}"/><published>${date}</published></entry>`;
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">${entry("typo", "2062-10-02T00:00:00Z")}${entry("real", "2026-11-02T00:00:00Z")}</feed>`;
    const fetcher = { fetchPage: async (url: string) => ({ requestedUrl: url, finalUrl: url, redirects: [], elapsedMs: 1, status: 200, outcome: "ok" as const, body: xml }) };
    const def = { id: "t", name: "Test", url: "https://feeds.test/atom", kind: "posts" as const, include: [/Security update/] };
    const run = await checkFeeds([def], { t: { latest: "2026-10-01T00:00:00.000Z", seen: [] } }, fetcher, new Map(), {}, now);
    expect(run.findings.map((f) => f.title)).toEqual(["Security update real"]);
    expect(run.feeds.t.latest).toBe("2026-11-02T00:00:00.000Z");
    expect(run.skipped.join(" ")).toMatch(/ignored 1 entry dated after 2026-11-04/);
    // A cursor an earlier run already pushed into the future is dropped and the feed is followed again from now.
    const stuck = await checkFeeds([def], { t: { latest: "2062-10-02T00:00:00.000Z", seen: [] } }, fetcher, new Map(), {}, now);
    expect(stuck.feeds.t.latest).toBe("2026-11-02T00:00:00.000Z");
    expect(stuck.skipped.join(" ")).toMatch(/saved cursor 2062-10-02 is in the future/);
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

