import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalogue, Question, Source } from "../../src/content/schema";
import { emptyState } from "./apply";
import { openCache } from "./cache";
import { checkFeeds, type FeedDef } from "./feeds";
import type { GitHub } from "./github";
import { runWatch, type WatchDeps } from "./run";
import type { FetchResult, Fetcher, WatchState } from "./types";
import { stableStringify } from "./util";

const LEARN = "https://learn.microsoft.com/en-us/entra/identity/conditional-access";

function learnPage(opts: { h1: string; body: string; docId?: string; commit?: string; archived?: boolean }): string {
  return `<!doctype html><html><head><title>${opts.h1} | Microsoft Learn</title>
<meta name="original_content_git_url" content="https://github.com/MicrosoftDocs/entra-docs-pr/blob/live/docs/identity/conditional-access/page.md">
<meta name="git_commit_id" content="${opts.commit ?? "a".repeat(40)}">
<meta name="github_feedback_content_git_url" content="https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/page.md">
<meta name="document_id" content="${opts.docId ?? "doc-1"}">
<meta name="toc_rel" content="toc.json">
${opts.archived ? '<meta name="is_archived" content="true">' : ""}
</head><body><main id="main"><div data-main-column><div>
<div class="content"><h1>${opts.h1}</h1></div>
<div id="article-metadata">Last updated today</div>
<div class="content">${opts.body}</div>
</div></div></main></body></html>`;
}

const body = (extra = "") =>
  `<h2>Prerequisites</h2><p>${"Licences and roles you need before you start. ".repeat(12)}</p>
<h2>Steps</h2><p>${"Create a policy that requires multifactor authentication for every user. ".repeat(20)}</p>${extra}`;

const googlePage = (text: string) =>
  `<html lang="en"><head><meta property="og:title" content="Security checklist | Security | Google Workspace Help"></head><body>
<article class="devsite-article"><h1 class="devsite-page-title">Security checklist<devsite-actions>Stay organized with collections</devsite-actions></h1>
<div class="devsite-article-body"><p>${text}</p><devsite-hats-survey hats-id="${Math.random()}"></devsite-hats-survey></div></article></body></html>`;

const cisPage = (versions: string) =>
  `<html><body><main><div class="template-main-content benchmark"><div class="column"><h5>Recent versions available for CIS Benchmark:</h5>${versions}</div></div></main></body></html>`;

/** Google pages are fetched with hl=en. */
const GWS = "https://knowledge.workspace.google.com/admin/security/checklist";
const GWS_FETCH = `${GWS}?hl=en`;

const toc = (pages: string[]) =>
  JSON.stringify({ items: [{ toc_title: "Conditional Access", children: pages.map((p) => ({ toc_title: `Title of ${p}`, href: p })) }] });

const SOURCES: Source[] = [
  { id: "ms-plan", title: "Plan a Conditional Access deployment", publisher: "Microsoft", url: `${LEARN}/plan`, retrieved: "2026-01-01" },
  { id: "ms-gone", title: "Old page", publisher: "Microsoft", url: `${LEARN}/gone`, retrieved: "2026-01-01" },
  { id: "ms-moved", title: "Session controls", publisher: "Microsoft", url: `${LEARN}/old-session`, retrieved: "2026-01-01" },
  { id: "ms-hub", title: "Grant controls", publisher: "Microsoft", url: `${LEARN}/grant`, retrieved: "2026-01-01" },
  { id: "gws-check", title: "Security checklist", publisher: "Google", url: "https://knowledge.workspace.google.com/admin/security/checklist", retrieved: "2026-01-01" },
  { id: "cis-x", title: "CIS Example Foundations Benchmark v1.0.0", publisher: "CIS", url: "https://www.cisecurity.org/benchmark/example", retrieved: "2026-01-01" },
  { id: "ms-flaky", title: "Flaky page", publisher: "Microsoft", url: `${LEARN}/flaky`, retrieved: "2026-01-01" },
];

function catalogue(): Catalogue {
  const questions = SOURCES.map((s, i) => ({ id: `MS-ID-00${i + 1}`, sources: [s.id], question: "Q?", yesLooksLike: "Y", remediation: "R", licence: [] }) as unknown as Question);
  return {
    sources: new Map(SOURCES.map((s) => [s.id, s])),
    frameworks: new Map(),
    imports: new Map(),
    platforms: new Map([["microsoft", { platform: { id: "microsoft", sources: [] } as never, assetTypes: [], questions }]]),
  };
}

type Route = { status?: number; body?: string; location?: string; network?: boolean };

/** An in-memory web: each URL maps to a response, redirects included. */
function fakeWeb(routes: Record<string, Route>): Fetcher {
  return {
    async fetchPage(url) {
      const redirects: FetchResult["redirects"] = [];
      let current = url;
      for (let i = 0; i < 5; i++) {
        const r = routes[current];
        const base = { requestedUrl: url, finalUrl: current, redirects, elapsedMs: 1 };
        if (!r) return { ...base, status: 404, outcome: "not-found", error: "HTTP 404" };
        if (r.network) return { ...base, status: 0, outcome: "network", error: "ECONNRESET" };
        if (r.location) {
          redirects.push({ url: current, status: 301 });
          current = r.location;
          continue;
        }
        const status = r.status ?? 200;
        return { ...base, status, outcome: status === 200 ? "ok" : status === 404 ? "not-found" : "server-error", body: r.body, contentType: "text/html" };
      }
      throw new Error("loop");
    },
  };
}

