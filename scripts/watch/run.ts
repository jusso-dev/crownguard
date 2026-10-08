import type { Catalogue, Question, Source } from "../../src/content/schema";
import {
  citedByIndex,
  citedVersion,
  classifyChange,
  compareVersions,
  diffTexts,
  excerpt,
  housekeeping,
  redirectKind,
  versionsOnPage,
  type TextDiff,
} from "./compare";
import { extractHtml, extractPdf } from "./extract";
import { checkFeeds, type FeedDef } from "./feeds";
import { compareUrl, markdownBody, type GitHub } from "./github";
import { hasProfile, profileFor } from "./hosts";
import { parseToc, sectionOf, tocUrlFor } from "./learn";
import type { TriageInput, TriageRun } from "./triage";
import type { Commit, Extracted, FetchResult, Fetcher, Finding, RunResult, RunStats, SourceState, WatchCache, WatchState } from "./types";
import { cleanTitle, hostOf, isLifecycleTerm, limiter, normalizeUrl, sameUrl, truncate } from "./util";

export interface WatchDeps {
  catalogue: Catalogue;
  /** Committed baseline (`watch/state.json` on main). */
  baseline: WatchState;
  cache: WatchCache;
  fetcher: Fetcher;
  github: GitHub;
  /** YYYY-MM-DD stamped on URL updates. */
  date: string;
  feeds?: FeedDef[];
  triage?: (inputs: TriageInput[]) => Promise<TriageRun>;
  /** Inject a fake substantial change so the pull request path can be tested end to end. */
  simulate?: boolean;
  /** Check only these source ids; everything else keeps its baseline. */
  only?: Set<string>;
  /** Consecutive failed runs before a source counts as broken. */
  failureThreshold?: number;
  /** New Learn pages listed per table-of-contents section per run. */
  maxPerSection?: number;
  log?: (line: string) => void;
}

/** Share of sources that may fail (network, 5xx, unexpected 4xx) before the run aborts instead of reporting them. */
const SYSTEMIC_FAILURE_RATE = 0.25;
/** Share of a host's pages that may change at once without a commit behind them before it looks like a site redesign. */
const MASS_CHANGE_RATE = 0.3;

/** Tracking and language parameters dropped from a moved page's new URL. */
const TRACKING = /^(?:utm_[a-z]+|sjid|visit_id|rd|ref_topic|authuser|co|hl)$/;

/** The cited URL plus the host's fetch-only parameters (for example hl=en). */
function fetchUrl(url: string, params: Record<string, string> | undefined): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.toString();
}

function cleanMovedUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u.toString();
}

type Checked =
  | { kind: "skip" }
  | { kind: "failed"; source: Source; res: FetchResult; broken: boolean; reason: string }
  | { kind: "unverifiable"; source: Source; reason: string }
  | {
      kind: "ok";
      source: Source;
      res: FetchResult;
      ex: Extracted;
      current: SourceState;
      redirect: "none" | "moved" | "redirected";
      changed: boolean;
      commitBacked: boolean;
      tocUrl?: string;
    };

