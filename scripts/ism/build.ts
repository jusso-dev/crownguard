/**
 * Generate `content/frameworks/ism.yaml` from ASD's official ISM OSCAL catalog, pinned to a release tag.
 *
 *     pnpm ism:build -- --tag v2026.09.4
 *     pnpm ism:build -- --tag v2026.09.4 --catalog /path/to/ISM_catalog.json   # from a copy on disk
 *
 * The catalog is fetched at development time (or read from `--catalog`) and never at runtime: the generated YAML is
 * committed, so builds and tests stay offline. Alongside the YAML this writes `scripts/ism/fixtures/ism-controls.txt`,
 * the pinned control id list `pnpm test` checks the YAML against, in the style of the Prowler and ScubaGoggles
 * fixture lists. The run is a no-op when nothing but the retrieval date has changed.
 *
 * The output is © Commonwealth of Australia 2024, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted). Control
 * titles are the statement of each control, shortened to 140 characters; the full statements stay in the ISM.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  ISM_APPLICABILITY,
  ISM_E8_LEVELS,
  isWithdrawn,
  oscalCatalogFileSchema,
  propValues,
  statementOf,
  type OscalCatalogFile,
  type OscalControl,
} from "./oscal";

export const TITLE_MAX = 140;
export const REPO = "AustralianCyberSecurityCentre/ism-oscal";

/** `ism-1504` as the ISM writes it, shown everywhere as `ISM-1504`. */
export const displayId = (oscalId: string): string => oscalId.toUpperCase();

/**
 * A statement shortened to at most `max` characters: the first sentence with its trailing full stop dropped, and a
 * cut at a word boundary marked with an ellipsis so no one mistakes a fragment for the whole statement.
 */
