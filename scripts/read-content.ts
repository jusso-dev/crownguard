import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ContentFiles } from "../src/content/loader";

const root = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".yaml") ? [join(dir, e.name)] : [],
  );
}

export function readContentFiles(): ContentFiles {
  return Object.fromEntries(walk(join(root, "content")).map((p) => [relative(root, p), readFileSync(p, "utf8")]));
}