/** The Entra mirror exists (so its MIT-licensed text may be quoted) but serves no files. */
const noGitHub: GitHub = {
  repoExists: async (repo) => repo === "MicrosoftDocs/entra-docs",
  fileAt: async () => undefined,
  commitsBetween: async () => undefined,
  calls: () => 0,
  limited: () => undefined,
};

function routes(): Record<string, Route> {
  return {
    [`${LEARN}/plan`]: { body: learnPage({ h1: "Plan a Conditional Access deployment", body: body() }) },
    [`${LEARN}/gone`]: { body: learnPage({ h1: "Old page", body: body(), docId: "doc-gone" }) },
    [`${LEARN}/old-session`]: { body: learnPage({ h1: "Session controls", body: body(), docId: "doc-session" }) },
    [`${LEARN}/grant`]: { body: learnPage({ h1: "Grant controls", body: body(), docId: "doc-grant" }) },
    [`${LEARN}/flaky`]: { body: learnPage({ h1: "Flaky page", body: body(), docId: "doc-flaky" }) },
    [`${LEARN}/toc.json`]: { body: toc(["plan", "gone", "old-session", "grant", "flaky"]) },
    [GWS_FETCH]: { body: googlePage("Turn on 2-Step Verification for every admin. ".repeat(40)) },
    "https://www.cisecurity.org/benchmark/example": { body: cisPage('<div class="benchmark">Example Foundations  (1.0.0)</div>') },
    "https://feeds.test/atom": {
      body: `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id><title>Older post</title><link href="https://blog.test/1"/><published>2026-10-01T00:00:00Z</published></entry></feed>`,
    },
  };
}

const FEEDS: FeedDef[] = [{ id: "test", name: "Test feed", url: "https://feeds.test/atom", kind: "posts", include: [/security|2-step/i], linksToCited: true }];

/** One nightly run, saving the cache afterwards the way the CLI does. */
async function run(web: Record<string, Route>, baseline: WatchState, cacheDir: string, extra: Partial<WatchDeps> = {}) {
  const cache = openCache(cacheDir);
  const result = await runWatch({ catalogue: catalogue(), baseline, cache, fetcher: fakeWeb(web), github: noGitHub, date: "2026-10-09", feeds: FEEDS, ...extra });
  cache.save();
  return result;
}

/** A Workspace Help site with `n` cited pages, for the template-change guard. */
function googleSite(n = 10) {
  const many: Source[] = Array.from({ length: n }, (_, i) => ({ id: `g-${i}`, title: `Page ${i}`, publisher: "Google", url: `https://knowledge.workspace.google.com/p/${i}`, retrieved: "2026-01-01" }));
  const cat = catalogue();
  cat.sources = new Map(many.map((x) => [x.id, x]));
  cat.platforms = new Map([["google", { platform: { id: "google", sources: [] } as never, assetTypes: [], questions: many.map((x, i) => ({ id: `GO-ID-00${i}`, sources: [x.id] }) as unknown as Question) }]]);
  const furniture = "<h2>Was this helpful?</h2>" + "Tell us how we can improve this page and the help centre. ".repeat(8);
  const web = (template: boolean, edits: Record<number, string> = {}, routesOver: Record<number, Route> = {}) =>
    Object.fromEntries(
      many.map((x, i) => [`${x.url}?hl=en`, routesOver[i] ?? { body: googlePage(`Steady guidance for page ${i}. `.repeat(60) + (edits[i] ?? "") + (template ? furniture : "")) }]),
    );
  const go = async (w: Record<string, Route>, baseline: WatchState, date: string, cacheDir: string) => {
    const cache = openCache(cacheDir);
    const r = await runWatch({ catalogue: cat, baseline, cache, fetcher: fakeWeb(w), github: noGitHub, date });
    cache.save();
    return r;
  };
  return { web, go };
}

const BIG_EDIT = "<h2>New rules</h2>" + "Fresh guidance sentence here. ".repeat(80);

