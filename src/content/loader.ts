import { parse } from "yaml";
import { z } from "zod";
import {
  aiQuestionSchema,
  aiRegisterModelSchema,
  knownAiAppsFileSchema,
  oauthScopesFileSchema,
  type AiQuestion,
  type AiRegisterModel,
  type KnownAiApp,
  type OAuthScope,
  socModelSchema,
  socQuestionSchema,
  assetFileSchema,
  frameworkSchema,
  importMappingSchema,
  platformSchema,
  questionFileSchema,
  sourceFileSchema,
  type Catalogue,
  type PlatformBundle,
  type SocModel,
  type SocQuestion,
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

  const socModelText = entries.find(([p]) => p === "content/soc/model.yaml")?.[1];
  if (socModelText) {
    const model = parseFile("content/soc/model.yaml", socModelText, socModelSchema, errors);
    const questions = entries
      .filter(([p]) => p.startsWith("content/soc/questions"))
      .flatMap(([p, t]) => parseFile(p, t, z.array(socQuestionSchema), errors) ?? []);
    if (model) {
      catalogue.soc = { model, questions };
      errors.push(...checkSoc(model, questions, catalogue));
    }
  }

  const aiModelText = entries.find(([p]) => p === "content/ai-register/model.yaml")?.[1];
  if (aiModelText) {
    const model = parseFile("content/ai-register/model.yaml", aiModelText, aiRegisterModelSchema, errors);
    const questions = entries
      .filter(([p]) => p.startsWith("content/ai-register/questions"))
      .flatMap(([p, t]) => parseFile(p, t, z.array(aiQuestionSchema), errors) ?? []);
    const knownAppsText = entries.find(([p]) => p === "content/ai-register/known-ai-apps.yaml")?.[1];
    const scopesText = entries.find(([p]) => p === "content/ai-register/oauth-scopes.yaml")?.[1];
    const knownApps = knownAppsText ? (parseFile("content/ai-register/known-ai-apps.yaml", knownAppsText, knownAiAppsFileSchema, errors)?.entries ?? []) : [];
    const scopes = scopesText ? (parseFile("content/ai-register/oauth-scopes.yaml", scopesText, oauthScopesFileSchema, errors)?.scopes ?? []) : [];
    if (model) {
      catalogue.aiRegister = { model, questions, knownApps, scopes };
      errors.push(...checkAiRegister(model, questions, knownApps, scopes, catalogue));
    }
  }

  errors.push(...crossCheck(catalogue));
  return { catalogue, errors };
}

/** Every source the AI register's model, questions, curated AI app list and scope table cite. */
export const aiRegisterSources = ({ model, questions, knownApps, scopes }: NonNullable<Catalogue["aiRegister"]>) => [
  ...model.sources,
  ...model.dates.map((d) => d.source),
  ...model.caveats.flatMap((c) => c.sources),
  ...model.kinds.flatMap((k) => k.sources),
  ...questions.flatMap((q) => q.sources),
  ...knownApps.map((a) => a.source),
  ...scopes.map((s) => s.source),
];

function checkAiRegister(
  model: AiRegisterModel,
  questions: AiQuestion[],
  knownApps: KnownAiApp[],
  scopes: OAuthScope[],
  catalogue: Catalogue,
): string[] {
  const errors: string[] = [];
  for (const s of new Set(aiRegisterSources({ model, questions, knownApps, scopes }))) if (!catalogue.sources.has(s)) errors.push(`ai-register: unknown source ${s}`);
  const appIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const a of knownApps) {
    const where = `ai-register: known app ${a.id}`;
    if (appIds.has(a.id)) errors.push(`${where}: duplicate app id`);
    appIds.add(a.id);
    if (!a.namePatterns.some((p) => p.trim())) errors.push(`${where}: empty name pattern`);
    for (const c of a.clientIds) {
      const key = c.trim().toLowerCase();
      if (clientIds.has(key)) errors.push(`${where}: client id ${c} listed twice`);
      clientIds.add(key);
    }
    if (!catalogue.sources.has(a.source)) errors.push(`${where}: unknown source ${a.source}`);
  }
  const scopeIds = new Set<string>();
  const scopeNames = new Set<string>();
  for (const s of scopes) {
    const where = `ai-register: scope ${s.id}`;
    if (scopeIds.has(s.id)) errors.push(`${where}: duplicate scope id`);
    scopeIds.add(s.id);
    const key = `${s.provider} ${s.scope.trim().toLowerCase()}`;
    if (scopeNames.has(key)) errors.push(`${where}: ${s.scope} listed twice for ${s.provider}`);
    scopeNames.add(key);
    if (!catalogue.sources.has(s.source)) errors.push(`${where}: unknown source ${s.source}`);
  }
  const themes = new Set(model.themes.map((t) => t.id));
  const platformIds = new Set([...catalogue.platforms.values()].flatMap((b) => b.questions.map((q) => q.id)));
  const kinds = new Set<string>();
  for (const k of model.kinds) {
    if (kinds.has(k.id)) errors.push(`ai-register: duplicate kind ${k.id}`);
    kinds.add(k.id);
    for (const q of k.relatedQuestions) if (!platformIds.has(q)) errors.push(`ai-register: kind ${k.id} has unknown related question ${q}`);
  }
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const q of questions) {
    const where = `ai-register: ${q.id}`;
    if (seen.has(q.id)) errors.push(`${where}: duplicate question id`);
    seen.add(q.id);
    if (!themes.has(q.theme)) errors.push(`${where}: unknown theme ${q.theme}`);
    covered.add(q.theme);
    for (const r of q.refs) {
      const f = catalogue.frameworks.get(r.framework);
      if (!f) errors.push(`${where}: unknown framework ${r.framework}`);
      else if (f.closed && !f.controls.some((c) => c.id === r.ref)) errors.push(`${where}: ${r.framework} has no control ${r.ref}`);
    }
  }
  for (const t of themes) if (!covered.has(t)) errors.push(`ai-register: theme ${t} has no questions`);
  return errors;
}

