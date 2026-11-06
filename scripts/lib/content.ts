import { loadCatalogue } from "../../src/content/loader";
import type { Catalogue } from "../../src/content/schema";
import { readContentFiles } from "../read-content";

/** The content catalogue, or exit when it has errors: a run on broken content would report nonsense. */
export function loadContentOrExit(): Catalogue {
  const { catalogue, errors } = loadCatalogue(readContentFiles());
  if (errors.length) {
    console.error(`content has ${errors.length} error(s); run pnpm validate:content`);
    process.exit(1);
  }
  return catalogue;
}

/** Question ids citing each control of a framework (`ISM-1504` → `[GO-ID-002, ...]`). */
export function questionsCiting(catalogue: Catalogue, framework: string): Map<string, string[]> {
  const essentials = !!catalogue.frameworks.get(framework)?.essentials;
  const out = new Map<string, string[]>();
  for (const bundle of catalogue.platforms.values())
    for (const q of bundle.questions)
      for (const ref of [
        ...q.refs.filter((r) => r.framework === framework).map((r) => r.ref),
        // Essentials questions cite actions through `essentials:` tags rather than `refs:`.
        ...(essentials ? q.essentials.map((t) => t.action) : []),
      ])
        out.set(ref, [...new Set([...(out.get(ref) ?? []), q.id])]);
  return out;
}
