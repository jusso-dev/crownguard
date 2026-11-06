/**
 * `pnpm guidance:apply <dir>`: copy a `pnpm guidance:update --out <dir>` run into this checkout. The workflow's
 * update job (read-only token) writes `<dir>`; the propose job (write token) runs this, so code that reads upstream
 * releases never runs with write access. Nothing outside the updaters' own paths is written.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cliArgs } from "../lib/cli";
import { repoPath } from "../lib/repo";
import { UPDATERS } from "./registry";

const dir = cliArgs()[0];
if (!dir) {
  console.error("usage: pnpm guidance:apply <guidance:update output dir>");
  process.exit(2);
}
const allowed = new Set(UPDATERS.flatMap((u) => u.paths));

const summary = z
  .object({ files: z.array(z.string().refine((p) => allowed.has(p), "not a path any updater writes")) })
  .parse(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")));

const ID_LINE = /^(#.*|[A-Za-z0-9._-]+)$/;

for (const path of summary.files) {
  const src = join(dir, "files", path);
  if (!existsSync(src)) throw new Error(`summary lists ${path} but the run did not include it`);
  const text = readFileSync(src, "utf8");
  if (path.endsWith(".txt") && !text.trimEnd().split("\n").every((l) => ID_LINE.test(l))) throw new Error(`${path} has a line that is neither a comment nor an id`);
  writeFileSync(repoPath(path), text);
  console.log(`applied ${path}`);
}

