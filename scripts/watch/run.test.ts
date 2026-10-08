import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalogue, Question, Source } from "../../src/content/schema";
import { emptyState } from "./apply";
import { openCache } from "./cache";
import type { FeedDef } from "./feeds";
import type { GitHub } from "./github";
import { runWatch, type WatchDeps } from "./run";
import type { FetchResult, Fetcher, WatchState } from "./types";
import { stableStringify } from "./util";

const LEARN = "https://learn.microsoft.com/en-us/entra/identity/conditional-access";

function learnPage(opts: { h1: string; body: string; docId?: string; commit?: string; archived?: boolean }): string {
  return `<!doctype html><html><head><title>${opts.h1} | Microsoft Learn</title>
<meta name="original_content_git_url" content="https://github.com/MicrosoftDocs/entra-docs-pr/blob/live/docs/identity/conditional-access/page.md">
<meta name="git_commit_id" content="${opts.commit ?? "a".repeat(40)}">
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

const noGitHub: GitHub = {
  repoExists: async () => false,
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

describe("runWatch", () => {
  it("fingerprints everything on the first run, then reports nothing when nothing changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-run-"));
    const first = await run(routes(), emptyState(), dir);
    expect(first.findings.filter((f) => f.kind === "baseline")).toHaveLength(SOURCES.length);
    expect(first.actionable).toBe(false);
    expect(first.state.sources["ms-plan"].learn?.documentId).toBe("doc-1");
    expect(first.state.sources["ms-plan"].title).toBe("Plan a Conditional Access deployment");
    expect(Object.keys(first.state.neighbours)).toEqual([`${LEARN}/toc.json#Conditional Access`]);
    expect(first.state.feeds.test.latest).toBe("2026-10-01T00:00:00.000Z");

    const second = await run(routes(), first.state, dir);
    expect(second.findings).toEqual([]);
    expect(stableStringify(second.state)).toBe(stableStringify(first.state));
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
    expect(plan.change?.excerptNote).toMatch(/CC BY 4.0/);

    const gws = by("changed").find((f) => f.sourceId === "gws-check")!;
    expect(gws.severity).toBe("minor");
    expect(gws.actionable).toBe(false);
    expect(gws.change?.excerptNote).toMatch(/CC BY 4.0, Google/);

    expect(by("version").map((f) => f.detail)).toEqual([expect.stringContaining("the page now lists 1.1.0")]);
    expect(by("unverifiable").map((f) => f.sourceId)).toEqual(["ms-flaky"]);
    expect(by("candidate").map((f) => f.url)).toEqual([`${LEARN}/new-page`, "https://blog.test/2"]);
    expect(r.actionable).toBe(true);
    // A transient failure keeps the old fingerprint; a broken page keeps it too, marked broken.
    expect(r.state.sources["ms-flaky"]).toEqual(baseline.sources["ms-flaky"]);
    expect(r.state.sources["ms-gone"].status).toBe("broken");

    // The flaky page fails again the next night: now it's broken.
    const again = await run(web, baseline, dir);
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
    expect(again.findings.find((f) => f.kind === "retired")?.sourceId).toBe("ms-plan");
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