export function shorten(prose: string, max = TITLE_MAX): string {
  const full = prose.trim();
  const end = full.search(/[.!?](?=\s|$)/);
  const sentence = (end === -1 ? full : full.slice(0, end + 1)).replace(/\.$/, "").trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${at > 0 ? cut.slice(0, at) : cut}…`;
}

/** One control in the generated framework file. */
export interface IsmRow {
  id: string;
  group: string;
  title: string;
  updated?: string;
  applicability?: string[];
  e8?: string[];
}

export interface IsmExtract {
  rows: IsmRow[];
  withdrawn: string[];
  /** OSCAL ids in ASD's own spelling, in catalog order; the pinned fixture sorts them. */
  oscalIds: string[];
}

const order = (values: string[], canonical: readonly string[]) =>
  [...values].sort((a, b) => canonical.indexOf(a as never) - canonical.indexOf(b as never));

/** Every control in the catalog, in document order, with its guideline / section / topic path. */
export function extractControls(file: OscalCatalogFile): IsmExtract {
  const rows: IsmRow[] = [];
  const withdrawn: string[] = [];
  const oscalIds: string[] = [];
  const seen = new Set<string>();

  const add = (control: OscalControl, path: string[]) => {
    oscalIds.push(control.id);
    const id = displayId(control.id);
    if (seen.has(id)) throw new Error(`two OSCAL controls display as ${id}`);
    seen.add(id);
    const statement = statementOf(control);
    if (!statement) throw new Error(`${control.id} has no statement part`);
    const row: IsmRow = {
      id,
      group: path.join(" / "),
      title: shorten(statement),
    };
    const updated = propValues(control, "updated")[0];
    if (updated) row.updated = updated;
    const applicability = order(propValues(control, "applicability"), ISM_APPLICABILITY);
    if (applicability.length) row.applicability = applicability;
    const e8 = order(propValues(control, "essential-eight-applicability"), ISM_E8_LEVELS);
    if (e8.length) row.e8 = e8;
    if (isWithdrawn(control)) withdrawn.push(id);
    else rows.push(row);
    for (const nested of control.controls ?? []) add(nested, path);
  };

  const walk = (groups: OscalCatalogFile["catalog"]["groups"], path: string[]) => {
    for (const g of groups) {
      for (const c of g.controls ?? []) add(c, [...path, g.title]);
      walk(g.groups ?? [], [...path, g.title]);
    }
  };
  walk(file.catalog.groups, []);
  return { rows, withdrawn, oscalIds };
}

/** The release month of a tag like `v2026.09.4`, as "Sep 2026" and "September 2026". */
export function releaseMonth(tag: string): { short: string; long: string } {
  const m = tag.match(/^v(\d{4})\.(\d{2})(?:\.\d+)?$/);
  if (!m) throw new Error(`tag ${tag} is not of the form v2026.09.4`);
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][
    Number(m[2]) - 1
  ];
  if (!long) throw new Error(`tag ${tag} has no month ${m[2]}`);
  return { short: `${long.slice(0, 3)} ${m[1]}`, long: `${long} ${m[1]}` };
}

/** Fold a paragraph to `width`-character lines for a YAML `>-` block. */
const fold = (text: string, width = 95): string[] => {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last.length + w.length + 1 <= width) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines;
};

const quoted = (s: string) => JSON.stringify(s);
const inlineList = (xs: string[]) => `[${xs.join(", ")}]`;

export const ismSourceId = "asd-ism";
export const ismOscalSourceId = "asd-ism-oscal";

/** The framework document (header comment, framework fields, controls) as YAML text. */
export function ismYaml(file: OscalCatalogFile, extract: IsmExtract, opts: { tag: string; retrieved: string }): string {
  const meta = file.catalog.metadata;
  const { short, long } = releaseMonth(opts.tag);
  const note = [
    "The Information Security Manual (ISM) is the Australian Government's cyber security guidance for agencies and the systems they hold.",
    "crownguard maps its questions to ISM controls; it does not assess every ISM control, and this is not an IRAP assessment or a statement of applicability.",
    "Alignment is indicative: it shows which ISM controls a question's subject relates to, not that the organisation meets them.",
    "Each control carries the ISM's own attributes: `updated` is the month ASD last changed it, `applicability` the security classifications it applies to",
    "(NC non-classified, OS OFFICIAL: Sensitive, P PROTECTED, S SECRET, TS TOP SECRET), and `e8` the Essential Eight maturity levels it is required at.",
    "The Essential Eight Maturity Model remains the source of truth for maturity results.",
    "Control ids are the OSCAL ids in display form (ism-1504 shown as ISM-1504), titles are the statement of each control shortened to 140 characters",
    "(an ellipsis marks a cut), and group is the guideline, section and topic the control sits under.",
    "Titles are shortened statements © Commonwealth of Australia 2024, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted), shortened and reformatted by crownguard.",
  ].join(" ");

  const lines: string[] = [
    "# Generated by scripts/ism/build.ts from ASD's ISM OSCAL catalog. Do not edit by hand.",
    `# Source: https://github.com/${REPO} at release tag ${opts.tag} (ISM_catalog.json, OSCAL ${meta["oscal-version"]},`,
    `# catalog version ${meta.version}, published ${meta.published.slice(0, 10)}). Retrieved ${opts.retrieved}.`,
    "# © Commonwealth of Australia 2024, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted).",
    "# Control titles are the statement of each control, shortened to 140 characters (an ellipsis marks a cut); the",
    "# full statements are in the ISM. To bump the release and review the diff, see docs/content-guide.md.",
    "id: ism",
    `name: Australian Government Information Security Manual (${long} release)`,
    `shortName: ISM (${short})`,
    "publisher: Australian Signals Directorate",
    `source: ${ismSourceId}`,
    `sources: [${ismOscalSourceId}]`,
    "closed: true",
    "note: >-",
    ...fold(note).map((l) => `  ${l}`),
    `withdrawn: [${extract.withdrawn.map(quoted).join(", ")}]`,
    "controls:",
  ];
  for (const r of extract.rows) {
    lines.push(`  - id: ${r.id}`);
    lines.push(`    group: ${quoted(r.group)}`);
    lines.push(`    title: ${quoted(r.title)}`);
    if (r.updated) lines.push(`    updated: ${r.updated}`);
    if (r.applicability) lines.push(`    applicability: ${inlineList(r.applicability)}`);
    if (r.e8) lines.push(`    e8: ${inlineList(r.e8)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The pinned control id list, in the style of the Prowler and ScubaGoggles fixture lists. */
export function pinnedIdsText(extract: IsmExtract, opts: { tag: string; version: string }): string {
  const header = [
    `# Control ids in the ASD ISM OSCAL catalog at release tag ${opts.tag} (catalog version ${opts.version}),`,
    `# taken from ISM_catalog.json in https://github.com/${REPO}/tree/${opts.tag}.`,
    "# One id per line, in ASD's own spelling (ism-1504; content/frameworks/ism.yaml shows ISM-1504),",
    `# covering all ${extract.oscalIds.length} controls including any the generator routes to its withdrawn list.`,
    "# Regenerate together with content/frameworks/ism.yaml: `pnpm ism:build -- --tag <tag>`.",
  ];
  return `${[...header, ...[...extract.oscalIds].sort()].join("\n")}\n`;
}