export async function runWatch(deps: WatchDeps): Promise<RunResult> {
  const started = Date.now();
  const { catalogue, baseline, cache, fetcher, github, date } = deps;
  const log = deps.log ?? (() => {});
  const threshold = deps.failureThreshold ?? 2;
  const citedBy = citedByIndex(catalogue);
  const sources = [...catalogue.sources.values()].sort((a, b) => a.id.localeCompare(b.id));
  const questions = new Map<string, Question>();
  for (const bundle of catalogue.platforms.values()) for (const q of bundle.questions) questions.set(q.id, q);

  const stats: RunStats = { checked: 0, byHost: {}, outcomes: {}, githubCalls: 0, triageCalls: 0, durationMs: 0, skipped: [] };
  const state: WatchState = { version: 1, sources: {}, neighbours: {}, feeds: { ...baseline.feeds } };
  const findings: Finding[] = [];
  const urlUpdates: Record<string, string> = {};
  const keep: Record<string, string[]> = {};
  const diffTextFor = new Map<string, string>();

  /** The baseline entry, unless a maintainer has since pointed the source at a different URL. */
  const baseFor = (s: Source): SourceState | undefined => {
    const b = baseline.sources[s.id];
    return b && (sameUrl(b.url, s.url) || (b.finalUrl !== undefined && sameUrl(b.finalUrl, s.url))) ? b : undefined;
  };
  const finding = (s: Source, f: Omit<Finding, "sourceId" | "title" | "url" | "citedBy"> & Partial<Finding>): Finding => ({
    sourceId: s.id,
    title: s.title,
    url: s.url,
    citedBy: citedBy.get(s.id) ?? [],
    ...f,
  });

  // 1. Fetch and fingerprint every source. The fetcher limits concurrency per host.
  const checked: Checked[] = await Promise.all(
    sources.map(async (s): Promise<Checked> => {
      if (deps.only && !deps.only.has(s.id)) return { kind: "skip" };
      const base = baseFor(s);
      const host = hostOf(s.url);
      const res = await fetcher.fetchPage(fetchUrl(s.url, profileFor(host).fetchParams));
      const profile = profileFor(hostOf(res.finalUrl) || host);
      stats.checked++;
      stats.byHost[host] = (stats.byHost[host] ?? 0) + 1;
      stats.outcomes[res.outcome] = (stats.outcomes[res.outcome] ?? 0) + 1;
      log(`${res.outcome.padEnd(12)} ${res.status} ${s.id}${res.redirects.length ? ` -> ${res.finalUrl}` : ""}`);

      const blocked =
        res.outcome === "challenge" ||
        (profile.botProtected && res.outcome === "http-error" && [401, 403, 451].includes(res.status)) ||
        (profile.blockedOnNetworkError && res.outcome === "network");
      if (blocked) return { kind: "unverifiable", source: s, reason: `blocked by bot protection or a sign-in wall (${res.error ?? `HTTP ${res.status}`})` };
      if (res.outcome === "not-found") {
        delete cache.failures[s.id];
        return { kind: "failed", source: s, res, broken: true, reason: `HTTP ${res.status}: the page no longer exists` };
      }
      if (res.outcome !== "ok") {
        const count = (cache.failures[s.id] ?? 0) + 1;
        cache.failures[s.id] = count;
        const reason = `${res.error ?? `HTTP ${res.status}`}${count > 1 ? ` (${count} runs in a row)` : ""}`;
        return { kind: "failed", source: s, res, broken: count >= threshold, reason };
      }
      delete cache.failures[s.id];

      let ex: Extracted;
      try {
        const pdf = res.bytes && (/pdf/i.test(res.contentType ?? "") || /\.pdf$/i.test(new URL(res.finalUrl).pathname));
        if (res.body !== undefined) ex = extractHtml(res.body, profile);
        else if (pdf) ex = await extractPdf(res.bytes!);
        else return { kind: "unverifiable", source: s, reason: `unsupported content type ${res.contentType ?? "unknown"}` };
      } catch (e) {
        return { kind: "unverifiable", source: s, reason: `couldn't read the page: ${truncate((e as Error).message, 120)}` };
      }
      if (profile.lang && !profile.lang.test(ex.lang ?? ""))
        return { kind: "unverifiable", source: s, reason: `served in another language (${ex.lang ?? "unknown"}), so it couldn't be compared` };
      if (!ex.matchedSelector && hasProfile(profile.host)) {
        stats.skipped.push(`${profile.label}: the content selector didn't match ${s.id} as expected; the site layout may have changed (scripts/watch/hosts.ts)`);
        if (base) return { kind: "unverifiable", source: s, reason: "page layout changed, so the content couldn't be compared" };
      }

      const redirect = redirectKind(
        s.url,
        res.finalUrl,
        { title: ex.title, isLanding: ex.isLanding, retired: ex.retired, documentId: ex.learn?.documentId },
        { titles: [base?.title, s.title], documentId: base?.learn?.documentId },
      );
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
        ...(redirect === "redirected" ? { finalUrl: res.finalUrl } : {}),
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
      };
      cache.writeSnapshot(s.id, ex.contentHash, ex.text);
      keep[s.id] = [...new Set([base?.contentHash, ex.contentHash].filter((h): h is string => !!h))];

      // Republishing without a text change moves commits and dates. Keep the baseline's so state.json only changes
      // when the guidance does (every byte that changes force-pushes the open PR).
      const sameText = !!base && base.contentHash === current.contentHash && cleanTitle(base.title ?? "") === cleanTitle(current.title ?? "");
      if (sameText) current = { ...current, updated: base.updated, learn: base.learn ?? current.learn, httpStatus: base.httpStatus ?? current.httpStatus };

      const commitBacked = !!(base?.learn?.commit && learn?.commit && base.learn.commit !== learn.commit);
      const changed = !!base && redirect !== "redirected" && !sameText;
      const tocUrl = ex.learn?.tocRel ? tocUrlFor(res.finalUrl, ex.learn.tocRel) : undefined;
      return { kind: "ok", source: s, res, ex, current, redirect, changed, commitBacked, tocUrl };
    }),
  );

  // 2. Guards: a broken network shouldn't report every source as broken, and a site redesign shouldn't report every
  // page on that host as changed.
  const failedCount = checked.filter((c) => c.kind === "failed" && c.res.outcome !== "not-found").length;
  if (stats.checked >= 20 && failedCount / stats.checked > SYSTEMIC_FAILURE_RATE)
    throw new Error(`${failedCount} of ${stats.checked} sources failed to load; this looks like a network problem on the runner, not broken sources. Nothing was written.`);

  const suspectHosts = new Set<string>();
  const perHost = new Map<string, { total: number; changed: number }>();
  for (const c of checked) {
    if (c.kind !== "ok") continue;
    const h = hostOf(c.source.url);
    const e = perHost.get(h) ?? { total: 0, changed: 0 };
    e.total++;
    if (c.changed && !c.commitBacked) e.changed++;
    perHost.set(h, e);
  }
  for (const [h, { total, changed }] of perHost)
    if (total >= 10 && changed / total > MASS_CHANGE_RATE) {
      suspectHosts.add(h);
      stats.skipped.push(`${changed} of ${total} pages on ${h} changed at once without a recorded commit; treated as a site template change and not reported (check the selectors in scripts/watch/hosts.ts)`);
    }

  // 3. Turn each check into state and findings.
  for (const c of checked) {
    if (c.kind === "skip") continue;
    const s = c.source;
    const base = baseFor(s);

    if (c.kind === "unverifiable") {
      state.sources[s.id] = base ?? { url: s.url, status: "unverifiable" };
      if (base?.contentHash) keep[s.id] = [base.contentHash];
      findings.push(finding(s, { kind: "unverifiable", actionable: false, detail: c.reason }));
      continue;
    }

    if (c.kind === "failed") {
      if (base?.contentHash) keep[s.id] = [base.contentHash];
      if (!c.broken) {
        state.sources[s.id] = base ?? { url: s.url, status: "unverifiable" };
        findings.push(finding(s, { kind: "unverifiable", actionable: false, detail: `${c.reason}; reported as broken if it fails again` }));
        continue;
      }
      state.sources[s.id] = { ...(base ?? { url: s.url }), url: s.url, status: "broken", httpStatus: c.res.status || undefined };
      findings.push(finding(s, { kind: "broken", actionable: true, detail: c.reason, ...(c.res.redirects.length ? { newUrl: c.res.finalUrl } : {}) }));
      continue;
    }

    const { ex, current, redirect, res } = c;
    const profile = profileFor(hostOf(res.finalUrl));

    if (c.changed && suspectHosts.has(hostOf(s.url)) && !c.commitBacked && base) {
      state.sources[s.id] = base;
      continue;
    }
    state.sources[s.id] = current;

    if (current.retired) {
      // A cited page that is retired stays on the list until the citation is replaced.
      findings.push(finding(s, { kind: "retired", actionable: true, detail: `The page is retired: ${current.retired}.`, ...(redirect !== "none" ? { newUrl: res.finalUrl } : {}) }));
    } else if (redirect === "moved") {
      urlUpdates[s.id] = current.url;
      findings.push(finding(s, { kind: "moved", newUrl: current.url, actionable: true, detail: `Moved to ${current.url}` }));
    } else if (redirect === "redirected") {
      const home = new URL(res.finalUrl).pathname.replace(/\/(?:[a-z]{2}-[a-z]{2}\/?)?$/i, "") === "";
      findings.push(
        finding(s, {
          kind: "redirected",
          newUrl: res.finalUrl,
          actionable: true,
          detail: home
            ? "Now lands on the site's home page: the page was probably removed."
            : ex.isLanding
              ? `Now lands on a hub or landing page (“${ex.title}”).`
              : `Now lands on a different page (“${ex.title}”).`,
        }),
      );
    }

    if (!base) {
      findings.push(finding(s, { kind: "baseline", actionable: false, detail: `First fingerprint: ${current.words} words, ${current.sections?.length ?? 0} sections.` }));
    } else if (c.changed) {
      let diff: TextDiff | undefined;
      let commits: Commit[] | undefined;
      let link: string | undefined;
      const repo = current.learn?.repo;
      if (c.commitBacked && repo && base.learn?.repo === repo && base.learn.commit && current.learn?.commit) {
        const [oldMd, newMd] = await Promise.all([github.fileAt(repo, base.learn.commit, base.learn.path), github.fileAt(repo, current.learn.commit, current.learn.path)]);
        if (oldMd !== undefined && newMd !== undefined) {
          diff = diffTexts(markdownBody(oldMd), markdownBody(newMd));
          commits = await github.commitsBetween(repo, current.learn.path, base.learn.commit, current.learn.commit);
          link = compareUrl(repo, base.learn.commit, current.learn.commit, current.learn.path);
        }
      }
      // The published page is the record: prefer its own text diff when an earlier copy is cached.
      if (base.contentHash && base.contentHash !== current.contentHash) {
        const old = cache.readSnapshot(s.id, base.contentHash);
        if (old !== undefined) diff = diffTexts(old, ex.text);
      }
      const cls = classifyChange(base, current, diff);
      const change = {
        ...cls.detail,
        ...(commits?.length ? { commits } : {}),
        ...(link ? { compareUrl: link } : {}),
      };
      if (diff && diff.wordsAdded + diff.wordsRemoved > 0) {
        if (profile.excerpts !== "none") {
          change.excerpt = excerpt(diff);
          change.excerptNote = `excerpt: ${profile.licence ?? profile.label}`;
        } else change.excerptNote = `No excerpt: ${profile.label} content isn't openly licensed. Open the page to read the change.`;
        diffTextFor.set(
          s.id,
          diff.lines
            .filter((l) => l)
            .map((l) => `${l!.op} ${l!.text}`)
            .join("\n"),
        );
      }
      const lifecycle = cls.severity === "major" && change.termsAdded.some(isLifecycleTerm);
      findings.push(
        finding(s, {
          kind: lifecycle && !current.retired ? "retired" : "changed",
          severity: cls.severity,
          actionable: cls.severity === "major",
          detail: cls.reasons.join("; ") || "content changed",
          change,
          ...(redirect === "moved" ? { newUrl: current.url } : {}),
        }),
      );
    }

    const cited = citedVersion(s.title);
    const latest = current.versions?.at(-1);
    if (cited && latest && compareVersions(latest, cited.version) > 0)
      findings.push(finding(s, { kind: "version", actionable: true, detail: `Cited version ${cited.version}; the page now lists ${latest}. Update the source title and review the mapped recommendations.` }));
  }

  // Sources not checked this run (--only) keep their baseline.
  for (const s of sources) if (!state.sources[s.id] && baseline.sources[s.id]) state.sources[s.id] = baseline.sources[s.id];

  findings.push(...housekeeping(catalogue, citedBy, state.sources));

  /** Every URL a source is known by (cited, moved-to, redirected-to), normalised, mapped to the source id. */
  const citedUrls = new Map(
    sources.flatMap((s) => [s.url, state.sources[s.id]?.url, state.sources[s.id]?.finalUrl].filter((u): u is string => !!u).map((u) => [normalizeUrl(u), s.id] as const)),
  );

  // 4. New pages in the Learn table-of-contents sections that hold cited pages.
  if (deps.only) state.neighbours = { ...baseline.neighbours };
  else await scanTocs();

  // 5. Announcement feeds.
  if (deps.feeds?.length && !deps.only) {
    const feedRun = await checkFeeds(deps.feeds, baseline.feeds, fetcher, citedUrls);
    state.feeds = feedRun.feeds;
    findings.push(...feedRun.findings);
    stats.skipped.push(...feedRun.skipped);
  }

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

  return {
    date,
    findings,
    actionable: findings.some((f) => f.actionable),
    state,
    urlUpdates,
    stats,
    simulated: !!deps.simulate,
  };

  async function scanTocs() {
    const byToc = new Map<string, Source[]>();
    for (const c of checked)
      if (c.kind === "ok" && c.tocUrl && state.sources[c.source.id]?.status === "ok") byToc.set(c.tocUrl, [...(byToc.get(c.tocUrl) ?? []), c.source]);
    const limit = limiter(4);
    const max = deps.maxPerSection ?? 5;
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
            stats.skipped.push(`Learn table of contents ${tocUrl} couldn't be read (${res.error ?? res.outcome}); kept the previous page list`);
            for (const [k, v] of Object.entries(baseline.neighbours)) if (k.startsWith(`${tocUrl}#`)) state.neighbours[k] = v;
            return;
          }
          for (const s of cited) {
            const section = sectionOf(nodes, state.sources[s.id].url);
            if (!section) continue;
            const key = `${tocUrl}#${section.path}`;
            if (state.neighbours[key]) continue;
            state.neighbours[key] = [...new Set(section.pages.map((p) => p.url))].sort();
            const before = baseline.neighbours[key];
            if (!before) continue;
            const fresh = section.pages.filter((p) => !before.includes(p.url) && !citedUrls.has(p.url));
            for (const p of fresh.slice(0, max))
              findings.push({
                kind: "candidate",
                title: p.title || p.url,
                url: p.url,
                actionable: true,
                detail: `New page in the Learn section “${section.path}”`,
                citedBy: [],
                candidate: { origin: "learn-toc", near: s.id },
              });
            if (fresh.length > max) stats.skipped.push(`${fresh.length - max} more new pages in “${section.path}” not listed (cap ${max} per section)`);
          }
        }),
      ),
    );
  }

  function simulate() {
    const id = Object.keys(state.sources)
      .sort()
      .find((k) => state.sources[k].status === "ok" && catalogue.sources.has(k));
    if (!id) return;
    const s = catalogue.sources.get(id)!;
    state.sources[id] = { ...state.sources[id], contentHash: "simulated0000000" };
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
