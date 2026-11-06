/** Node only: the catalogue read straight from the content YAML, for the CLI, scripts and tests. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { contentDigest, loadCatalogue, type ContentFiles } from "./loader";
import type { Catalogue } from "./schema";

const root = join(import.meta.dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".yaml") ? [join(dir, e.name)] : [],
  );
}

/** Every content YAML file, keyed by its path from the repo root. */
export function readContentFiles(): ContentFiles {
  return Object.fromEntries(walk(join(root, "content")).map((p) => [relative(root, p), readFileSync(p, "utf8")]));
}

interface LoadedCatalogue {
  catalogue: Catalogue;
  contentHash: string;
  errors: string[];
  warnings: string[];
}

export function loadCatalogueFromDisk(): LoadedCatalogue {
  const { catalogue, errors, warnings } = loadCatalogue(readContentFiles());
  return { catalogue, contentHash: contentDigest(catalogue), errors, warnings };
}