/** Question id prefix for each SOC domain, e.g. SOC-BUS-001 for business. */
const socPrefix: Record<string, string> = { business: "BUS", people: "PPL", process: "PRC", technology: "TEC", services: "SVC" };

function checkSoc(model: SocModel, questions: SocQuestion[], catalogue: Catalogue): string[] {
  const errors: string[] = [];
  for (const src of [model.source, model.licenceSource, ...model.sources])
    if (!catalogue.sources.has(src)) errors.push(`soc: unknown source ${src}`);
  const domainOf = new Map<string, SocModel["domains"][number]>();
  for (const d of model.domains) {
    if (!socPrefix[d.id]) errors.push(`soc: unknown domain ${d.id} (expected ${Object.keys(socPrefix).join(", ")})`);
    for (const a of d.aspects) {
      if (domainOf.has(a.id)) errors.push(`soc: duplicate aspect id ${a.id}`);
      domainOf.set(a.id, d);
    }
  }
  const platformIds = new Set([...catalogue.platforms.values()].flatMap((b) => b.questions.map((q) => q.id)));
  const seen = new Set<string>();
  const covered = { maturity: new Set<string>(), capability: new Set<string>() };
  for (const q of questions) {
    const where = `soc: ${q.id}`;
    if (seen.has(q.id) || platformIds.has(q.id)) errors.push(`${where}: duplicate question id`);
    seen.add(q.id);
    const d = domainOf.get(q.aspect);
    if (!d) {
      errors.push(`${where}: unknown aspect ${q.aspect}`);
      continue;
    }
    if (!q.id.startsWith(`SOC-${socPrefix[d.id]}-`)) errors.push(`${where}: id should start SOC-${socPrefix[d.id]}- for the ${d.name} domain`);
    if (q.kind === "capability" && !d.capability) errors.push(`${where}: capability questions belong only in capability domains`);
    covered[q.kind].add(q.aspect);
    for (const r of q.refs) {
      const f = catalogue.frameworks.get(r.framework);
      if (!f) errors.push(`${where}: unknown framework ${r.framework}`);
      else if (f.closed && !f.controls.some((c) => c.id === r.ref)) errors.push(`${where}: ${r.framework} has no control ${r.ref}`);
    }
  }
  for (const [a, d] of domainOf) {
    if (!covered.maturity.has(a)) errors.push(`soc: aspect ${a} has no maturity question`);
    if (d.capability && !covered.capability.has(a)) errors.push(`soc: aspect ${a} has no capability question`);
  }
  return errors;
}

/** URL identity for duplicate detection: case-insensitive host (and path on Microsoft sites), no trailing slash. */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : u.pathname;
    if (host === "learn.microsoft.com" || host === "www.microsoft.com") path = path.toLowerCase();
    return `${host}${path}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

function crossCheck({ sources, frameworks, platforms, soc, aiRegister }: Catalogue): string[] {
  const errors: string[] = [];
  const cited = new Set<string>();
  for (const f of frameworks.values()) {
    if (!sources.has(f.source)) errors.push(`framework ${f.id}: unknown source ${f.source}`);
    for (const s of f.sources) if (!sources.has(s)) errors.push(`framework ${f.id}: unknown source ${s}`);
    if (f.closed && f.controls.length === 0) errors.push(`framework ${f.id}: closed framework has no controls`);
    cited.add(f.source);
    for (const s of f.sources) cited.add(s);
  }
  for (const { platform, questions } of platforms.values()) {
    for (const s of platform.sources) cited.add(s);
    for (const q of questions) for (const s of q.sources) cited.add(s);
  }
  if (soc) for (const s of [soc.model.source, soc.model.licenceSource, ...soc.model.sources]) cited.add(s);
  if (aiRegister) for (const s of aiRegisterSources(aiRegister)) cited.add(s);
  const byPage = new Map<string, string>();
  for (const s of sources.values()) {
    if (!cited.has(s.id)) errors.push(`source ${s.id}: not cited by any question, framework or platform`);
    const key = pageKey(s.url);
    const twin = byPage.get(key);
    if (twin) errors.push(`source ${s.id}: same page as ${twin}`);
    else byPage.set(key, s.id);
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

/** FNV-1a over UTF-16 code units. A change detector, not a security hash. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * A digest of what the catalogue asks about: question, asset type, framework and source ids in a stable order.
 * It goes into every saved file so a later build can tell whether the questions have moved on since the assessor
 * last saved. It says "the content changed", not what changed.
 */
export function contentDigest(catalogue: Catalogue): string {
  const parts: string[] = [];
  for (const id of [...catalogue.sources.keys()].sort()) parts.push(`source:${id}`);
  for (const [id, f] of [...catalogue.frameworks].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`framework:${id}:${f.controls.map((c) => c.id).join(",")}`);
  }
  for (const [id, b] of [...catalogue.platforms].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`platform:${id}`);
    for (const a of b.assetTypes) parts.push(`asset:${a.id}`);
    for (const q of b.questions.sort((x, y) => x.id.localeCompare(y.id))) {
      parts.push(`question:${q.id}:${q.licence.join(",")}:${q.sources.join(",")}`);
    }
  }
  for (const q of (catalogue.soc?.questions ?? []).slice().sort((x, y) => x.id.localeCompare(y.id))) parts.push(`soc:${q.id}`);
  return fnv1a64(parts.join("\n"));
}
