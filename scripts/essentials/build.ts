/**
 * Generate `content/frameworks/asd-essentials-enterprise-it.yaml` from ASD's Essentials for enterprise IT (E4EIT)
 * OSCAL release, pinned to a release tag.
 *
 *     pnpm essentials:build -- --tag v2026.10.15
 *     pnpm essentials:build -- --tag v2026.10.15 --dir /path/to/e4eit-oscal   # from a copy on disk
 *
 * Reads three things from https://github.com/AustralianCyberSecurityCentre/e4eit-oscal at the tag: the catalog
 * (principles, actions, domains per action, Indicators of Good Practice), the mapping collection (ISM and Essential
 * Eight controls ASD lists as potential evidence) and the eight domain profiles (domain names and priority phases).
 * Like the ISM, it runs at development time only: the YAML is committed, and builds and tests stay offline. It also
 * writes `scripts/essentials/fixtures/e4eit-actions.txt`, the pinned action list `pnpm test` checks the YAML against.
 * A rerun that changes nothing but the retrieval date is a no-op.
 *
 * The output is © Commonwealth of Australia 2026, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { shorten } from "../ism/build";
import {
  catalogFileSchema,
  DOMAIN_SLUGS,
  mappingFileSchema,
  profileFileSchema,
  propValues,
  type CatalogFile,
  type DomainSlug,
  type MappingFile,
  type Part,
  type ProfileFile,
} from "./oscal";

export const REPO = "AustralianCyberSecurityCentre/e4eit-oscal";
export const CATALOG = "E4EIT_catalog.json";
export const MAPPINGS = "E4EIT_mapping-collection.json";
export const profileName = (slug: DomainSlug) => `E4EIT_${slug}-domain_profile.json`;

export interface EssentialsInputs {
  catalog: CatalogFile;
  mappings: MappingFile;
  profiles: Record<DomainSlug, ProfileFile>;
}

export interface ActionRow {
  id: string;
  principle: string;
  group: string;
  title: string;
  domains: string[];
  ism: string[];
  e8: string[];
  igp: { ne: number; pe: number; fe: number };
}

export interface DomainRow {
  id: string;
  name: string;
  type: "capability" | "technical";
  phases: number[];
}

export interface EssentialsExtract {
  version: string;
  oscalVersion: string;
  published: string;
  domains: DomainRow[];
  principles: { id: string; name: string }[];
  actions: ActionRow[];
}

/** `GOV-01 - Executive cyber security accountability` as ASD titles a principle group. */
const principleTitle = /^([A-Z]{3}-\d{2}) - (.+)$/;

const igpCounts = (parts: Part[] | undefined) => {
  const counts = { ne: 0, pe: 0, fe: 0 };
  const walk = (ps: Part[] | undefined) => {
    for (const p of ps ?? []) {
      if (p.class === "not-effective-indicator-statement") counts.ne++;
      else if (p.class === "partially-effective-indicator-statement") counts.pe++;
      else if (p.class === "fully-effective-indicator-statement") counts.fe++;
      walk(p.parts);
    }
  };
  walk(parts);
  return counts;
};

/** The ISM and Essential Eight catalogs in the mapping collection, found by the title ASD gives each resource. */
function evidenceById(mappings: MappingFile): { ism: Map<string, string[]>; e8: Map<string, string[]> } {
  const mc = mappings["mapping-collection"];
  const titleOf = new Map(mc["back-matter"].resources.map((r) => [`#${r.uuid}`, r.title ?? ""]));
  const out = { ism: new Map<string, string[]>(), e8: new Map<string, string[]>() };
  const seen = { ism: false, e8: false };
  for (const m of mc.mappings) {
    const title = titleOf.get(m["target-resource"].href) ?? "";
    const kind = /Essential Eight/i.test(title) ? "e8" : /Information Security Manual/i.test(title) ? "ism" : undefined;
    if (!kind) continue;
    seen[kind] = true;
    for (const x of m.maps)
      for (const s of x.sources)
        for (const t of x.targets) {
          const list = out[kind].get(s["id-ref"]) ?? [];
          const id = t["id-ref"].toUpperCase();
          if (!list.includes(id)) list.push(id);
          out[kind].set(s["id-ref"], list);
        }
  }
  if (!seen.ism || !seen.e8) throw new Error("mapping collection has no ISM or no Essential Eight target; check the resource titles");
  return out;
}

/** Domains with their names and phases, from the profiles, in the order the chapter lists them. */
function extractDomains(profiles: EssentialsInputs["profiles"]): DomainRow[] {
  return (Object.keys(DOMAIN_SLUGS) as DomainSlug[]).map((slug) => {
    const meta = profiles[slug].profile.metadata;
    const declared = propValues(meta.props, "domain")[0];
    if (declared !== slug) throw new Error(`${profileName(slug)} declares domain ${declared}`);
    const phases = propValues(meta.props, "domain-priority-phase").map((p) => {
      const n = Number(p.replace(/^phase-/, ""));
      if (![1, 2, 3].includes(n)) throw new Error(`${profileName(slug)}: unexpected phase ${p}`);
      return n;
    });
    if (!phases.length) throw new Error(`${profileName(slug)} has no priority phase`);
    // "Assessment evidence guide for enterprise IT - Identity services OSCAL Profile"
    const name = meta.title.match(/ - (.+?) OSCAL Profile$/)?.[1];
    if (!name) throw new Error(`${profileName(slug)}: can't read the domain name from "${meta.title}"`);
    // ASD's two capability domains are the ones that run across every phase.
    return { id: DOMAIN_SLUGS[slug], name, type: phases.length === 3 ? "capability" : "technical", phases: phases.sort() };
  });
}

