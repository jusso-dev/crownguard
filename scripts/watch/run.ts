import type { Catalogue, Question, Source } from "../../src/content/schema";
import { citedByIndex, citedVersion, classifyChange, compareVersions, diffTexts, equivalentUrls, excerpt, redirectKind, versionsOnPage, type TextDiff } from "./compare";
import { extractHtml, extractPdf, lifecycleLine } from "./extract";
import { checkFeeds, type FeedDef } from "./feeds";
import { compareUrl, markdownBody, type GitHub } from "./github";
import { hasProfile, licenceFor, profileFor } from "./hosts";
import { parseToc, sectionOf, tocPaths, tocUrlFor, withoutQuery } from "./learn";
import type { TriageInput, TriageRun } from "./triage";
import type { Commit, Extracted, FetchResult, Fetcher, Finding, RunResult, RunStats, SourceState, WatchCache, WatchState } from "./types";
import { cleanTitle, findTerms, hostOf, limiter, normalizeUrl, sameUrl, stableStringify, TRACKED_TERMS, truncate } from "./util";

export interface WatchDeps {
  catalogue: Catalogue;
  /** Committed baseline (`watch/state.json` on main). */
  baseline: WatchState;
  cache: WatchCache;
  fetcher: Fetcher;
  github: GitHub;
  /** YYYY-MM-DD the run is stamped with. */
  date: string;
  feeds?: FeedDef[];
  triage?: (inputs: TriageInput[]) => Promise<TriageRun>;
  /** Inject a fake substantial change so the pull request path can be tested end to end. */
  simulate?: boolean;
  /** Check only these source ids; everything else keeps its baseline. */
  only?: Set<string>;
  /** Consecutive failed runs before a source counts as broken. */
  failureThreshold?: number;
  /** Consecutive runs a source can't be checked before it is reported as unmonitored. */
  unmonitoredAfter?: number;
  /** New Learn pages listed per table-of-contents section per run. */
  maxPerSection?: number;
  log?: (line: string) => void;
}

/** Share of all sources that may fail before the run aborts: that looks like the runner's network, not the sources. */
const SYSTEMIC_FAILURE_RATE = 0.25;
/** Share of one host's sources that may fail before the failures count as a host problem rather than broken pages. */
const HOST_FAILURE_RATE = 0.8;
/** Share of a host's pages that may change at once without a commit behind them before it looks like a site redesign. */
const MASS_CHANGE_RATE = 0.3;

/** Tracking and language parameters dropped from a moved page's new URL. */
const TRACKING = /^(?:utm_[a-z]+|sjid|visit_id|rd|ref_topic|authuser|co|hl)$/;

function cleanMovedUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u.toString();
}

/** The cited URL plus the host's fetch-only parameters (for example hl=en). */
function fetchUrl(url: string, params: Record<string, string> | undefined): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.toString();
}

const TRACKED = new Set([...TRACKED_TERMS.lifecycle, ...TRACKED_TERMS.licence]);

const highest = (versions: string[] | undefined) => (versions?.length ? [...versions].sort(compareVersions).at(-1) : undefined);

type Loaded = {
  kind: "ok";
  source: Source;
  res: FetchResult;
  ex: Extracted;
  current: SourceState;
  redirect: "none" | "moved" | "redirected";
  /** Same text and title as the baseline: nothing a reader would notice changed. */
  sameText: boolean;
  /** The Learn commit differs from the baseline's: the Markdown can be diffed between the two. */
  commitBacked: boolean;
  /** The Learn commit is new since the previous run: an edit with a commit behind it, not a template change. */
  freshCommit: boolean;
  tocUrl?: string;
};

type Raw =
  | { kind: "skip"; source: Source }
  | { kind: "failed"; source: Source; res: FetchResult }
  /** `fetchLevel`: the request itself was refused (challenge, 401/403/429, dropped); otherwise the page loaded but couldn't be read. */
  | { kind: "blocked"; source: Source; reason: string; fetchLevel: boolean }
  | Loaded;

/**
 * One nightly check. The proposed state starts as the baseline and takes only changes this run reports, so the pull
 * request's diff is exactly what merging acknowledges: issues already recorded in the baseline are listed as
 * acknowledged, small edits accumulate until they add up to a substantial change, and a night with nothing new leaves
 * the state byte-for-byte unchanged.
 */
