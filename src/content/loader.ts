import { parse } from "yaml";
import { z } from "zod";
import {
  assetFileSchema,
  frameworkSchema,
  importMappingSchema,
  platformSchema,
  questionFileSchema,
  sourceFileSchema,
  type Catalogue,
  type PlatformBundle,
} from "./schema";

/** Raw content files keyed by path relative to the repo root, e.g. `content/sources/microsoft.yaml`. */
export type ContentFiles = Record<string, string>;

export interface LoadResult {
  catalogue: Catalogue;
  errors: string[];
}

function parseFile<T>(path: string, text: string, schema: z.ZodType<T>, errors: string[]): T | undefined {
  let data: unknown;
  try {
    data = parse(text);
  } catch (e) {
    errors.push(`${path}: YAML parse error: ${(e as Error).message}`);
    return undefined;
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) errors.push(`${path}: ${issue.path.join(".")}: ${issue.message}`);
    return undefined;
  }
  return result.data;
}

const rel = (path: string) => path.slice(path.indexOf("content/"));

export function loadCatalogue(files: ContentFiles): LoadResult {
  const errors: string[] = [];
  const catalogue: Catalogue = { sources: new Map(), frameworks: new Map(), platforms: new Map(), imports: new Map() };
  const entries = Object.entries(files)
    .map(([p, t]) => [rel(p), t] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [path, text] of entries) {
    if (!path.startsWith("content/sources/")) continue;
    for (const s of parseFile(path, text, sourceFileSchema, errors) ?? []) {
      if (catalogue.sources.has(s.id)) errors.push(`${path}: duplicate source id ${s.id}`);
      catalogue.sources.set(s.id, s);
    }
  }

  for (const [path, text] of entries) {
    if (!path.startsWith("content/frameworks/")) continue;
    const f = parseFile(path, text, frameworkSchema, errors);
    if (!f) continue;
    if (catalogue.frameworks.has(f.id)) errors.push(`${path}: duplicate framework id ${f.id}`);
    catalogue.frameworks.set(f.id, f);
  }

  const platformDirs = new Set(
    entries.map(([p]) => p.match(/^content\/platforms\/([^/]+)\//)?.[1]).filter((d): d is string => !!d),
  );
  for (const dir of platformDirs) {
    const prefix = `content/platforms/${dir}/`;
    const platformText = entries.find(([p]) => p === `${prefix}platform.yaml`)?.[1];
    const assetsText = entries.find(([p]) => p === `${prefix}assets.yaml`)?.[1];
    if (!platformText || !assetsText) {
      errors.push(`${prefix}: needs platform.yaml and assets.yaml`);
      continue;
    }
    const platform = parseFile(`${prefix}platform.yaml`, platformText, platformSchema, errors);
    const assetTypes = parseFile(`${prefix}assets.yaml`, assetsText, assetFileSchema, errors);
    if (!platform || !assetTypes) continue;
    const questions = entries
      .filter(([p]) => p.startsWith(`${prefix}questions/`))
      .flatMap(([p, t]) => parseFile(p, t, questionFileSchema, errors) ?? []);
    catalogue.platforms.set(platform.id, { platform, assetTypes, questions });
  }

  for (const [path, text] of entries) {
    if (!path.startsWith("content/imports/")) continue;
    const m = parseFile(path, text, importMappingSchema, errors);
    if (!m) continue;
    const bundle = catalogue.platforms.get(m.platform);
    if (!bundle) errors.push(`${path}: unknown platform ${m.platform}`);
    const seen = new Set<string>();
    for (const row of m.mappings) {
      if (seen.has(row.question)) errors.push(`${path}: ${row.question} mapped twice`);
      seen.add(row.question);
      if (bundle && !bundle.questions.some((q) => q.id === row.question)) errors.push(`${path}: unknown question ${row.question}`);
    }
    catalogue.imports.set(m.id, m);
  }

  errors.push(...crossCheck(catalogue));
  return { catalogue, errors };
}

function crossCheck({ sources, frameworks, platforms }: Catalogue): string[] {
  const errors: string[] = [];
  for (const f of frameworks.values()) {
    if (!sources.has(f.source)) errors.push(`framework ${f.id}: unknown source ${f.source}`);
    if (f.closed && f.controls.length === 0) errors.push(`framework ${f.id}: closed framework has no controls`);
  }
  const questionIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const bundle of platforms.values()) errors.push(...checkPlatform(bundle, sources, frameworks, questionIds, assetIds));
  return errors;
}

function checkPlatform(
  { platform, assetTypes, questions }: PlatformBundle,
  sources: Catalogue["sources"],
  frameworks: Catalogue["frameworks"],
  questionIds: Set<string>,
  assetIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const at = `platform ${platform.id}`;
  const modules = new Set(platform.modules.map((m) => m.id));
  const domains = new Set(platform.domains.map((d) => d.id));
  const features = new Set(platform.licenceFeatures.map((f) => f.id));
  for (const src of platform.sources) if (!sources.has(src)) errors.push(`${at}: unknown source ${src}`);
  for (const t of platform.licenceTiers)
    for (const f of t.features) if (!features.has(f)) errors.push(`${at}: tier ${t.id} has unknown feature ${f}`);

  const localAssets = new Set<string>();
  for (const a of assetTypes) {
    if (assetIds.has(a.id)) errors.push(`${at}: duplicate asset type ${a.id}`);
    assetIds.add(a.id);
    localAssets.add(a.id);
    if (!modules.has(a.module)) errors.push(`${at}: asset ${a.id} unknown module ${a.module}`);
  }

  const covered = new Set<string>();
  for (const q of questions) {
    const where = `${at}: ${q.id}`;
    if (questionIds.has(q.id)) errors.push(`${where}: duplicate question id`);
    questionIds.add(q.id);
    if (!modules.has(q.module)) errors.push(`${where}: unknown module ${q.module}`);
    if (!domains.has(q.domain)) errors.push(`${where}: unknown domain ${q.domain}`);
    for (const a of q.appliesTo) {
      if (a === "*") localAssets.forEach((x) => covered.add(x));
      else if (!localAssets.has(a)) errors.push(`${where}: appliesTo unknown asset type ${a}`);
      else covered.add(a);
    }
    for (const l of q.licence) if (!features.has(l)) errors.push(`${where}: unknown licence feature ${l}`);
    for (const s of q.sources) if (!sources.has(s)) errors.push(`${where}: unknown source ${s}`);
    for (const r of q.refs) {
      const f = frameworks.get(r.framework);
      if (!f) errors.push(`${where}: unknown framework ${r.framework}`);
      else if (f.closed && !f.controls.some((c) => c.id === r.ref))
        errors.push(`${where}: ${r.framework} has no control ${r.ref}`);
    }
  }
  for (const a of localAssets) if (!covered.has(a)) errors.push(`${at}: asset type ${a} has no questions`);
  return errors;
}
