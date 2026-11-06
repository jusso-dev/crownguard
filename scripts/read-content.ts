import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ContentFiles } from "../src/content/loader";
import { repoPath, ROOT } from "./lib/repo";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".yaml") ? [join(dir, e.name)] : [],
  );
}

export function readContentFiles(): ContentFiles {
  return Object.fromEntries(walk(repoPath("content")).map((p) => [relative(ROOT, p), readFileSync(p, "utf8")]));
}