export function extractEssentials(inputs: EssentialsInputs): EssentialsExtract {
  const { catalog } = inputs.catalog;
  const evidence = evidenceById(inputs.mappings);
  const principles: EssentialsExtract["principles"] = [];
  const actions: ActionRow[] = [];
  for (const fn of catalog.groups)
    for (const g of fn.groups ?? []) {
      const m = g.title.match(principleTitle);
      if (!m || g.class !== "essentials-principle") throw new Error(`unexpected principle group "${g.title}"`);
      const [, id, name] = m;
      principles.push({ id, name });
      for (const c of g.controls ?? []) {
        if (!new RegExp(`^IT\\.${id}\\.\\d+$`).test(c.id)) throw new Error(`action ${c.id} doesn't belong to ${id}`);
        const statement = c.parts?.find((p) => p.class === "essentials-action")?.prose;
        if (!statement) throw new Error(`${c.id} has no action statement`);
        const domains = propValues(c.props, "domain").map((d) => {
          const key = DOMAIN_SLUGS[d as DomainSlug];
          if (!key) throw new Error(`${c.id}: unknown domain ${d}`);
          return key;
        });
        if (!domains.length) throw new Error(`${c.id} applies to no domain`);
        actions.push({
          id: c.id,
          principle: id,
          group: `${id} ${name}`,
          title: shorten(statement.replace(/\s+/g, " ")),
          domains,
          ism: evidence.ism.get(c.id) ?? [],
          e8: evidence.e8.get(c.id) ?? [],
          igp: igpCounts(c.parts?.find((p) => p.class === "indicators-of-good-practice")?.parts),
        });
      }
    }
  return {
    version: catalog.metadata.version,
    oscalVersion: catalog.metadata["oscal-version"],
    published: catalog.metadata.published.slice(0, 10),
    domains: extractDomains(inputs.profiles),
    principles,
    actions,
  };
}

const quoted = (s: string) => JSON.stringify(s);
const list = (xs: (string | number)[]) => `[${xs.join(", ")}]`;

