import { contentDigest, loadCatalogue } from "../content/loader";
import type { Catalogue } from "../content/schema";
import { readContentFiles } from "../../scripts/read-content";

export interface LoadedCatalogue {
  catalogue: Catalogue;
  contentHash: string;
  errors: string[];
  warnings: string[];
}

/** Load content YAML from disk (same path as `pnpm validate:content`). Exit 2 when `errors` is non-empty. */
export function loadCatalogueFromDisk(): LoadedCatalogue {
  const { catalogue, errors, warnings } = loadCatalogue(readContentFiles());
  return { catalogue, contentHash: contentDigest(catalogue), errors, warnings };
}

/** Question ids in this catalogue (platforms + SOC). Prefer this over `questionIdSet` in Node — that one needs Vite. */
export function questionIdsOf(catalogue: Catalogue): ReadonlySet<string> {
  return new Set([
    ...[...catalogue.platforms.values()].flatMap((b) => b.questions.map((q) => q.id)),
    ...(catalogue.soc?.questions.map((q) => q.id) ?? []),
  ]);
}

/** JSON-serialisable catalogue view for `cg catalogue`. */
export function catalogueView(catalogue: Catalogue, platform?: string) {
  const bundles = platform
    ? ([catalogue.platforms.get(platform)].filter(Boolean) as NonNullable<ReturnType<Catalogue["platforms"]["get"]>>[])
    : [...catalogue.platforms.values()];
  return bundles.map((b) => ({
    platform: { id: b.platform.id, name: b.platform.name, modules: b.platform.modules },
    licenceTiers: b.platform.licenceTiers,
    licenceFeatures: b.platform.licenceFeatures,
    domains: b.platform.domains,
    assetTypes: b.assetTypes,
    questions: b.questions,
  }));
}