describe("runWatch", () => {
  it("fingerprints everything on the first run, then reports nothing when nothing changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const first = await run(routes(), emptyState(), dir);
    expect(first.findings.filter((f) => f.kind === "baseline" && f.sourceId)).toHaveLength(SOURCES.length);
    // First sight is a baseline, never a false "changed" item.
    expect(first.findings.filter((f) => f.kind === "changed")).toEqual([]);
    expect(first.findings.filter((f) => f.kind === "baseline" && !f.sourceId).map((f) => f.title)).toEqual(["Learn sections", "Test feed"]);
    expect(first.actionable).toBe(true);
    expect(first.state.sources["ms-plan"].learn?.documentId).toBe("doc-1");
    expect(first.state.sources["ms-plan"].title).toBe("Plan a Conditional Access deployment");
    expect(Object.keys(first.state.neighbours)).toEqual([`${LEARN}/toc.json#Conditional Access`]);
    expect(first.state.feeds.test.latest).toBe("2026-10-01T00:00:00.000Z");

    const second = await run(routes(), first.state, dir);
    expect(second.findings).toEqual([]);
    expect(stableStringify(second.state)).toBe(stableStringify(first.state));
  });

  it("reports any change on a high-attention source, even when the edit is below the substantial threshold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-hi-"));
    const sources: Source[] = [
      {
        id: "dta-ai-policy",
        title: "Policy for the responsible use of AI in government",
        publisher: "DTA",
        url: "https://www.digital.gov.au/policy/ai/policy",
        retrieved: "2026-01-01",
        highAttention: true,
      },
    ];
    const page = (extra: string) =>
      `<html lang="en"><body><main id="main-content"><div id="block-bdga-content"><article><div class="ct-basic-content"><h2>Policy</h2><p>${"Agencies must keep a register of AI use cases and share it with the DTA. ".repeat(40)}${extra}</p><h3>Officials</h3><p>${"Accountable officials notify the DTA of high-risk use cases by email. ".repeat(20)}</p></div></article></div></main></body></html>`;
    const cat: Catalogue = {
      sources: new Map(sources.map((s) => [s.id, s])),
      frameworks: new Map(),
      imports: new Map(),
      platforms: new Map([
        [
          "microsoft",
          {
            platform: { id: "microsoft", sources: [] } as never,
            assetTypes: [],
            questions: [{ id: "AIR-001", sources: ["dta-ai-policy"], question: "Q?", yesLooksLike: "Y", remediation: "R".repeat(20), why: "W".repeat(20), effort: "S", severity: "high", domain: "ai", licence: [] } as unknown as Question],
          },
        ],
      ]),
    };
    const url = sources[0].url;
    const cache = openCache(dir);
    const first = await runWatch({
      catalogue: cat,
      baseline: emptyState(),
      cache,
      fetcher: fakeWeb({ [url]: { body: page("") } }),
      github: noGitHub,
      date: "2026-10-09",
      feeds: [],
    });
    cache.save();
    expect(first.findings.filter((f) => f.kind === "changed")).toEqual([]);
    const minor = await runWatch({
      catalogue: cat,
      baseline: first.state,
      cache: openCache(dir),
      fetcher: fakeWeb({ [url]: { body: page("One small extra sentence.") } }),
      github: noGitHub,
      date: "2026-10-10",
      feeds: [],
    });
    const changed = minor.findings.filter((f) => f.kind === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].actionable).toBe(true);
    expect(changed[0].severity).toBe("minor");
    // Without highAttention the same edit would not be actionable.
    const ordinary: Catalogue = {
      ...cat,
      sources: new Map([["dta-ai-policy", { ...sources[0], highAttention: undefined }]]),
    };
    const ignored = await runWatch({
      catalogue: ordinary,
      baseline: first.state,
      cache: openCache(dir),
      fetcher: fakeWeb({ [url]: { body: page("One small extra sentence.") } }),
      github: noGitHub,
      date: "2026-10-10",
      feeds: [],
    });
    expect(ignored.findings.filter((f) => f.kind === "changed" && f.actionable)).toEqual([]);
  });

  it("reports breaks, moves, redirects, changes, versions, new pages and feed entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state: baseline } = await run(routes(), emptyState(), dir);

    const web = routes();
    delete web[`${LEARN}/gone`];
    web[`${LEARN}/old-session`] = { location: `${LEARN}/session-controls` };
    web[`${LEARN}/session-controls`] = { body: learnPage({ h1: "Configure session controls", body: body(), docId: "doc-session" }) };
    web[`${LEARN}/grant`] = { location: "https://learn.microsoft.com/en-us/entra/" };
    web["https://learn.microsoft.com/en-us/entra"] = { body: learnPage({ h1: "Microsoft Entra documentation", body: "<ul><li><a href='a'>A</a></li></ul>", docId: "doc-hub" }) };
    web["https://learn.microsoft.com/en-us/entra/"] = web["https://learn.microsoft.com/en-us/entra"];
    web[`${LEARN}/plan`] = {
      body: learnPage({ h1: "Plan a Conditional Access deployment", body: body(`<h2>Rollout</h2><p>${"Roll out in report-only mode first, then enforce. ".repeat(15)}</p>`), commit: "b".repeat(40) }),
    };
    web[GWS_FETCH] = { body: googlePage("Turn on 2-Step Verification for every admin. ".repeat(40) + "Also review it yearly.") };
    web["https://www.cisecurity.org/benchmark/example"] = { body: cisPage('<div class="benchmark">Example Foundation  (1.1.0)</div><div class="benchmark">Example Foundations  (1.0.0)</div>') };
    web[`${LEARN}/flaky`] = { network: true };
    web[`${LEARN}/toc.json`] = { body: toc(["plan", "gone", "old-session", "grant", "flaky", "new-page"]) };
    web["https://feeds.test/atom"] = {
      body: `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>2</id><title>New security controls for admins</title><link href="https://blog.test/2"/><published>2026-10-05T00:00:00Z</published></entry>
<entry><id>3</id><title>New emoji in Chat</title><link href="https://blog.test/3"/><published>2026-10-06T00:00:00Z</published></entry>
<entry><id>1</id><title>Older post</title><link href="https://blog.test/1"/><published>2026-10-01T00:00:00Z</published></entry></feed>`,
    };

    const r = await run(web, baseline, dir);
    const by = (kind: string) => r.findings.filter((f) => f.kind === kind);

    expect(by("broken").map((f) => f.sourceId)).toEqual(["ms-gone"]);
    expect(by("moved").map((f) => [f.sourceId, f.newUrl])).toEqual([["ms-moved", `${LEARN}/session-controls`]]);
    expect(r.urlUpdates).toEqual({ "ms-moved": `${LEARN}/session-controls` });
    expect(by("redirected").map((f) => f.sourceId)).toEqual(["ms-hub"]);

    const plan = by("changed").find((f) => f.sourceId === "ms-plan")!;
    expect(plan.severity).toBe("major");
    expect(plan.actionable).toBe(true);
    expect(plan.change?.sectionsAdded).toEqual(["Rollout"]);
    expect(plan.change?.excerpt).toContain("+ Roll out in report-only mode first");
    expect(plan.change?.excerptNote).toMatch(/MIT licence/);

    const gws = by("changed").find((f) => f.sourceId === "gws-check")!;
    expect(gws.severity).toBe("minor");
    expect(gws.actionable).toBe(false);
    // Minor edits leave the baseline alone so they add up over time.
    expect(r.state.sources["gws-check"]).toEqual(baseline.sources["gws-check"]);
    expect(gws.change?.excerptNote).toMatch(/CC BY 4.0, Google/);

    expect(by("version").map((f) => f.detail)).toEqual([expect.stringContaining("the page now lists 1.1.0")]);
    expect(by("unverifiable").map((f) => f.sourceId)).toEqual(["ms-flaky"]);
    expect(by("candidate").map((f) => f.url)).toEqual([`${LEARN}/new-page`, "https://blog.test/2"]);
    expect(r.actionable).toBe(true);
    // A transient failure keeps the old fingerprint; a broken page keeps it too, marked broken.
    expect(r.state.sources["ms-flaky"]).toEqual(baseline.sources["ms-flaky"]);
    expect(r.state.sources["ms-gone"].status).toBe("broken");

    // The flaky page fails again the next night: now it's broken. (A second run on the same day doesn't count.)
    const sameDay = await run(web, baseline, dir);
    expect(sameDay.findings.filter((f) => f.kind === "broken").map((f) => f.sourceId)).toEqual(["ms-gone"]);
    const again = await run(web, baseline, dir, { date: "2026-10-10" });
    expect(again.findings.filter((f) => f.kind === "broken").map((f) => f.sourceId).sort()).toEqual(["ms-flaky", "ms-gone"]);
  });

  it("flags retired pages every run until the citation changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state: baseline } = await run(routes(), emptyState(), dir);
    const web = routes();
    web[`${LEARN}/plan`] = { body: learnPage({ h1: "Plan a Conditional Access deployment (retired)", body: body() }) };
    const r = await run(web, baseline, dir);
    expect(r.findings.find((f) => f.kind === "retired")?.detail).toMatch(/title marks it as retired/);
    const again = await run(web, r.state, dir);
    expect(again.findings.find((f) => f.kind === "retired")).toMatchObject({ sourceId: "ms-plan", actionable: false, acknowledged: true });
    expect(again.actionable).toBe(false);
  });

  it("reports a lifecycle date on the page once it passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const web = routes();
    web[`${LEARN}/plan`] = { body: learnPage({ h1: "Plan a Conditional Access deployment", body: body("<p>The legacy policies will be retired on October 20, 2026.</p>") }) };
    const { state } = await run(web, emptyState(), dir);
    expect(state.sources["ms-plan"].passed).toEqual([]);
    const later = await runWatch({ catalogue: catalogue(), baseline: state, cache: openCache(dir), fetcher: fakeWeb(web), github: noGitHub, date: "2026-10-21" });
    const lapsed = later.findings.find((f) => f.kind === "deadline");
    expect(lapsed).toMatchObject({ sourceId: "ms-plan", actionable: true });
    expect(lapsed?.detail).toContain("2026-10-20");
    // The Entra mirror's MIT text may be quoted.
    expect(lapsed?.detail).toContain("will be retired on October 20, 2026");
    expect(later.state.sources["ms-plan"].passed).toEqual(["2026-10-20"]);
    const after = await runWatch({ catalogue: catalogue(), baseline: later.state, cache: openCache(dir), fetcher: fakeWeb(web), github: noGitHub, date: "2026-10-22" });
    expect(after.findings.find((f) => f.kind === "deadline")).toBeUndefined();
  });

  it("never moves a source onto another source's page, onto http, or again after a failed update", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    // ms-moved now redirects to ms-plan's page (same document id, so it would otherwise be a move).
    web[`${LEARN}/old-session`] = { location: `${LEARN}/plan` };
    web[`${LEARN}/plan`] = { body: learnPage({ h1: "Session controls", body: body(), docId: "doc-session" }) };
    const twin = await run(web, state, dir);
    expect(twin.urlUpdates["ms-moved"]).toBeUndefined();
    expect(twin.findings.find((f) => f.sourceId === "ms-moved" && f.kind === "redirected")?.detail).toMatch(/same page as ms-plan/);

    const web2 = routes();
    web2[`${LEARN}/old-session`] = { location: "http://learn.microsoft.com/en-us/entra/identity/conditional-access/session" };
    web2["http://learn.microsoft.com/en-us/entra/identity/conditional-access/session"] = { body: learnPage({ h1: "Session controls", body: body(), docId: "doc-session" }) };
    const insecure = await run(web2, state, dir);
    expect(insecure.urlUpdates["ms-moved"]).toBeUndefined();
    expect(insecure.findings.find((f) => f.sourceId === "ms-moved")?.detail).toMatch(/isn't https/);

    // A move the CLI couldn't apply is recorded as url = old, finalUrl = new; the next night acknowledges it.
    const web3 = routes();
    web3[`${LEARN}/old-session`] = { location: `${LEARN}/session-controls` };
    web3[`${LEARN}/session-controls`] = { body: learnPage({ h1: "Session controls", body: body(), docId: "doc-session" }) };
    const failed = { ...state, sources: { ...state.sources, "ms-moved": { ...state.sources["ms-moved"], finalUrl: `${LEARN}/session-controls` } } };
    const next = await run(web3, failed, dir);
    expect(next.urlUpdates["ms-moved"]).toBeUndefined();
    expect(next.findings.find((f) => f.sourceId === "ms-moved")).toMatchObject({ kind: "redirected", acknowledged: true, actionable: false });
  });

  it("keeps an accepted redirect as a redirect instead of turning it into a move", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    web[`${LEARN}/grant`] = { location: `${LEARN}/unrelated` };
    web[`${LEARN}/unrelated`] = { body: learnPage({ h1: "Something else entirely", body: body(), docId: "doc-other" }) };
    const night1 = await run(web, state, dir);
    expect(night1.findings.find((f) => f.sourceId === "ms-hub")).toMatchObject({ kind: "redirected", actionable: true });
    // Merged: the baseline now holds the target's title and document id. It must not look like a move tomorrow.
    const night2 = await run(web, night1.state, dir, { date: "2026-10-10" });
    expect(night2.urlUpdates["ms-hub"]).toBeUndefined();
    expect(night2.findings.find((f) => f.sourceId === "ms-hub")).toMatchObject({ kind: "redirected", acknowledged: true, actionable: false });
  });

  it("counts a host's drift since the previous run, so accumulated minor edits don't silence it", async () => {
    const many: Source[] = Array.from({ length: 10 }, (_, i) => ({ id: `g-${i}`, title: `Page ${i}`, publisher: "Google", url: `https://knowledge.workspace.google.com/p/${i}`, retrieved: "2026-01-01" }));
    const cat = catalogue();
    cat.sources = new Map(many.map((x) => [x.id, x]));
    cat.platforms = new Map([["google", { platform: { id: "google", sources: [] } as never, assetTypes: [], questions: many.map((x, i) => ({ id: `GO-ID-00${i}`, sources: [x.id] }) as unknown as Question) }]]);
    const pageText = (i: number, extra = "") => ({ body: googlePage(`Steady guidance for page ${i}. `.repeat(60) + extra) });
    const web = (edits: Record<number, string>) => Object.fromEntries(many.map((x, i) => [`${x.url}?hl=en`, pageText(i, edits[i] ?? "")]));
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const go = async (w: Record<string, Route>, baseline: WatchState, date: string) => {
      const cache = openCache(dir);
      const r = await runWatch({ catalogue: cat, baseline, cache, fetcher: fakeWeb(w), github: noGitHub, date });
      cache.save();
      return r;
    };
    const { state } = await go(web({}), emptyState(), "2026-10-09");
    // Three nights of small edits on four pages: each is minor, so the baseline keeps the original text.
    await go(web({ 0: "a", 1: "b" }), state, "2026-10-10");
    await go(web({ 0: "a", 1: "b", 2: "c" }), state, "2026-10-11");
    await go(web({ 0: "a", 1: "b", 2: "c", 3: "d" }), state, "2026-10-12");
    // Tonight one page gains a large new section: it must be reported, not treated as a site redesign.
    const big = await go(web({ 0: "a", 1: "b", 2: "c", 3: "d", 4: "<h2>New rules</h2>" + "Fresh guidance sentence here. ".repeat(80) }), state, "2026-10-13");
    expect(big.findings.find((f) => f.sourceId === "g-4" && f.kind === "changed")).toMatchObject({ severity: "major", actionable: true });
  });

  it("holds a site template change across nights in one finding, and still reports a later real edit", async () => {
    const many: Source[] = Array.from({ length: 10 }, (_, i) => ({ id: `g-${i}`, title: `Page ${i}`, publisher: "Google", url: `https://knowledge.workspace.google.com/p/${i}`, retrieved: "2026-01-01" }));
    const cat = catalogue();
    cat.sources = new Map(many.map((x) => [x.id, x]));
    cat.platforms = new Map([["google", { platform: { id: "google", sources: [] } as never, assetTypes: [], questions: many.map((x, i) => ({ id: `GO-ID-00${i}`, sources: [x.id] }) as unknown as Question) }]]);
    const furniture = "<h2>Was this helpful?</h2>" + "Tell us how we can improve this page and the help centre. ".repeat(8);
    const web = (template: boolean, edits: Record<number, string> = {}) =>
      Object.fromEntries(many.map((x, i) => [`${x.url}?hl=en`, { body: googlePage(`Steady guidance for page ${i}. `.repeat(60) + (edits[i] ?? "") + (template ? furniture : "")) }]));
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const go = async (w: Record<string, Route>, baseline: WatchState, date: string, cacheDir = dir) => {
      const cache = openCache(cacheDir);
      const r = await runWatch({ catalogue: cat, baseline, cache, fetcher: fakeWeb(w), github: noGitHub, date });
      cache.save();
      return r;
    };
    const { state } = await go(web(false), emptyState(), "2026-10-09");

    const night1 = await go(web(true), state, "2026-10-10");
    expect(night1.findings.filter((f) => f.kind === "changed")).toEqual([]);
    expect(night1.findings.filter((f) => f.kind === "template")).toMatchObject([{ title: "knowledge.workspace.google.com", actionable: true }]);
    expect(night1.findings.find((f) => f.kind === "template")?.detail).toMatch(/^10 of 10 pages changed together/);
    expect(night1.state.sources["g-3"].contentHash).not.toBe(state.sources["g-3"].contentHash);

    // Not merged yet: the same pages stay held, and the pull request doesn't change.
    const night2 = await go(web(true), state, "2026-10-11");
    expect(night2.findings.filter((f) => f.kind === "changed")).toEqual([]);
    expect(stableStringify(night2.state)).toBe(stableStringify(night1.state));

    // A real edit on one held page is compared normally.
    const night3 = await go(web(true, { 0: "<h2>New rules</h2>" + "Fresh guidance sentence here. ".repeat(80) }), state, "2026-10-12");
    expect(night3.findings.find((f) => f.sourceId === "g-0")).toMatchObject({ kind: "changed", severity: "major", actionable: true });
    expect(night3.findings.find((f) => f.kind === "template")?.detail).toMatch(/^9 of 10 pages/);

    // Merged: the furniture is part of the baseline and nothing more is said.
    const merged = await go(web(true), night1.state, "2026-10-13");
    expect(merged.findings.filter((f) => f.actionable)).toEqual([]);
    expect(merged.actionable).toBe(false);

    // A cold cache can't tell what changed since last night, so accumulated differences never trip the guard.
    const cold = mkdtempSync(join(tmpdir(), "watch-run-"));
    const fresh = await go(web(false, { 0: "a", 1: "b", 2: "c", 3: "d", 4: "<h2>New rules</h2>" + "Fresh guidance sentence here. ".repeat(80) }), state, "2026-10-14", cold);
    expect(fresh.findings.filter((f) => f.kind === "template")).toEqual([]);
    expect(fresh.findings.find((f) => f.sourceId === "g-4")).toMatchObject({ kind: "changed", severity: "major" });
  });

  it("keeps reporting a substantial change already in the open pull request when a template change arrives", async () => {
    const site = googleSite();
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await site.go(site.web(false), emptyState(), "2026-10-09", dir);
    const night1 = await site.go(site.web(false, { 0: BIG_EDIT }), state, "2026-10-10", dir);
    expect(night1.findings.find((f) => f.sourceId === "g-0")).toMatchObject({ kind: "changed", severity: "major" });
    // Unmerged; the next night every page gets new furniture.
    for (const date of ["2026-10-11", "2026-10-12"]) {
      const r = await site.go(site.web(true, { 0: BIG_EDIT }), state, date, dir);
      expect(r.findings.find((f) => f.sourceId === "g-0"), date).toMatchObject({ kind: "changed", severity: "major", actionable: true });
      expect(r.findings.find((f) => f.kind === "template")?.held, date).toEqual(["g-1", "g-2", "g-3", "g-4", "g-5", "g-6", "g-7", "g-8", "g-9"]);
    }
  });

  it("doesn't mistake pages coming back from a failed night for a template change, but still holds one that landed meanwhile", async () => {
    const site = googleSite();
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await site.go(site.web(false), emptyState(), "2026-10-09", dir);
    // Small edits pile up on four pages over four nights (each minor, so the baseline keeps the original text).
    const drift = { 0: "a", 1: "b", 2: "c", 3: "d" };
    for (const [i, date] of ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].entries())
      await site.go(site.web(false, Object.fromEntries(Object.entries(drift).slice(0, i + 1))), state, date, dir);
    // One night the whole site refuses the runner, then it's back with the same text.
    const blocked = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, { status: 403 }]));
    await site.go(site.web(false, drift, blocked), state, "2026-10-14", dir);
    const back = await site.go(site.web(false, drift), state, "2026-10-15", dir);
    expect(back.findings.filter((f) => f.kind === "template")).toEqual([]);
    expect(back.actionable).toBe(false);
    // A template change that goes live during an outage is still held as one finding when the site comes back.
    await site.go(site.web(false, drift, blocked), state, "2026-10-16", dir);
    const template = await site.go(site.web(true, drift), state, "2026-10-17", dir);
    expect(template.findings.filter((f) => f.kind === "template")).toHaveLength(1);
    expect(template.findings.filter((f) => f.kind === "changed" && f.severity === "major")).toEqual([]);
  });

  it("doesn't report a change to the tracked vocabulary as a change to the page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const web = routes();
    web[`${LEARN}/plan`] = { body: learnPage({ h1: "Plan a Conditional Access deployment", body: body("<p>Devices marked for retirement are wiped.</p>") }) };
    const { state } = await run(web, emptyState(), dir);
    // A baseline written when "retirement" was still a tracked term.
    const old = { ...state, sources: { ...state.sources, "ms-plan": { ...state.sources["ms-plan"], terms: ["retirement"] } } };
    const quiet = await run(web, old, dir, { date: "2026-10-10" });
    expect(quiet.findings.filter((f) => f.sourceId === "ms-plan")).toEqual([]);
    expect(quiet.state.sources["ms-plan"].terms).toEqual([]);
    // The next small edit, against the old baseline, is still small.
    const edited = routes();
    edited[`${LEARN}/plan`] = { body: learnPage({ h1: "Plan a Conditional Access deployment", body: body("<p>Devices marked for retirement are wiped remotely.</p>") }) };
    const edit = await run(edited, old, dir, { date: "2026-10-11" });
    expect(edit.findings.find((f) => f.sourceId === "ms-plan")).toMatchObject({ kind: "changed", severity: "minor", actionable: false });
  });

  it("never moves a source automatically once its redirect was accepted, even when the target moves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    web[`${LEARN}/grant`] = { location: `${LEARN}/unrelated` };
    web[`${LEARN}/unrelated`] = { body: learnPage({ h1: "Grant controls overview", body: body(), docId: "doc-other" }) };
    const night1 = await run(web, state, dir);
    expect(night1.findings.find((f) => f.sourceId === "ms-hub")).toMatchObject({ kind: "redirected", actionable: true });
    // Merged. Later the target itself moves (same document), which on its own would look like a move.
    web[`${LEARN}/grant`] = { location: `${LEARN}/unrelated-2` };
    web[`${LEARN}/unrelated-2`] = { body: learnPage({ h1: "Grant controls overview", body: body(), docId: "doc-other" }) };
    const night2 = await run(web, night1.state, dir, { date: "2026-10-10" });
    expect(night2.urlUpdates["ms-hub"]).toBeUndefined();
    expect(night2.findings.find((f) => f.sourceId === "ms-hub")).toMatchObject({ kind: "redirected", actionable: true, newUrl: `${LEARN}/unrelated-2` });
  });

  it("resets failure counts once when a maintainer re-points a source, then counts the new URL's failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const failing = routes();
    failing[`${LEARN}/flaky`] = { status: 500 };
    await run(failing, state, dir, { date: "2026-10-10" });
    expect((await run(failing, state, dir, { date: "2026-10-11" })).findings.find((f) => f.sourceId === "ms-flaky")?.kind).toBe("broken");

    // Not merged; the maintainer points the source somewhere else, which also fails.
    const repointed = catalogue();
    repointed.sources.set("ms-flaky", { ...repointed.sources.get("ms-flaky")!, url: `${LEARN}/flaky-new` });
    const web = { ...failing, [`${LEARN}/flaky-new`]: { status: 502 } };
    const go = async (date: string) => {
      const cache = openCache(dir);
      const r = await runWatch({ catalogue: repointed, baseline: state, cache, fetcher: fakeWeb(web), github: noGitHub, date });
      cache.save();
      return r.findings.find((f) => f.sourceId === "ms-flaky");
    };
    expect(await go("2026-10-12")).toMatchObject({ kind: "unverifiable", actionable: false });
    expect(await go("2026-10-13")).toMatchObject({ kind: "broken", actionable: true });
  });

  it("reports a release note added later to a day it already read", async () => {
    const entry = (notes: string) =>
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>October 09, 2026</title><id>d9</id><updated>2026-10-09T00:00:00-07:00</updated><link rel="alternate" href="https://docs.cloud.google.com/x/release-notes#October_09_2026"/><content type="html"><![CDATA[${notes}]]></content></entry></feed>`;
    const def: FeedDef = { id: "gcp-x", name: "X", url: "https://feeds.test/rn", kind: "release-notes", noteTypes: ["Deprecated"], excerpts: true, licence: { label: "CC BY 4.0, Google", url: "https://creativecommons.org/licenses/by/4.0/" } };
    const fetcherFor = (xml: string) => fakeWeb({ "https://feeds.test/rn": { body: xml } });
    const base = { "gcp-x": { latest: "2026-10-01T00:00:00.000Z", seen: [] } };
    const first = await checkFeeds([def], base, fetcherFor(entry("<h3>Deprecated</h3><p>Old API is deprecated.</p>")), new Map());
    expect(first.findings).toHaveLength(1);
    const later = await checkFeeds([def], first.feeds, fetcherFor(entry("<h3>Deprecated</h3><p>Old API is deprecated.</p><h3>Deprecated</h3><p>Another feature is deprecated.</p>")), new Map());
    expect(later.findings.map((f) => f.title)).toEqual(["X: Another feature is deprecated."]);
    const again = await checkFeeds([def], later.feeds, fetcherFor(entry("<h3>Deprecated</h3><p>Old API is deprecated.</p><h3>Deprecated</h3><p>Another feature is deprecated.</p>")), new Map());
    expect(again.findings).toEqual([]);
    expect(again.feeds).toEqual(later.feeds);
  });

  it("follows a renamed Learn section and still reports pages added with the rename", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    web[`${LEARN}/toc.json`] = {
      body: JSON.stringify({ items: [{ toc_title: "Conditional Access policies", children: ["plan", "gone", "old-session", "grant", "flaky", "brand-new"].map((p) => ({ toc_title: `Title of ${p}`, href: p })) }] }),
    };
    const r = await run(web, state, dir);
    expect(r.findings.filter((f) => f.kind === "candidate").map((f) => f.url)).toEqual([`${LEARN}/brand-new`]);
    expect(Object.keys(r.state.neighbours)).toEqual([`${LEARN}/toc.json#Conditional Access policies`]);
  });

  it("doesn't call a cited page moving into another existing section a rename", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const twoGroups = (ca: string[], ip: string[]) =>
      JSON.stringify({
        items: [
          { toc_title: "Conditional Access", children: ca.map((p) => ({ toc_title: `Title of ${p}`, href: p })) },
          { toc_title: "Identity Protection", children: ip.map((p) => ({ toc_title: `Title of ${p}`, href: p })) },
        ],
      });
    const web = routes();
    web[`${LEARN}/toc.json`] = { body: twoGroups(["plan", "gone", "old-session", "grant", "flaky"], ["ip-1", "ip-2", "ip-3"]) };
    const { state } = await run(web, emptyState(), dir);
    web[`${LEARN}/toc.json`] = { body: twoGroups(["gone", "old-session", "grant", "flaky"], ["ip-1", "ip-2", "ip-3", "plan"]) };
    const r = await run(web, state, dir);
    expect(r.findings.filter((f) => f.kind === "candidate")).toEqual([]);
    expect(r.findings.find((f) => f.title === "Learn sections")?.detail).toMatch(/^Started tracking 1 Learn section \(Identity Protection\)/);
  });

  it("doesn't call a small cited section folded into a bigger existing one a rename", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const groups = (sections: Record<string, string[]>) =>
      JSON.stringify({ items: Object.entries(sections).map(([title, pages]) => ({ toc_title: title, children: pages.map((p) => ({ toc_title: `Title of ${p}`, href: p })) })) });
    const deploy = ["d-1", "d-2", "d-3", "d-4", "d-5", "d-6", "d-7", "d-8", "d-9"];
    const web = routes();
    web[`${LEARN}/toc.json`] = { body: groups({ Plan: ["plan", "gone", "old-session", "grant", "flaky"], Deploy: deploy }) };
    const { state } = await run(web, emptyState(), dir);
    web[`${LEARN}/toc.json`] = { body: groups({ Deploy: [...deploy, "plan", "gone", "old-session", "grant", "flaky"] }) };
    const r = await run(web, state, dir);
    expect(r.findings.filter((f) => f.kind === "candidate")).toEqual([]);
    expect(r.findings.find((f) => f.title === "Learn sections")?.detail).toMatch(/^Started tracking 1 Learn section \(Deploy\)/);
  });

  it("adopts past dates into a baseline written before dates were recorded, then reports the next one to pass", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const web = routes();
    web[`${LEARN}/plan`] = { body: learnPage({ h1: "Plan a Conditional Access deployment", body: body("<p>Classic policies were retired on September 30, 2025, and the rest will be retired on October 20, 2026.</p>") }) };
    const { state } = await run(web, emptyState(), dir);
    const { passed: _drop, ...legacy } = state.sources["ms-plan"];
    void _drop;
    const old = { ...state, sources: { ...state.sources, "ms-plan": legacy } };
    const first = await run(web, old, dir, { date: "2026-10-10" });
    expect(first.findings.filter((f) => f.kind === "deadline")).toEqual([]);
    expect(first.state.sources["ms-plan"].passed).toEqual(["2025-09-30"]);
    const later = await run(web, first.state, dir, { date: "2026-10-21" });
    expect(later.findings.find((f) => f.kind === "deadline")?.detail).toContain("(2026-10-20)");
  });

  it("acknowledges known breakage, reports recovery, and stays quiet otherwise", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    delete web[`${LEARN}/gone`];
    const broke = await run(web, state, dir);
    expect(broke.findings.find((f) => f.kind === "broken")).toMatchObject({ sourceId: "ms-gone", actionable: true });

    const still = await run(web, broke.state, dir);
    expect(still.findings.find((f) => f.kind === "broken")).toMatchObject({ sourceId: "ms-gone", actionable: false, acknowledged: true });
    expect(still.actionable).toBe(false);
    expect(stableStringify(still.state)).toBe(stableStringify(broke.state));

    const back = await run(routes(), broke.state, dir);
    expect(back.findings.find((f) => f.kind === "recovered")).toMatchObject({ sourceId: "ms-gone", actionable: true, detail: "Loads again." });
    expect(back.state.sources["ms-gone"].status).toBe("ok");
  });

  it("escalates a source that can't be checked night after night", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    web["https://www.cisecurity.org/benchmark/example"] = { status: 403 };
    const night1 = await run(web, state, dir, { unmonitoredAfter: 2, date: "2026-10-10" });
    expect(night1.findings.find((f) => f.sourceId === "cis-x")).toMatchObject({ kind: "unverifiable", actionable: false });
    expect(night1.actionable).toBe(false);
    const night2 = await run(web, state, dir, { unmonitoredAfter: 2, date: "2026-10-11" });
    expect(night2.findings.find((f) => f.sourceId === "cis-x")).toMatchObject({ kind: "unmonitored", actionable: true });
    expect(night2.state.sources["cis-x"].status).toBe("unmonitored");
    const night3 = await run(web, night2.state, dir, { unmonitoredAfter: 2, date: "2026-10-12" });
    expect(night3.findings.find((f) => f.sourceId === "cis-x")).toMatchObject({ kind: "unmonitored", acknowledged: true, actionable: false });
  });

  it("treats most of one host failing as the host's problem, not broken pages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state } = await run(routes(), emptyState(), dir);
    const web = routes();
    for (const p of ["plan", "gone", "old-session", "grant"]) web[`${LEARN}/${p}`] = { status: 500 };
    for (let night = 0; night < 3; night++) {
      const r = await run(web, state, dir, { date: `2026-10-1${night}` });
      expect(r.findings.filter((f) => f.kind === "broken")).toEqual([]);
      expect(r.findings.filter((f) => f.kind === "unverifiable").map((f) => f.sourceId).sort()).toEqual(["ms-gone", "ms-hub", "ms-moved", "ms-plan"]);
    }
  });

  it("refuses to report when most sources fail at once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const many: Source[] = Array.from({ length: 24 }, (_, i) => ({ id: `s-${i}`, title: `Page ${i}`, publisher: "X", url: `https://x.test/${i}`, retrieved: "2026-01-01" }));
    const cat = catalogue();
    cat.sources = new Map(many.map((s) => [s.id, s]));
    const web = Object.fromEntries(many.map((s, i) => [s.url, i < 10 ? { network: true } : { body: googlePage("fine") }]));
    await expect(runWatch({ catalogue: cat, baseline: emptyState(), cache: openCache(dir), fetcher: fakeWeb(web), github: noGitHub, date: "2026-10-09" })).rejects.toThrow(/network problem/);
  });

  it("simulates a change for testing the pull request path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const { state: baseline } = await run(routes(), emptyState(), dir);
    const r = await run(routes(), baseline, dir, { simulate: true });
    expect(r.simulated).toBe(true);
    expect(r.actionable).toBe(true);
    expect(stableStringify(r.state)).not.toBe(stableStringify(baseline));
  });
});
