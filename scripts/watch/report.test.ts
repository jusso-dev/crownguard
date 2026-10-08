import { describe, expect, it } from "vitest";
import { emptyState } from "./apply";
import { link, md, prTitle, renderReport, summaryLine } from "./report";
import type { Finding, RunResult } from "./types";

const result = (findings: Finding[], over: Partial<RunResult> = {}): RunResult => ({
  date: "2026-10-09",
  findings,
  actionable: findings.some((f) => f.actionable),
  state: emptyState(),
  urlUpdates: {},
  stats: { checked: 3, byHost: { "learn.microsoft.com": 2, "knowledge.workspace.google.com": 1 }, outcomes: { ok: 3 }, githubCalls: 4, triageCalls: 0, durationMs: 12_000, skipped: [] },
  simulated: false,
  ...over,
});

const changed: Finding = {
  kind: "changed",
  sourceId: "ms-ca-plan",
  title: "Plan a Conditional Access deployment",
  url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan-conditional-access",
  severity: "major",
  actionable: true,
  detail: "2 sections added; 14% of the text changed (+300/−40 words)",
  citedBy: ["MS-ID-001", "framework:ms-zero-trust"],
  change: {
    changedRatio: 0.14,
    wordsAdded: 300,
    wordsRemoved: 40,
    sectionsAdded: ["Rollout plan"],
    sectionsRemoved: [],
    sectionsChanged: ["Prerequisites"],
    termsAdded: ["entra id p2"],
    termsRemoved: [],
    commits: [{ sha: "cf1507d526aa", date: "2026-10-01", message: "Refresh CA planning guidance", url: "https://github.com/MicrosoftDocs/entra-docs/commit/cf1507d526aa" }],
    compareUrl: "https://github.com/MicrosoftDocs/entra-docs/compare/aaa...bbb",
    excerpt: "- Old line\n+ New line with ``` fence",
    excerptNote: "CC BY 4.0, Microsoft",
  },
};

describe("md escaping", () => {
  it("neutralises markdown, HTML, mentions, issue references and links from page text", () => {
    const evil = "**bold** [x](javascript:alert(1)) <img src=x> @octocat Fixes #12, GH-7, owner/repo#3, https://x.test www.y.test /issues/9 &#64;team\n# heading";
    const out = md(evil, 400);
    expect(out).not.toMatch(/(^|[^\\])\*\*/);
    expect(out).not.toContain("<img");
    // What GitHub would turn into a mention, reference or link:
    expect(out).not.toMatch(/@\w/);
    expect(out).not.toMatch(/#\d/);
    expect(out).not.toMatch(/\bgh-\d/i);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toMatch(/\bwww\.\w/);
    expect(out).not.toMatch(/\/issues\/\d/);
    expect(out).not.toContain("&#64;team");
    expect(out).not.toContain("\n");
  });

  it("only links http(s) URLs", () => {
    expect(link("x", "javascript:alert(1)")).toBe("x");
    expect(link("Doc (v2)", "https://example.com/a (b)")).toBe("[Doc (v2)](https://example.com/a%20%28b%29)");
  });
});

describe("renderReport", () => {
  it("leads with what needs attention and keeps minor changes collapsed", () => {
    const minor: Finding = { ...changed, sourceId: "ms-other", severity: "minor", actionable: false, detail: "small edit (+2/−1 words)", change: undefined };
    const text = renderReport(result([changed, minor]));
    expect(text).toContain("## Source watch · 2026-10-09");
    expect(text).toContain("1 source needs attention");
    expect(text).toContain("### Changed substantially");
    expect(text).toContain("`MS-ID-001`");
    expect(text).toContain("<summary>For information: 1 minor change</summary>");
    expect(text).toContain("````diff");
    expect(text).not.toContain("Claude's read");
  });

  it("says plainly when nothing needs attention", () => {
    expect(renderReport(result([]))).toContain("Nothing needs attention. Checked 3 sources.");
  });

  it("shortens to fit, dropping excerpts first", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...changed, sourceId: `ms-${i}`, change: { ...changed.change!, excerpt: "x\n".repeat(400) } }));
    const full = renderReport(result(many));
    const short = renderReport(result(many), { maxChars: 30_000, runUrl: "https://github.com/jusso-dev/crownguard/actions/runs/1" });
    expect(full.length).toBeGreaterThan(30_000);
    expect(short.length).toBeLessThanOrEqual(30_000);
    expect(short).not.toContain("```diff");
  });

  it("marks simulated runs", () => {
    const r = result([changed], { simulated: true });
    expect(renderReport(r)).toContain("Simulated run");
    expect(prTitle(r)).toBe("[simulated] Source watch: 1 source needs attention (2026-10-09)");
  });

  it("titles and summarises", () => {
    const candidate: Finding = { kind: "candidate", title: "New Drive DLP rules", url: "https://workspaceupdates.googleblog.com/x", actionable: true, detail: "", citedBy: [], candidate: { origin: "feed", feedName: "Google Workspace Updates", published: "2026-10-05" } };
    const r = result([changed, candidate]);
    expect(prTitle(r)).toBe("Source watch: 1 source needs attention, 1 new guidance item (2026-10-09)");
    expect(summaryLine(r)).toBe("3 sources checked; action needed (changed:major 1, candidate 1)");
    expect(renderReport(r)).toContain("Google Workspace Updates, 2026-10-05");
  });
});