export async function runWatch(deps: WatchDeps): Promise<RunResult> {
  const started = Date.now();
  const { catalogue, baseline, cache, fetcher, github, date } = deps;
  const log = deps.log ?? (() => {});
  const threshold = deps.failureThreshold ?? 2;
  const unmonitoredAfter = deps.unmonitoredAfter ?? 7;
  const citedBy = citedByIndex(catalogue);
  const sources = [...catalogue.sources.values()].sort((a, b) => a.id.localeCompare(b.id));
  const questions = new Map<string, Question>();
  for (const bundle of catalogue.platforms.values()) for (const q of bundle.questions) questions.set(q.id, q);

  const stats: RunStats = { checked: 0, byHost: {}, outcomes: {}, githubCalls: 0, triageCalls: 0, durationMs: 0, skipped: [] };
  const proposed: WatchState = { version: 1, sources: {}, neighbours: {}, feeds: {} };
  const findings: Finding[] = [];
  const urlUpdates: Record<string, string> = {};
  const keep: Record<string, string[]> = {};
  const diffTextFor = new Map<string, string>();

  /** The baseline entry, unless a maintainer has since pointed the source at a different URL. */
  const baseFor = (s: Source): SourceState | undefined => {
    const b = baseline.sources[s.id];
    return b && (sameUrl(b.url, s.url) || (b.finalUrl !== undefined && equivalentUrls(b.finalUrl, s.url))) ? b : undefined;
  };
  /** Which source cites a page, so a redirect onto another source's page is never applied as a move. */
  const owner = new Map<string, string>();
  for (const s of sources) for (const k of [normalizeUrl(s.url), withoutQuery(s.url)]) owner.set(k, s.id);
  const finding = (s: Source, f: Omit<Finding, "sourceId" | "title" | "url" | "citedBy"> & Partial<Finding>): Finding => ({
    sourceId: s.id,
    title: s.title,
    url: s.url,
    citedBy: citedBy.get(s.id) ?? [],
    ...f,
  });

  // 1. Fetch and fingerprint every source. The fetcher limits concurrency per host. Counters aren't touched yet.
  const raws: Raw[] = await Promise.all(
    sources.map(async (s): Promise<Raw> => {
      if (deps.only && !deps.only.has(s.id)) return { kind: "skip", source: s };
      const base = baseFor(s);
      const host = hostOf(s.url);
      const res = await fetcher.fetchPage(fetchUrl(s.url, profileFor(host).fetchParams));
      const profile = profileFor(hostOf(res.finalUrl) || host);
      stats.checked++;
      stats.byHost[host] = (stats.byHost[host] ?? 0) + 1;
      stats.outcomes[res.outcome] = (stats.outcomes[res.outcome] ?? 0) + 1;
      log(`${res.outcome.padEnd(12)} ${res.status} ${s.id}${res.redirects.length ? ` -> ${res.finalUrl}` : ""}`);

      // Refusals are blocks, not breakage: challenges, sign-in walls, 401/403/407/451 and rate limits on any host,
      // and dropped connections on hosts whose firewall works that way.
      const refused = res.outcome === "challenge" || [401, 403, 407, 429, 451].includes(res.status) || (profile.blockedOnNetworkError && res.outcome === "network");
      if (refused) return { kind: "blocked", source: s, fetchLevel: true, reason: `blocked by bot protection, a sign-in wall or a rate limit (${res.error ?? `HTTP ${res.status}`})` };
      if (res.outcome !== "ok") return { kind: "failed", source: s, res };

      let ex: Extracted;
      try {
        const pdf = res.bytes && (/pdf/i.test(res.contentType ?? "") || /\.pdf$/i.test(new URL(res.finalUrl).pathname));
        if (res.body !== undefined) ex = extractHtml(res.body, profile);
        else if (pdf) ex = await extractPdf(res.bytes!);
        else return { kind: "blocked", source: s, fetchLevel: false, reason: `unsupported content type ${res.contentType ?? "unknown"}` };
      } catch (e) {
        return { kind: "blocked", source: s, fetchLevel: false, reason: `couldn't read the page: ${truncate((e as Error).message, 120)}` };
      }
      if (profile.lang && !profile.lang.test(ex.lang ?? "")) return { kind: "blocked", source: s, fetchLevel: false, reason: `served in another language (${ex.lang ?? "unknown"})` };
      if (!ex.matchedSelector && hasProfile(profile.host)) {
        stats.skipped.push(`${profile.label}: the content selector didn't match ${s.id} as expected; the site layout may have changed (scripts/watch/hosts.ts)`);
        if (base) return { kind: "blocked", source: s, fetchLevel: false, reason: "the page layout changed, so the content couldn't be compared" };
      }

      // Once a redirect is recorded, the baseline's title and document id describe the target, not the cited page.
      const recorded = !!base?.finalUrl;
      let redirect = redirectKind(
        s.url,
        res.finalUrl,
        { title: ex.title, isLanding: ex.isLanding, retired: ex.retired, documentId: ex.learn?.documentId },
        { titles: [recorded ? undefined : base?.title, s.title], documentId: recorded ? undefined : base?.learn?.documentId },
      );
      // A source already recorded as redirecting is never moved automatically, even when its target later moves:
      // a person picked or accepted that redirect, so a person picks what replaces it.
      if (redirect === "moved" && recorded) redirect = "redirected";
      const versions = versionsOnPage(s.title, ex.text);
      const mirror = ex.learn?.publicRepo && (await github.repoExists(ex.learn.publicRepo)) ? ex.learn.publicRepo : undefined;
      const learn = ex.learn
        ? {
            ...(mirror ? { repo: mirror, branch: ex.learn.publicBranch } : {}),
            path: ex.learn.publicPath ?? ex.learn.path,
            ...(ex.learn.commit ? { commit: ex.learn.commit } : {}),
            ...(ex.learn.documentId ? { documentId: ex.learn.documentId } : {}),
          }
        : undefined;
      let current: SourceState = {
        url: redirect === "moved" ? cleanMovedUrl(res.finalUrl) : s.url,
        // Cleaned of tracking parameters: Google adds a random visit_id to every redirect.
        ...(redirect === "redirected" ? { finalUrl: cleanMovedUrl(res.finalUrl) } : {}),
        status: "ok",
        httpStatus: res.status,
        title: ex.title || undefined,
        contentHash: ex.contentHash,
        words: ex.words,
        sections: ex.sections,
        updated: ex.updated,
        learn,
        terms: ex.terms,
        versions: versions.length ? versions : undefined,
        retired: ex.retired,
        passed: ex.deadlines.filter((d) => d < date),
      };
      // Republishing without a text change moves commits and dates: keep the baseline's.
      const sameText = !!base?.contentHash && base.contentHash === current.contentHash && cleanTitle(base.title ?? "") === cleanTitle(current.title ?? "");
      if (sameText)
        current = { ...current, updated: base.updated, learn: base.learn ?? current.learn, httpStatus: base.status === "ok" ? (base.httpStatus ?? current.httpStatus) : current.httpStatus };
      const commitBacked = !!(base?.learn?.commit && learn?.commit && base.learn.commit !== learn.commit);
      const lastCommit = cache.memos[s.id]?.commit ?? base?.learn?.commit;
      const freshCommit = !!(learn?.commit && lastCommit && learn.commit !== lastCommit);
      const tocUrl = ex.learn?.tocRel ? tocUrlFor(res.finalUrl, ex.learn.tocRel) : undefined;
      return { kind: "ok", source: s, res, ex, current, redirect, sameText, commitBacked, freshCommit, tocUrl };
    }),
  );

  // 2. Guards. A dead runner network shouldn't report every source as broken, one host blocking the runner shouldn't
  // break all its sources, and a site redesign shouldn't report every page on that host as changed.
  // Only refusals and failed requests count here; pages that loaded but couldn't be read go the unmonitored route.
  const failing = (r: Raw) => (r.kind === "failed" && r.res.outcome !== "not-found") || (r.kind === "blocked" && r.fetchLevel);
  const perHost = new Map<string, Raw[]>();
  for (const r of raws) if (r.kind !== "skip") perHost.set(hostOf(r.source.url), [...(perHost.get(hostOf(r.source.url)) ?? []), r]);
  const downHosts = new Set<string>();
  for (const [h, list] of perHost) {
    const down = list.filter(failing).length;
    if (list.length >= 3 && down / list.length >= HOST_FAILURE_RATE) downHosts.add(h);
  }
  // Failures spread across many hosts point at the runner's network: abort rather than report them.
  const spread = raws.filter((r) => r.kind !== "skip" && failing(r) && !downHosts.has(hostOf(r.source.url))).length;
  const everywhere = raws.filter(failing).length;
  if (stats.checked >= 20 && (spread / stats.checked > SYSTEMIC_FAILURE_RATE || everywhere / stats.checked > 0.6))
    throw new Error(`${everywhere} of ${stats.checked} sources failed to load; this looks like a network problem on the runner, not broken sources. Nothing was written.`);
  for (const h of downHosts) {
    const list = perHost.get(h)!;
    stats.skipped.push(`${list.filter(failing).length} of ${list.length} sources on ${h} failed at once; treated as the host blocking or failing the runner, not as broken pages`);
  }
  // Template changes: many pages on one host changing on the same night, with no new commit behind them, is page
  // furniture rather than guidance. Those pages are held, not reported one by one, and stay held while they keep that
  // text; one finding per host lists them, and merging re-baselines them. A held page that changes again is compared
  // normally, so a real edit later still gets reported.
  const held = new Map<string, string[]>();
  for (const [h, list] of perHost) {
    const ok = list.filter((r): r is Loaded => r.kind === "ok");
    // Changed since the page last loaded (the hash is remembered across failed nights, and a cold cache knows nothing,
    // so neither can trip the guard), with no new commit behind it, and different from the baseline.
    const fresh = ok.filter((r) => {
      const b = baseFor(r.source);
      const memo = cache.memos[r.source.id];
      return !!b?.contentHash && !r.sameText && !r.freshCommit && memo?.last !== undefined && memo.last !== r.ex.contentHash;
    });
    const tonight = ok.length >= 10 && fresh.length / ok.length > MASS_CHANGE_RATE;
    // A page whose substantial change is already in the open pull request keeps being reported, not held.
    const pending = (r: Loaded) => {
      const memo = cache.memos[r.source.id];
      return !!memo?.reported && memo.reported === memo.last && memo.last !== baseFor(r.source)?.contentHash;
    };
    const ids = ok
      .filter((r) => !r.sameText && ((tonight && fresh.includes(r) && !pending(r)) || cache.memos[r.source.id]?.template === r.ex.contentHash))
      .map((r) => r.source.id);
    if (ids.length) held.set(h, ids);
    if (tonight)
      stats.skipped.push(`${fresh.length} of ${ok.length} pages on ${h} changed at once without a new commit; held as a site template change (check the selectors in scripts/watch/hosts.ts)`);
  }
  const isHeld = (id: string) => [...held.values()].some((ids) => ids.includes(id));

  // 3. Decide, per source, what to report and what the baseline should become.
  for (const r of raws) {
    const s = r.source;
    const base = baseFor(s);
    if (r.kind === "skip") {
      if (baseline.sources[s.id]) proposed.sources[s.id] = baseline.sources[s.id];
      if (baseline.sources[s.id]?.contentHash) keep[s.id] = [baseline.sources[s.id].contentHash!];
      continue;
    }
    // A maintainer pointed the source at a new URL: the old URL's failure history doesn't apply. Reset once, when the
    // URL changes; the old baseline entry is kept until the new URL loads, so "no base" alone would reset every night.
    const memo = (cache.memos[s.id] ??= {});
    const at = normalizeUrl(s.url);
    if (memo.url !== at && (memo.url !== undefined || (baseline.sources[s.id] && !base))) cache.forget(s.id);
    memo.url = at;
    if (base?.contentHash) keep[s.id] = [base.contentHash];

    if (r.kind === "blocked" || (r.kind === "failed" && r.res.outcome !== "not-found" && downHosts.has(hostOf(s.url)))) {
      unverifiable(s, base, r.kind === "blocked" ? r.reason : `${r.res.error ?? `HTTP ${r.res.status}`} while most of ${hostOf(s.url)} failed`);
      continue;
    }
    if (r.kind === "failed") {
      failed(s, base, r.res);
      continue;
    }

    // The page loaded.
    delete cache.failures[s.id];
    delete cache.unverified[s.id];
    const { ex, current, redirect } = r;
    if (ex.learn?.commit) memo.commit = ex.learn.commit;
    memo.last = ex.contentHash;
    if (isHeld(s.id)) memo.template = ex.contentHash;
    else delete memo.template;
    if (r.sameText) delete memo.reported;
    cache.writeSnapshot(s.id, ex.contentHash, ex.text);
    keep[s.id] = [...new Set([base?.contentHash, ex.contentHash].filter((h): h is string => !!h))];

    if (!base) {
      proposed.sources[s.id] = current;
      findings.push(finding(s, { kind: "baseline", actionable: true, detail: `Started tracking: ${current.words} words, ${current.sections?.length ?? 0} sections.` }));
      reportPageState(s, r, undefined);
      continue;
    }

    let events = false;
    const recovered = (detail: string) => {
      events = true;
      findings.push(finding(s, { kind: "recovered", actionable: true, detail }));
    };
    if (base.status !== "ok") recovered(base.status === "broken" ? "Loads again." : "Can be checked again.");
    if (base.finalUrl && redirect === "none") recovered("No longer redirects.");
    if (base.retired && !current.retired) recovered("No longer marked retired.");
    if (reportPageState(s, r, base)) events = true;

    // Content changes, judged against the baseline so small edits add up.
    // A first successful load after being broken or unmonitored is a first fingerprint, not a change.
    // Pages held for a template change are re-baselined by merging their host's finding.
    if (!base.contentHash || isHeld(s.id)) events = true;
    else if (!r.sameText && redirect !== "redirected" && (await reportChange(s, r, base))) {
      events = true;
      memo.reported = ex.contentHash;
    }

    if (events) proposed.sources[s.id] = current;
    else {
      // Quiet bookkeeping, with no finding: a baseline written before `passed` existed takes tonight's past dates once
      // (so later deadlines fire), and unchanged text takes the current tracked-term vocabulary.
      let kept = base;
      if (base.contentHash && base.passed === undefined) kept = { ...kept, passed: current.passed };
      if (r.sameText && stableStringify(base.terms ?? []) !== stableStringify(current.terms ?? [])) kept = { ...kept, terms: current.terms };
      proposed.sources[s.id] = kept;
    }
  }

  for (const [h, ids] of held) {
    const total = perHost.get(h)!.filter((r) => r.kind === "ok").length;
    findings.push({
      kind: "template",
      title: h,
      url: `https://${h}/`,
      actionable: true,
      detail: `${ids.length} of ${total} pages changed together without a new commit, which looks like a change to the site's page furniture rather than its guidance, so they aren't reported one by one. Merging re-baselines them.`,
      held: ids,
      citedBy: [],
    });
  }

  for (const id of new Set([...Object.keys(cache.failures), ...Object.keys(cache.unverified)])) if (!catalogue.sources.has(id)) cache.forget(id);
  for (const id of Object.keys(cache.memos)) if (!catalogue.sources.has(id)) delete cache.memos[id];

  // Sources removed from content/sources.
  for (const id of Object.keys(baseline.sources))
    if (!catalogue.sources.has(id))
      findings.push({ kind: "baseline", title: id, url: baseline.sources[id].url, actionable: true, detail: `Stopped tracking ${id}: it was removed from content/sources.`, citedBy: [] });

  /** Every URL a source is known by (cited, moved-to, redirected-to), normalised with and without its query. */
  const citedUrls = new Map<string, string>();
  for (const s of sources)
    for (const u of [s.url, proposed.sources[s.id]?.url, proposed.sources[s.id]?.finalUrl]) if (u) for (const k of [normalizeUrl(u), withoutQuery(u)]) citedUrls.set(k, s.id);

  // 4. New pages in the Learn table-of-contents sections that hold cited pages.
  if (deps.only) proposed.neighbours = { ...baseline.neighbours };
  else await scanTocs();

  // 5. Announcement feeds.
  if (deps.feeds?.length && !deps.only) {
    const feedRun = await checkFeeds(deps.feeds, baseline.feeds, fetcher, citedUrls, cache.feeds);
    for (const id of Object.keys(cache.feeds)) if (!deps.feeds.some((d) => d.id === id)) delete cache.feeds[id];
    proposed.feeds = feedRun.feeds;
    findings.push(...feedRun.findings);
    stats.skipped.push(...feedRun.skipped);
  } else proposed.feeds = { ...baseline.feeds };

  // 6. Optional Claude triage of substantial changes.
  if (deps.triage) {
    const inputs: TriageInput[] = findings
      .filter((f) => f.actionable && (f.kind === "changed" || f.kind === "retired") && f.sourceId && f.change)
      .map((f) => ({
        finding: f,
        source: catalogue.sources.get(f.sourceId!)!,
        questions: f.citedBy.map((id) => questions.get(id)).filter((q): q is Question => !!q),
        diffText: diffTextFor.get(f.sourceId!),
      }));
    if (inputs.length) {
      const t = await deps.triage(inputs);
      stats.triageCalls = t.calls;
      stats.skipped.push(...t.skipped);
      for (const f of findings) if (f.change && f.sourceId && t.results.has(f.sourceId)) f.change.triage = t.results.get(f.sourceId);
    }
  }

  if (deps.simulate) simulate();

  const limitedBy = github.limited();
  if (limitedBy) stats.skipped.push(limitedBy);
  stats.githubCalls = github.calls();
  stats.durationMs = Date.now() - started;
  cache.prune(keep);

  const changedState = stableStringify(proposed) !== stableStringify(baseline);
  if (changedState && !findings.some((f) => f.actionable))
    findings.push({ kind: "baseline", title: "watch/state.json", url: "", actionable: true, detail: "Baseline housekeeping with no other change.", citedBy: [] });

  return {
    date,
    findings,
    actionable: changedState || Object.keys(urlUpdates).length > 0 || findings.some((f) => f.actionable),
    state: proposed,
    urlUpdates,
    stats,
    simulated: !!deps.simulate,
  };

  /** A source that couldn't be checked: informational until it stays that way for `unmonitoredAfter` nights. */
  function unverifiable(s: Source, base: SourceState | undefined, reason: string) {
    const nights = cache.bump("unverified", s.id, date);
    if (nights < unmonitoredAfter) {
      // Keep the old entry (even under a URL a maintainer has since changed) until the new URL can be fingerprinted.
      const keepEntry = base ?? baseline.sources[s.id];
      if (keepEntry) proposed.sources[s.id] = keepEntry;
      findings.push(finding(s, { kind: "unverifiable", actionable: false, detail: `${reason}${nights > 1 ? ` (${nights} nights in a row)` : ""}` }));
    } else if (base?.status === "unmonitored") {
      proposed.sources[s.id] = base;
      findings.push(finding(s, { kind: "unmonitored", actionable: false, acknowledged: true, detail: `Still can't be checked: ${reason}` }));
    } else {
      proposed.sources[s.id] = { ...(base ?? { url: s.url }), url: s.url, status: "unmonitored" };
      findings.push(finding(s, { kind: "unmonitored", actionable: true, detail: `Couldn't be checked for ${nights} nights in a row: ${reason}. Check it by hand or adjust its host profile.` }));
    }
  }

  /** A 404/410 is broken at once; other failures only after `threshold` runs in a row. */
  function failed(s: Source, base: SourceState | undefined, res: FetchResult) {
    const gone = res.outcome === "not-found";
    const count = gone ? threshold : cache.bump("failures", s.id, date);
    if (gone) delete cache.failures[s.id];
    const reason = gone ? `HTTP ${res.status}: the page no longer exists` : `${res.error ?? `HTTP ${res.status}`}${count > 1 ? ` (${count} nights in a row)` : ""}`;
    if (count < threshold) {
      const keepEntry = base ?? baseline.sources[s.id];
      if (keepEntry) proposed.sources[s.id] = keepEntry;
      findings.push(finding(s, { kind: "unverifiable", actionable: false, detail: `${reason}; reported as broken if it fails again` }));
    } else if (base?.status === "broken") {
      proposed.sources[s.id] = base;
      findings.push(finding(s, { kind: "broken", actionable: false, acknowledged: true, detail: `Still broken: ${reason}` }));
    } else {
      proposed.sources[s.id] = { ...(base ?? { url: s.url }), url: s.url, status: "broken", ...(res.status ? { httpStatus: res.status } : {}) };
      findings.push(finding(s, { kind: "broken", actionable: true, detail: reason, ...(res.redirects.length ? { newUrl: res.finalUrl } : {}) }));
    }
  }

  /** Moves, redirects, retirement and versions. Returns true when something new needs acknowledging. */
  function reportPageState(s: Source, r: Loaded, base: SourceState | undefined): boolean {
    const { ex, current, redirect, res } = r;
    let events = false;
    if (current.retired) {
      const fresh = !base?.retired;
      if (fresh && base) events = true;
      findings.push(
        finding(s, {
          kind: "retired",
          actionable: fresh,
          ...(fresh ? {} : { acknowledged: true }),
          detail: `The page is retired: ${current.retired}.`,
          ...(redirect !== "none" ? { newUrl: res.finalUrl } : {}),
        }),
      );
    } else if (redirect === "moved") {
      const twin = [owner.get(normalizeUrl(current.url)), owner.get(withoutQuery(current.url))].find((id) => id && id !== s.id);
      const blocked = twin
        ? `Now the same page as ${twin}; merge the two sources.`
        : !current.url.startsWith("https://")
          ? "Moved to an address that isn't https; update it by hand."
          : undefined;
      if (blocked) {
        // Not applied automatically: keep the cited URL and record where it goes, like any other redirect.
        current.url = s.url;
        current.finalUrl = cleanMovedUrl(res.finalUrl);
        if (base) events = true;
        findings.push(finding(s, { kind: "redirected", newUrl: res.finalUrl, actionable: true, detail: blocked }));
      } else {
        if (base) events = true;
        urlUpdates[s.id] = current.url;
        findings.push(finding(s, { kind: "moved", newUrl: current.url, actionable: true, detail: `Moved to ${current.url}` }));
      }
    } else if (redirect === "redirected") {
      const fresh = !base?.finalUrl || !equivalentUrls(base.finalUrl, res.finalUrl);
      if (fresh && base) events = true;
      const home = new URL(res.finalUrl).pathname.replace(/\/(?:[a-z]{2}-[a-z]{2}\/?)?$/i, "") === "";
      findings.push(
        finding(s, {
          kind: "redirected",
          newUrl: res.finalUrl,
          actionable: fresh,
          ...(fresh ? {} : { acknowledged: true }),
          detail: home
            ? "Now lands on the site's home page: the page was probably removed."
            : ex.isLanding
              ? `Now lands on a hub or landing page (“${ex.title}”).`
              : `Now lands on a different page (“${ex.title}”).`,
        }),
      );
    }

    // A lifecycle date on the page has passed since the baseline was accepted.
    // A baseline written before `passed` existed can't say which dates were already accepted: adopt them quietly.
    const lapsed = base?.passed ? (current.passed ?? []).filter((d) => !base.passed!.includes(d)) : [];
    if (lapsed.length && base) {
      events = true;
      const quotable = licenceFor(res.finalUrl, current.learn?.repo);
      const line = lifecycleLine(ex.blocks, lapsed[0]);
      const snippet = quotable && line ? ` It says: “${truncate(line, 200)}”` : "";
      findings.push(
        finding(s, {
          kind: "deadline",
          actionable: true,
          detail: `The page gives ${lapsed.length === 1 ? "a date" : "dates"} for a retirement or change that ${lapsed.length === 1 ? "has" : "have"} now passed (${lapsed.join(", ")}).${snippet} Check the cited guidance and the questions that cite it still hold.`,
        }),
      );
    }

    const cited = citedVersion(s.title);
    const latest = highest(current.versions);
    if (cited && latest && compareVersions(latest, cited.version) > 0) {
      const known = highest(base?.versions);
      const fresh = !known || compareVersions(latest, known) > 0;
      if (fresh && base) events = true;
      findings.push(
        finding(s, {
          kind: "version",
          actionable: fresh,
          ...(fresh ? {} : { acknowledged: true }),
          detail: `Cited version ${cited.version}; the page now lists ${latest}. Update the source title and review the mapped recommendations.`,
        }),
      );
    }
    return events;
  }

  /** Compare the page with the baseline. Returns true for a substantial change, which the baseline then takes. */
  async function reportChange(s: Source, r: Loaded, base: SourceState): Promise<boolean> {
    const { ex, current, redirect } = r;
    let diff: TextDiff | undefined;
    let commits: Commit[] | undefined;
    let link: string | undefined;
    const repo = current.learn?.repo;
    if (r.commitBacked && repo && base.learn?.repo === repo && base.learn.commit && current.learn?.commit) {
      const [oldMd, newMd] = await Promise.all([github.fileAt(repo, base.learn.commit, base.learn.path), github.fileAt(repo, current.learn.commit, current.learn.path)]);
      if (oldMd !== undefined && newMd !== undefined) {
        diff = diffTexts(markdownBody(oldMd), markdownBody(newMd));
        commits = await github.commitsBetween(repo, current.learn.path, base.learn.commit, current.learn.commit);
        link = compareUrl(repo, base.learn.commit, current.learn.commit, current.learn.path);
      }
    }
    // The published page is the record: prefer its own text diff when an earlier copy is cached.
    const old = base.contentHash ? cache.readSnapshot(s.id, base.contentHash) : undefined;
    if (old !== undefined && base.contentHash !== current.contentHash) diff = diffTexts(old, ex.text);
    // Judge terms in today's vocabulary, so a change to TRACKED_TERMS isn't reported as the page changing: from the
    // cached baseline text when there is one, otherwise the stored terms that are still tracked.
    const termsBefore = old !== undefined ? findTerms(old) : (base.terms ?? []).filter((t) => TRACKED.has(t));
    const cls = classifyChange({ ...base, terms: termsBefore }, current, diff);
    const change = { ...cls.detail, ...(commits?.length ? { commits } : {}), ...(link ? { compareUrl: link } : {}) };
    if (diff && diff.wordsAdded + diff.wordsRemoved > 0) {
      // Both sides of the diff must be quotable under the same licence (a page can move between sites or repos).
      const before = licenceFor(base.finalUrl ?? base.url, base.learn?.repo);
      const after = licenceFor(r.res.finalUrl, current.learn?.repo);
      if (before && after && before.label === after.label) {
        change.excerpt = excerpt(diff);
        change.excerptNote = `${after.label}; lines shortened`;
        if (after.url) change.excerptLicenceUrl = after.url;
      } else change.excerptNote = "No excerpt: this page's text isn't openly licensed. Open the page to read the change.";
      diffTextFor.set(
        s.id,
        diff.lines
          .filter((l) => l)
          .map((l) => `${l!.op} ${l!.text}`)
          .join("\n"),
      );
    }
    const major = cls.severity === "major";
    findings.push(
      finding(s, {
        kind: major && cls.lifecycle.length && !current.retired ? "retired" : "changed",
        severity: cls.severity,
        actionable: major,
        detail: cls.reasons.join("; ") || "content changed",
        change,
        ...(redirect === "moved" ? { newUrl: current.url } : {}),
      }),
    );
    return major;
  }

  async function scanTocs() {
    const byToc = new Map<string, Source[]>();
    let learnAllOk = true;
    for (const r of raws) {
      if (r.kind === "ok" && r.tocUrl) byToc.set(r.tocUrl, [...(byToc.get(r.tocUrl) ?? []), r.source]);
      else if (r.kind !== "skip" && r.kind !== "ok" && hostOf(r.source.url) === "learn.microsoft.com") learnAllOk = false;
    }
    const limit = limiter(4);
    const max = deps.maxPerSection ?? 5;
    const startedSections: string[] = [];
    const renamed = new Set<string>();
    const fetched = new Set<string>();
    await Promise.all(
      [...byToc].map(([tocUrl, cited]) =>
        limit(async () => {
          const res = await fetcher.fetchPage(tocUrl, { accept: "application/json" });
          let nodes;
          try {
            nodes = res.outcome === "ok" && res.body ? parseToc(JSON.parse(res.body), tocUrl) : undefined;
          } catch {
            nodes = undefined;
          }
          if (!nodes) {
            stats.skipped.push(`Learn table of contents ${tocUrl} couldn't be read (${res.error ?? res.outcome}); kept its sections as they were`);
            return;
          }
          fetched.add(tocUrl);
          const paths = tocPaths(nodes);
          for (const s of cited) {
            const section = sectionOf(nodes, proposed.sources[s.id]?.url ?? s.url);
            if (!section) continue;
            const key = `${tocUrl}#${section.path}`;
            if (proposed.neighbours[key]) continue;
            const pages = [...new Set(section.pages.map((p) => p.url))].sort();
            // A renamed section (or a renamed group above it) gets a new key: compare with the old section that
            // listed this page, so pages added in the same update are still reported.
            // Only a section whose path is gone from the TOC, and which mostly matches the new one in both directions,
            // counts as renamed: a cited page moving into another section, or a section folded into a bigger one, isn't.
            const urls = new Set(section.pages.map((p) => p.url));
            const renamedFrom = baseline.neighbours[key]
              ? undefined
              : Object.keys(baseline.neighbours).find((k) => {
                  const old = baseline.neighbours[k];
                  return (
                    k.startsWith(`${tocUrl}#`) &&
                    !proposed.neighbours[k] &&
                    !paths.has(k.slice(tocUrl.length + 1)) &&
                    old.some((u) => urls.has(u) && citedUrls.get(u) === s.id) &&
                    old.filter((u) => urls.has(u)).length * 2 >= old.length &&
                    section.pages.filter((p) => old.includes(p.url)).length * 2 >= section.pages.length
                  );
                });
            const before = baseline.neighbours[key] ?? (renamedFrom ? baseline.neighbours[renamedFrom] : undefined);
            if (renamedFrom) renamed.add(renamedFrom);
            if (!before) {
              proposed.neighbours[key] = pages;
              startedSections.push(section.path);
              continue;
            }
            const fresh = section.pages.filter((p) => !before.includes(p.url) && !citedUrls.has(p.url));
            const reported = fresh.slice(0, max);
            proposed.neighbours[key] = [...new Set([...before, ...reported.map((p) => p.url)])].sort();
            for (const p of reported)
              findings.push({
                kind: "candidate",
                title: p.title || p.url,
                url: p.url,
                actionable: true,
                detail: `New page in the Learn section “${section.path}”`,
                citedBy: [],
                candidate: { origin: "learn-toc", near: s.id },
              });
            if (fresh.length > max) stats.skipped.push(`${fresh.length - max} more new pages in “${section.path}” wait for the next run (cap ${max} per section)`);
          }
        }),
      ),
    );
    // Sections from TOCs that couldn't be read stay, and so does everything while any Learn page couldn't be checked.
    let dropped = 0;
    for (const [key, pages] of Object.entries(baseline.neighbours)) {
      if (proposed.neighbours[key]) continue;
      if (renamed.has(key)) continue;
      if (fetched.has(key.slice(0, key.indexOf("#"))) && learnAllOk) dropped++;
      else proposed.neighbours[key] = pages;
    }
    if (renamed.size)
      findings.push({ kind: "baseline", title: "Learn sections", url: "", actionable: true, detail: `${renamed.size} Learn section${renamed.size === 1 ? " was" : "s were"} renamed; tracking continues under the new name.`, citedBy: [] });
    if (startedSections.length || dropped)
      findings.push({
        kind: "baseline",
        title: "Learn sections",
        url: "",
        actionable: true,
        detail:
          [
            startedSections.length ? `Started tracking ${startedSections.length} Learn section${startedSections.length === 1 ? "" : "s"} (${truncate(startedSections.join("; "), 300)})` : "",
            dropped ? `stopped tracking ${dropped} that no cited page is in any more` : "",
          ]
            .filter(Boolean)
            .join("; ") + ".",
        citedBy: [],
      });
  }

  function simulate() {
    const id = Object.keys(proposed.sources)
      .sort()
      .find((k) => proposed.sources[k].status === "ok" && catalogue.sources.has(k));
    if (!id) return;
    const s = catalogue.sources.get(id)!;
    proposed.sources[id] = { ...proposed.sources[id], contentHash: "simulated0000000" };
    findings.push(
      finding(s, {
        kind: "changed",
        severity: "major",
        actionable: true,
        detail: "SIMULATED change to test the pull request path; nothing on the page changed",
        change: { changedRatio: 0, wordsAdded: 0, wordsRemoved: 0, sectionsAdded: [], sectionsRemoved: [], sectionsChanged: [], termsAdded: [], termsRemoved: [] },
      }),
    );
  }
}
