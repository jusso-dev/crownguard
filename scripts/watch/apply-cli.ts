/**
 * `pnpm watch:apply <dir>`: apply a scan's results to this checkout. The workflow's scan job (read-only token) writes
 * `<dir>/state.json` and `<dir>/url-updates.json`; the propose job (write token) runs this, so code that parses web
 * pages never runs with write access. Everything read here is validated before it touches the repo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadCatalogue } from "../../src/content/loader";
import { ISO_DATE } from "../lib/dates";
import { repoPath } from "../lib/repo";
import { readContentFiles } from "../read-content";
import { applyUrlUpdates, readSourceFiles, stateSchema, writeState } from "./apply";
import type { WatchState } from "./types";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm watch:apply <scan output dir>");
  process.exit(2);
}
const { catalogue } = loadCatalogue(readContentFiles());

const state = stateSchema.parse(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))) as WatchState;
const updates = z
  .array(
    z
      .object({
        id: z.string().refine((id) => catalogue.sources.has(id), "unknown source id"),
        url: z.url({ protocol: /^https$/ }),
        retrieved: z.string().regex(ISO_DATE),
      })
      .strict(),
  )
  .parse(JSON.parse(readFileSync(join(dir, "url-updates.json"), "utf8")));

for (const [path, text] of Object.entries(applyUrlUpdates(readSourceFiles(), updates))) writeFileSync(path, text);
writeState(repoPath("watch", "state.json"), state);
console.log(`applied ${updates.length} URL update${updates.length === 1 ? "" : "s"} and the new baseline`);
