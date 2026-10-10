/**
 * Browser catalogue: shared JSON is eager; platform questions and full frameworks load on demand.
 * Content is validated at build time by the Vite plugin — no yaml / Zod content parse here.
 */
import shared from "virtual:crownguard-content/shared";
import type { PlatformContentJson, ReportContentJson, SharedContentJson } from "../../scripts/vite-content";
import type { Catalogue, Framework, PlatformBundle } from "./schema";

function hydrateShared(data: SharedContentJson): Catalogue {
  return {
    sources: new Map(Object.entries(data.sources)),
    frameworks: new Map(Object.entries(data.frameworks)),
    platforms: new Map(
      Object.entries(data.platforms).map(([id, { platform }]) => [id, { platform, assetTypes: [], questions: [] }]),
    ),
    imports: new Map(Object.entries(data.imports)),
    soc: data.soc,
    aiRegister: data.aiRegister,
  };
}

export const catalogue: Catalogue = hydrateShared(shared as SharedContentJson);

/** Digest of the questions and frameworks in this build, stamped into saved files. */
export const contentHash = (shared as SharedContentJson).hash;

/** Every question id this build knows about (all platforms + SOC), without loading platform chunks. */
export const allQuestionIds: ReadonlySet<string> = new Set((shared as SharedContentJson).questionIds);

export const platformIds: readonly string[] = (shared as SharedContentJson).platformIds;

const loadedPlatforms = new Set<string>();
const platformInflight = new Map<string, Promise<void>>();
let reportLoaded = false;
let reportInflight: Promise<void> | undefined;

const platformLoaders: Record<string, () => Promise<{ default: PlatformContentJson }>> = {
  microsoft: () => import("virtual:crownguard-content/platform/microsoft"),
  google: () => import("virtual:crownguard-content/platform/google"),
  aws: () => import("virtual:crownguard-content/platform/aws"),
};

function mergeFrameworks(extra: Record<string, Framework>) {
  for (const [id, f] of Object.entries(extra)) catalogue.frameworks.set(id, f);
}

async function loadPlatform(id: string): Promise<void> {
  if (loadedPlatforms.has(id)) return;
  const existing = platformInflight.get(id);
  if (existing) return existing;

  const loader = platformLoaders[id];
  if (!loader) throw new Error(`Unknown platform: ${id}`);

  const work = (async () => {
    const { default: chunk } = await loader();
    const bundle = catalogue.platforms.get(id);
    if (!bundle) throw new Error(`Platform ${id} missing from shared catalogue`);
    const next: PlatformBundle = {
      platform: bundle.platform,
      assetTypes: chunk.assetTypes,
      questions: chunk.questions,
    };
    catalogue.platforms.set(id, next);
    loadedPlatforms.add(id);
  })();

  platformInflight.set(id, work);
  try {
    await work;
  } finally {
    platformInflight.delete(id);
  }
}

/** Load question/asset data for the given platforms (idempotent). */
export async function ensurePlatforms(ids: readonly string[]): Promise<void> {
  const needed = [...new Set(ids)].filter((id) => catalogue.platforms.has(id));
  await Promise.all(needed.map(loadPlatform));
}

/** Load full frameworks (ISM etc.) used by the report and ISM baseline annotation. */
export async function ensureReportContent(): Promise<void> {
  if (reportLoaded) return;
  if (reportInflight) return reportInflight;
  reportInflight = (async () => {
    const { default: chunk } = (await import("virtual:crownguard-content/report")) as {
      default: ReportContentJson;
    };
    mergeFrameworks(chunk.frameworks);
    reportLoaded = true;
  })();
  try {
    await reportInflight;
  } finally {
    reportInflight = undefined;
  }
}

/** Load every platform + report frameworks. Used by Vitest setup. */
export async function ensureAllContent(): Promise<void> {
  await Promise.all([ensurePlatforms(platformIds), ensureReportContent()]);
}

export function platformContentLoaded(id: string): boolean {
  return loadedPlatforms.has(id);
}

export function reportContentLoaded(): boolean {
  return reportLoaded;
}
