/**
 * `pnpm guidance:apply <dir>`: copy a `pnpm guidance:update --out <dir>` run into this checkout. The workflow's
 * update job (read-only token) writes `<dir>`; the propose job (write token) runs this, so code that reads upstream
 * releases never runs with write access. Nothing outside the updaters' own paths is written, and
 * scripts/watch/feeds.ts, which the tests execute, is never copied: its pins are re-applied here from validated tags.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isTag, setFeedPin } from "./pins";
import { UPDATERS } from "./registry";
import { FEEDS_FILE } from "./types";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm guidance:apply <guidance:update output dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const allowed = new Set(UPDATERS.flatMap((u) => u.paths));

const summary = z
  .object({
    files: z.array(z.string().refine((p) => allowed.has(p), "not a path any updater writes")),
    updates: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        latest: z.object({ tag: z.string().refine(isTag, "not a version tag") }).optional(),
        files: z.array(z.string()),
      }),
    ),
  })
  .parse(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")));

const ID_LINE = /^(#.*|[A-Za-z0-9._-]+)$/;

for (const path of summary.files) {
  if (path === FEEDS_FILE) continue;
  const src = join(dir, "files", path);
  if (!existsSync(src)) throw new Error(`summary lists ${path} but the run did not include it`);
  const text = readFileSync(src, "utf8");
  if (path.endsWith(".txt") && !text.trimEnd().split("\n").every((l) => ID_LINE.test(l))) throw new Error(`${path} has a line that is neither a comment nor an id`);
  writeFileSync(join(root, path), text);
  console.log(`applied ${path}`);
}

if (summary.files.includes(FEEDS_FILE)) {
  const feedsPath = join(root, FEEDS_FILE);
  let feeds = readFileSync(feedsPath, "utf8");
  for (const u of summary.updates) {
    const def = UPDATERS.find((x) => x.id === u.id);
    if (!def?.feed || !u.latest || !u.files.includes(FEEDS_FILE)) continue;
    feeds = setFeedPin(feeds, def.feed, u.latest.tag);
  }
  const proposed = readFileSync(join(dir, "files", FEEDS_FILE), "utf8");
  if (proposed !== feeds) throw new Error(`${FEEDS_FILE} from the run differs from the pins its summary moves; refusing it`);
  writeFileSync(feedsPath, feeds);
  console.log(`applied ${FEEDS_FILE}`);
}
