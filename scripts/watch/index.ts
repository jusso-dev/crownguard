/**
 * Nightly source watch: `pnpm watch:sources [--dry-run] [--simulate] [--only id,id] [--out dir]`.
 *
 * Checks every cited page, compares it with the committed baseline (`watch/state.json`), applies safe fixes (moved
 * URLs) to content/sources, writes the new baseline and a Markdown report. With `--out` it also writes everything the
 * workflow's propose job needs: state.json, url-updates.json, report.md and pr-body.md. In GitHub Actions it sets the
 * `actionable` and `title` step outputs that decide whether a pull request is opened.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCatalogue } from "../../src/content/loader";
import { actionsRunUrl, cliArgs, contentGuideUrl, githubToken, setOutputs } from "../lib/cli";
import { loadContentOrExit } from "../lib/content";
import { today } from "../lib/dates";
import { rawUrl } from "../lib/github";
import { readRepoFile, ROOT } from "../lib/repo";
import { parseIdList } from "../lib/text";
import { M365_SECURE, PROWLER, SCUBAGOGGLES } from "../lib/upstreams";
import { readContentFiles } from "../read-content";
import { applyUrlUpdates, readSourceFiles, readState, writeState, type UrlUpdate } from "./apply";
import { openCache } from "./cache";
import { createFetcher } from "./fetch";
import { watchedFeeds } from "./feeds";
import { createGitHub } from "./github";
import { profileFor } from "./hosts";
import { parseM365ChecksMd, type UpstreamChecks } from "./mappings";
import { PR_BODY_LIMIT, prTitle, renderReport, summaryLine } from "./report";
import { runWatch } from "./run";
import { triageChanges } from "./triage";
import { stableStringify } from "./util";

const { values: args } = parseArgs({
  args: cliArgs(),
  options: {
    state: { type: "string", default: "watch/state.json" },
    cache: { type: "string", default: ".watch-cache" },
    report: { type: "string", default: "watch-report.md" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    simulate: { type: "boolean", default: false },
    only: { type: "string" },
    "no-feeds": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const env = process.env;
// resolve(), not join(): the workflow passes absolute paths under $RUNNER_TEMP.
const statePath = resolve(ROOT, args.state!);
const reportPath = resolve(ROOT, args.report!);
const reportOpts = { runUrl: actionsRunUrl(), guideUrl: contentGuideUrl("source-watch") };

const catalogue = loadContentOrExit();
const cache = openCache(resolve(ROOT, args.cache!));
const github = createGitHub({ token: githubToken() });
const apiKey = env.ANTHROPIC_API_KEY || undefined;

const baseline = readState(statePath);
const fetcher = createFetcher({
  concurrencyFor: (host) => profileFor(host).concurrency,
  delayFor: (host) => profileFor(host).delayMs ?? 0,
  retriesFor: (host) => profileFor(host).retries,
  userAgentFor: (host) => profileFor(host).userAgent,
});

/** Live M365 check catalogue plus the committed Prowler/Scuba pins (tests inject fixtures instead). */
async function loadUpstreamChecks(): Promise<UpstreamChecks[]> {
  const out: UpstreamChecks[] = [];
  const m365 = await fetcher.fetchPage(rawUrl(M365_SECURE.repo, M365_SECURE.ref, M365_SECURE.checksPath), {
    accept: "text/plain, text/markdown;q=0.9, */*;q=0.5",
  });
  if (m365.outcome === "ok" && m365.body) out.push({ mappingId: M365_SECURE.mapping, ids: parseM365ChecksMd(m365.body) });
  else console.error(`${M365_SECURE.mapping} checks: ${m365.error ?? m365.outcome}`);
  for (const { file, mapping } of [...PROWLER.lists, ...SCUBAGOGGLES.lists]) out.push({ mappingId: mapping, ids: parseIdList(readRepoFile(file)) });
  return out;
}

let result;
try {
  result = await runWatch({
    catalogue,
    baseline,
    cache,
    fetcher,
    github,
    date: today(),
    feeds: args["no-feeds"] ? [] : watchedFeeds(),
    upstreamChecks: args.only ? undefined : await loadUpstreamChecks(),
    simulate: args.simulate || env.WATCH_SIMULATE === "true",
    only: args.only ? new Set(args.only.split(",").map((s) => s.trim())) : undefined,
    triage: apiKey ? (inputs) => triageChanges(inputs, { apiKey, log: console.log }) : undefined,
    log: args.verbose ? console.log : undefined,
  });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const applied: UrlUpdate[] = [];
if (!args["dry-run"]) {
  // `retrieved` is the night the move was first seen, so an unmerged fix doesn't change (and force-push) nightly.
  const updates = Object.entries(result.urlUpdates).map(([id, url]) => ({ id, url, retrieved: cache.firstSeen(`moved:${id}:${url}`, result.date) }));
  if (updates.length) {
    const files = readSourceFiles();
    for (const update of updates) {
      const f = result.findings.find((x) => x.kind === "moved" && x.sourceId === update.id);
      try {
        const edited = applyUrlUpdates(files, [update]);
        // Backstop: the edited content must still validate (for example, no two sources on one page).
        const check = loadCatalogue({ ...readContentFiles(), ...Object.fromEntries(Object.entries({ ...files, ...edited }).map(([p, t]) => [relative(ROOT, p), t])) });
        if (check.errors.length) throw new Error(check.errors[0]);
        for (const [path, text] of Object.entries(edited)) {
          files[path] = text;
          writeFileSync(path, text);
        }
        if (f) f.applied = true;
        applied.push(update);
      } catch (e) {
        console.error(`couldn't update ${update.id}: ${(e as Error).message}`);
        if (f) f.detail += ` (automatic update failed: ${(e as Error).message})`;
        // Keep the old URL in the baseline so the next run tries again.
        result.state.sources[update.id] = { ...result.state.sources[update.id], url: catalogue.sources.get(update.id)!.url, finalUrl: update.url };
      }
    }
  }
  writeState(statePath, result.state);
}
// Actionable means the PR would have a diff: a failed URL update can leave a move finding with nothing to commit.
result.actionable = applied.length > 0 || stableStringify(result.state) !== stableStringify(baseline);

const report = renderReport(result, reportOpts);
const prBody = renderReport(result, { ...reportOpts, maxChars: PR_BODY_LIMIT });
writeFileSync(reportPath, report);
if (args.out) {
  const out = resolve(ROOT, args.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "state.json"), stableStringify(result.state));
  writeFileSync(join(out, "url-updates.json"), stableStringify(applied));
  writeFileSync(join(out, "report.md"), report);
  writeFileSync(join(out, "pr-body.md"), prBody);
}
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report.slice(0, 1_000_000));
// Only values built from counts and dates reach step outputs; the title is checked against that shape.
const title = prTitle(result);
if (!/^[\w ,:()[\]-]+$/.test(title)) throw new Error(`unexpected PR title: ${title}`);
setOutputs({ actionable: result.actionable, title });
// Dry and simulated runs don't advance failure counters or first-seen dates.
if (!args["dry-run"] && !result.simulated) cache.save();

console.log(summaryLine(result));
console.log(`report: ${relative(process.cwd(), reportPath)}${args["dry-run"] ? " (dry run: nothing written to content or state)" : ""}`);