/** Where the generated files live. */
export const outputPath = (root: string, name: "ism.yaml" | "ism-controls.txt") =>
  name === "ism.yaml" ? join(root, "content", "frameworks", "ism.yaml") : join(root, "scripts", "ism", "fixtures", name);

/**
 * Build both files' text for a catalog. `retrieved` is the fetch date; when a rerun would change nothing else,
 * `keepRetrieved` keeps the date already in the file so the run stays a no-op.
 */
export function buildIsm(
  file: OscalCatalogFile,
  opts: { tag: string; retrieved: string; previousYaml?: string },
): { yaml: string; ids: string } {
  const extract = extractControls(file);
  const produced = ismYaml(file, extract, opts);
  // A rerun that changes nothing but the fetch date keeps the date already in the file, so it is a true no-op.
  const oldDate = opts.previousYaml?.match(/Retrieved (\d{4}-\d{2}-\d{2})\./)?.[1];
  const yaml = oldDate && opts.previousYaml?.includes(produced.replace(`Retrieved ${opts.retrieved}.`, `Retrieved ${oldDate}.`))
    ? produced.replace(`Retrieved ${opts.retrieved}.`, `Retrieved ${oldDate}.`)
    : produced;
  return { yaml, ids: pinnedIdsText(extract, { tag: opts.tag, version: file.catalog.metadata.version }) };
}

async function fetchCatalog(tag: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO}/${tag}/ISM_catalog.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  // `pnpm ism:build -- --tag ...` passes the `--` separator through; it isn't ours.
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const { values } = parseArgs({
    args: argv,
    options: {
      tag: { type: "string" },
      catalog: { type: "string" },
      retrieved: { type: "string" },
    },
  });
  if (!values.tag) {
    console.error("usage: pnpm ism:build -- --tag v2026.09.4 [--catalog ISM_catalog.json] [--retrieved YYYY-MM-DD]");
    process.exit(1);
  }
  const raw = values.catalog ? readFileSync(values.catalog, "utf8") : await fetchCatalog(values.tag);
  const parsed = oscalCatalogFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`ISM_catalog.json does not match the expected OSCAL shape (${parsed.error.issues.length} issue(s)):`);
    for (const i of parsed.error.issues.slice(0, 10)) console.error(`  - ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
  }
  const retrieved = values.retrieved ?? new Date().toISOString().slice(0, 10);
  const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
  const yamlPath = outputPath(root, "ism.yaml");
  const idsPath = outputPath(root, "ism-controls.txt");
  const previousYaml = existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : undefined;
  const { yaml, ids } = buildIsm(parsed.data, { tag: values.tag, retrieved, previousYaml });
  mkdirSync(join(idsPath, ".."), { recursive: true });
  writeFileSync(yamlPath, yaml);
  writeFileSync(idsPath, ids);
  const controls = yaml.split("\n").filter((l) => l.startsWith("  - id: ")).length;
  const withdrawn = yaml.match(/^withdrawn: \[(.*)\]$/m)?.[1] ?? "";
  console.log(`${yamlPath}: ${controls} controls${withdrawn ? `, withdrawn listed: ${withdrawn}` : ""}`);
  console.log(`${idsPath}: ${ids.split("\n").filter((l) => l && !l.startsWith("#")).length} pinned control ids`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