/** Fold a paragraph to lines of at most `width` characters for a YAML `>-` block. */
const fold = (text: string, width = 95): string[] => {
  const lines: string[] = [];
  for (const w of text.replace(/\s+/g, " ").trim().split(" ")) {
    const last = lines[lines.length - 1];
    if (last && last.length + w.length + 1 <= width) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines;
};

export const SOURCE_ID = "asd-essentials-enterprise-it";
export const SUPPORTING_SOURCES = [
  "asd-essentials-oscal",
  "asd-essentials-evidence-enterprise-it",
  "asd-essentials-assessment-process",
  "asd-essentials-transition",
  "asd-essentials-what",
  "asd-essentials-faq",
];

export function essentialsYaml(x: EssentialsExtract, opts: { tag: string; retrieved: string }): string {
  const note = [
    "ASD's Essentials for enterprise IT sets out principles (outcomes), actions (what to do) and domains (where it applies).",
    "Each action is rated per domain as not effective, partially effective or fully effective, or left not assessed;",
    "principles take the weakest rating of their actions, and priority phases set the order to work in. Phases are a",
    "sequencing aid, not a rating. crownguard's Essentials results are indicative only: they come from the questions",
    "tagged with each action, not from the Indicators of Good Practice an assessor checks, and they are never derived",
    "from Essential Eight maturity levels. Action titles are the action statements, shortened to 140 characters (an",
    "ellipsis marks a cut). `evidence` lists the ISM and Essential Eight controls ASD names as potential evidence sources;",
    "`igp` counts the Indicators of Good Practice statements per tier.",
    "© Commonwealth of Australia 2026, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted), shortened and reformatted by crownguard.",
  ].join(" ");
  const lines = [
    "# Generated by scripts/essentials/build.ts from ASD's Essentials for enterprise IT OSCAL release. Do not edit by hand.",
    `# Source: https://github.com/${REPO} at release tag ${opts.tag} (OSCAL ${x.oscalVersion}, version ${x.version},`,
    `# published ${x.published}). Retrieved ${opts.retrieved}.`,
    "# © Commonwealth of Australia 2026, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted).",
    "# To bump the release and review the diff, see docs/content-guide.md.",
    "id: asd-essentials-enterprise-it",
    "name: ASD Essentials for enterprise IT",
    `shortName: Essentials (enterprise IT)`,
    "publisher: Australian Signals Directorate",
    `source: ${SOURCE_ID}`,
    `sources: ${list(SUPPORTING_SOURCES)}`,
    "closed: true",
    "note: >-",
    ...fold(note).map((l) => `  ${l}`),
    "essentials:",
    "  chapter: enterprise-it",
    `  release: ${opts.tag}`,
    "  domains:",
    ...x.domains.map((d) => `    - { id: ${d.id}, name: ${quoted(d.name)}, type: ${d.type}, phases: ${list(d.phases)} }`),
    "  principles:",
    ...x.principles.map((p) => `    - { id: ${p.id}, name: ${quoted(p.name)} }`),
    "controls:",
  ];
  for (const a of x.actions) {
    lines.push(`  - id: ${a.id}`);
    lines.push(`    principle: ${a.principle}`);
    lines.push(`    group: ${quoted(a.group)}`);
    lines.push(`    title: ${quoted(a.title)}`);
    lines.push(`    domains: ${list(a.domains)}`);
    lines.push(`    evidence: { ism: ${list(a.ism)}, e8: ${list(a.e8)} }`);
    lines.push(`    igp: { ne: ${a.igp.ne}, pe: ${a.igp.pe}, fe: ${a.igp.fe} }`);
  }
  return `${lines.join("\n")}\n`;
}

export function pinnedActionsText(x: EssentialsExtract, tag: string): string {
  return [
    `# Action ids in ASD's Essentials for enterprise IT OSCAL catalog at release tag ${tag} (version ${x.version}),`,
    `# taken from ${CATALOG} in https://github.com/${REPO}/tree/${tag}.`,
    "# One id per line. Regenerate together with content/frameworks/asd-essentials-enterprise-it.yaml:",
    "# `pnpm essentials:build -- --tag <tag>`.",
    ...x.actions.map((a) => a.id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  ].join("\n") + "\n";
}

export const outputPath = (root: string, name: "yaml" | "ids") =>
  name === "yaml" ? join(root, "content", "frameworks", "asd-essentials-enterprise-it.yaml") : join(root, "scripts", "essentials", "fixtures", "e4eit-actions.txt");

/** Both files' text. A rerun that would change only the retrieval date keeps the date already in the file. */
export function buildEssentials(inputs: EssentialsInputs, opts: { tag: string; retrieved: string; previousYaml?: string }): { yaml: string; ids: string } {
  const x = extractEssentials(inputs);
  const produced = essentialsYaml(x, opts);
  const oldDate = opts.previousYaml?.match(/Retrieved (\d{4}-\d{2}-\d{2})\./)?.[1];
  const withOld = oldDate ? produced.replace(`Retrieved ${opts.retrieved}.`, `Retrieved ${oldDate}.`) : produced;
  return { yaml: oldDate && opts.previousYaml === withOld ? withOld : produced, ids: pinnedActionsText(x, opts.tag) };
}

/** Parse the raw JSON files, failing with the first few schema issues when ASD changes the shape. */
export function parseInputs(read: (name: string) => string): EssentialsInputs {
  const parse = <T>(name: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): T => {
    const r = schema.safeParse(JSON.parse(read(name)));
    if (!r.success) throw new Error(`${name} does not match the expected OSCAL shape:\n${r.error.issues.slice(0, 10).map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    return r.data;
  };
  return {
    catalog: parse(CATALOG, catalogFileSchema),
    mappings: parse(MAPPINGS, mappingFileSchema),
    profiles: Object.fromEntries((Object.keys(DOMAIN_SLUGS) as DomainSlug[]).map((s) => [s, parse(profileName(s), profileFileSchema)])) as EssentialsInputs["profiles"],
  };
}

async function fetchAll(tag: string): Promise<Record<string, string>> {
  const names = [CATALOG, MAPPINGS, ...(Object.keys(DOMAIN_SLUGS) as DomainSlug[]).map(profileName)];
  const out: Record<string, string> = {};
  for (const name of names) {
    const url = `https://raw.githubusercontent.com/${REPO}/${tag}/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    out[name] = await res.text();
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const { values } = parseArgs({ args: argv, options: { tag: { type: "string" }, dir: { type: "string" }, retrieved: { type: "string" } } });
  if (!values.tag) {
    console.error("usage: pnpm essentials:build -- --tag v2026.10.15 [--dir path/to/e4eit-oscal] [--retrieved YYYY-MM-DD]");
    process.exit(1);
  }
  const files = values.dir ? undefined : await fetchAll(values.tag);
  let inputs: EssentialsInputs;
  try {
    inputs = parseInputs((name) => (files ? files[name] : readFileSync(join(values.dir!, name), "utf8")));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
  const yamlPath = outputPath(root, "yaml");
  const idsPath = outputPath(root, "ids");
  const previousYaml = existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : undefined;
  const retrieved = values.retrieved ?? new Date().toISOString().slice(0, 10);
  const { yaml, ids } = buildEssentials(inputs, { tag: values.tag, retrieved, previousYaml });
  mkdirSync(join(idsPath, ".."), { recursive: true });
  writeFileSync(yamlPath, yaml);
  writeFileSync(idsPath, ids);
  console.log(`${yamlPath}: ${yaml.split("\n").filter((l) => l.startsWith("  - id: ")).length} actions`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
