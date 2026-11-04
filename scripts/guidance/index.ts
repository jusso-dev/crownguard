/**
 * `pnpm guidance:update`: move the machine-readable guidance crownguard pins (ISM controls, Prowler and ScubaGoggles
 * check ids) to the latest upstream release, regenerating the files and moving the pins.
 *
 *     pnpm guidance:update                      # update this checkout
 *     pnpm guidance:update --dry-run            # say what would change, write nothing
 *     pnpm guidance:update --only prowler,ism   # just these (ids in scripts/guidance/registry.ts)
 *     pnpm guidance:update --out <dir>          # also write <dir>/summary.json, <dir>/pr-body.md and <dir>/files/
 *     pnpm guidance:update --previous-ref origin/bot/guidance-update   # keep that branch's dates when only dates moved
 *
 * In Actions it writes `changed=true|false`, `blocked=true|false` and `title=` to $GITHUB_OUTPUT. Any updater failing makes the run exit 1
 * after writing its report, so a network error never closes a pull request that is still needed.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCatalogue } from "../../src/content/loader";
import { readContentFiles } from "../read-content";
import { createGuidanceGitHub } from "./github";
import { UPDATERS } from "./registry";
import { renderPrBody, runUpdates } from "./run";
import type { Workspace } from "./types";

const root = join(import.meta.dirname, "..", "..");
// `pnpm guidance:update -- --dry-run` passes the `--` separator through; it isn't ours.
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    only: { type: "string" },
    "previous-ref": { type: "string" },
  },
});

const only = args.only ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean)) : undefined;
for (const id of only ?? []) {
  if (!UPDATERS.some((u) => u.id === id)) {
    console.error(`--only: no updater ${id} (have ${UPDATERS.map((u) => u.id).join(", ")})`);
    process.exit(2);
  }
}

const { catalogue, errors } = loadCatalogue(readContentFiles());
if (errors.length) {
  console.error(`content has ${errors.length} error(s); run pnpm validate:content`);
  process.exit(1);
}

const citing = (framework: string): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const bundle of catalogue.platforms.values())
    for (const q of bundle.questions)
      for (const r of q.refs) if (r.framework === framework) out.set(r.ref, [...new Set([...(out.get(r.ref) ?? []), q.id])]);
  return out;
};

const ws: Workspace = {
  read: (path) => readFileSync(join(root, path), "utf8"),
  citing,
  today: new Date().toISOString().slice(0, 10),
};

const previousRef = args["previous-ref"];
const previous = previousRef
  ? (path: string): string | undefined => {
      try {
        return execFileSync("git", ["show", `${previousRef}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        return undefined;
      }
    }
  : undefined;

const env = process.env;
const result = await runUpdates({
  updaters: UPDATERS,
  ws,
  gh: createGuidanceGitHub({ token: env.GITHUB_TOKEN || env.GH_TOKEN || undefined }),
  only,
  previous,
  log: console.log,
});

const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
const guideUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? "jusso-dev/crownguard"}/blob/main/docs/content-guide.md#guidance-update`;
const body = renderPrBody(result, { runUrl, guideUrl });

for (const u of result.updates) {
  const head = `${u.id}: ${u.status}${u.from ? ` (${u.from}${u.latest && u.status !== "current" ? ` → ${u.latest.tag}` : `, latest ${u.latest?.tag ?? "?"}`})` : ""}`;
  console.log(head);
  for (const f of u.files) console.log(`  ${args["dry-run"] ? "would write" : "wrote"} ${f}`);
  for (const r of u.review) console.log(`  review: ${r.id} ${r.reason}; used by ${r.questions.join(", ")} in ${r.file}`);
  for (const n of u.notes) console.log(`  ${n}`);
  if (u.pinsMoved === false) console.log("  pins left unchanged until the removed ids are reviewed");
  if (u.error) console.log(`  error: ${u.error}`);
}
console.log(result.changed ? `title: ${result.title}` : "nothing to change");

if (!args["dry-run"]) for (const [path, text] of Object.entries(result.files)) writeFileSync(join(root, path), text);

if (args.out) {
  // resolve(), not join(): the workflow passes an absolute path under $RUNNER_TEMP.
  const out = resolve(root, args.out);
  rmSync(join(out, "files"), { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const { files, ...summary } = result;
  writeFileSync(join(out, "summary.json"), `${JSON.stringify({ ...summary, files: Object.keys(files) }, null, 2)}\n`);
  writeFileSync(join(out, "pr-body.md"), body);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(out, "files", path)), { recursive: true });
    writeFileSync(join(out, "files", path), text);
  }
}

// Blocked: a list moved but its pins could not, so the pinned-list tests fail until a maintainer fixes the mapping.
const blocked = result.updates.some((u) => u.pinsMoved === false && u.files.length > 0);
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `changed=${result.changed}\nblocked=${blocked}\ntitle=${result.title.replace(/[\r\n]+/g, " ")}\n`);
if (result.updates.some((u) => u.status === "error")) process.exit(1);
