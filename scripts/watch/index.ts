/**
 * Nightly source watch: `pnpm watch:sources [--dry-run] [--simulate] [--only id,id] [--out dir]`.
 *
 * Checks every cited page, compares it with the committed baseline (`watch/state.json`), applies safe fixes (moved
 * URLs) to content/sources, writes the new baseline and a Markdown report. With `--out` it also writes everything the
 * workflow's propose job needs: state.json, url-updates.json, report.md and pr-body.md. In GitHub Actions it sets the
 * `actionable` and `title` step outputs that decide whether a pull request is opened.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { loadCatalogue } from "../../src/content/loader";
import { readContentFiles } from "../read-content";
import { applyUrlUpdates, readState, writeState, type UrlUpdate } from "./apply";
import { openCache } from "./cache";
import { createFetcher } from "./fetch";
import { FEEDS } from "./feeds";
import { createGitHub } from "./github";
import { profileFor } from "./hosts";
import { PR_BODY_LIMIT, prTitle, renderReport, summaryLine } from "./report";
import { runWatch } from "./run";
import { triageChanges } from "./triage";
import { runDate, stableStringify } from "./util";

const root = join(import.meta.dirname, "..", "..");
const { values: args } = parseArgs({
  options: {
    state: { type: "string", default: "watch/state.json" },
    cache: { type: "string", default: ".watch-cache" },
    report: { type: "string", default: "watch-report.md" },
    "pr-body": { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    simulate: { type: "boolean", default: false },
    only: { type: "string" },
    "no-feeds": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const env = process.env;
const statePath = join(root, args.state!);
const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;

const { catalogue, errors } = loadCatalogue(readContentFiles());
if (errors.length) {
  console.error(`content has ${errors.length} error(s); run pnpm validate:content`);
  process.exit(1);
}

const cache = openCache(join(root, args.cache!));
const github = createGitHub({ token: env.GITHUB_TOKEN || env.GH_TOKEN || undefined });
const apiKey = env.ANTHROPIC_API_KEY || undefined;

let result;
try {
  result = await runWatch({
    catalogue,
    baseline: readState(statePath),
    cache,
    fetcher: createFetcher({
      concurrencyFor: (host) => profileFor(host).concurrency,
      delayFor: (host) => profileFor(host).delayMs ?? 0,
      retriesFor: (host) => profileFor(host).retries,
    }),
    github,
    date: runDate(),
    feeds: args["no-feeds"] ? [] : FEEDS,
    simulate: args.simulate || env.WATCH_SIMULATE === "true",
    only: args.only ? new Set(args.only.split(",").map((s) => s.trim())) : undefined,
    triage: apiKey ? (inputs) => triageChanges(inputs, { apiKey, max: Number(env.WATCH_TRIAGE_MAX) || 8, log: console.log }) : undefined,
    log: args.verbose ? console.log : undefined,
  });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const applied: UrlUpdate[] = [];
if (!args["dry-run"]) {
  const updates = Object.entries(result.urlUpdates).map(([id, url]) => ({ id, url, retrieved: result.date }));
  if (updates.length) {
    const dir = join(root, "content", "sources");
    const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [join(dir, f), readFileSync(join(dir, f), "utf8")]));
    for (const update of updates) {
      const f = result.findings.find((x) => x.kind === "moved" && x.sourceId === update.id);
      try {
        for (const [path, text] of Object.entries(applyUrlUpdates(files, [update]))) {
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

const report = renderReport(result, { runUrl });
const prBody = renderReport(result, { runUrl, maxChars: PR_BODY_LIMIT });
writeFileSync(join(root, args.report!), report);
if (args["pr-body"]) writeFileSync(join(root, args["pr-body"]), prBody);
if (args.out) {
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, "state.json"), stableStringify(result.state));
  writeFileSync(join(args.out, "url-updates.json"), stableStringify(applied));
  writeFileSync(join(args.out, "report.md"), report);
  writeFileSync(join(args.out, "pr-body.md"), prBody);
}
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report.slice(0, 1_000_000));
if (env.GITHUB_OUTPUT) {
  // Only values built from counts and dates reach step outputs; the title is checked against that shape.
  const title = prTitle(result);
  if (!/^[\w ,:()[\]-]+$/.test(title)) throw new Error(`unexpected PR title: ${title}`);
  appendFileSync(env.GITHUB_OUTPUT, `actionable=${result.actionable}\ntitle=${title}\n`);
}
cache.save();

console.log(summaryLine(result));
console.log(`report: ${relative(process.cwd(), join(root, args.report!))}${args["dry-run"] ? " (dry run: nothing written to content or state)" : ""}`);
