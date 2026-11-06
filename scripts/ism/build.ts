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
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { cliArgs, isMain } from "../lib/cli";
import { generate, type OscalGenerator } from "../lib/generate";
import { parseOscal, propValues } from "../lib/oscal";
import { shorten } from "../lib/text";
import { ISM } from "../lib/upstreams";
import { fold, inlineList, quoted } from "../lib/yaml-text";
import { ISM_APPLICABILITY, ISM_E8_LEVELS, isWithdrawn, oscalCatalogFileSchema, statementOf, type OscalCatalogFile, type OscalControl } from "./oscal";

/** `ism-1504` as the ISM writes it, shown everywhere as `ISM-1504`. */
export const displayId = (oscalId: string): string => oscalId.toUpperCase();

/** One control in the generated framework file. */
interface IsmRow {
  id: string;
  group: string;
  title: string;
  updated?: string;
  applicability?: string[];
  e8?: string[];
}

interface IsmExtract {
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
    // Written into the YAML unquoted, so it must be a plain id.
    if (!/^ISM-[A-Z0-9-]+$/.test(id)) throw new Error(`${control.id} displays as an unexpected id ${JSON.stringify(id)}`);
    if (seen.has(id)) throw new Error(`two OSCAL controls display as ${id}`);
    seen.add(id);
    const statement = statementOf(control);
    if (!statement) throw new Error(`${control.id} has no statement part`);
    const row: IsmRow = {
      id,
      group: path.join(" / "),
      title: shorten(statement),
    };
    const updated = propValues(control.props, "updated")[0];
    if (updated) {
      // "Sep-26": ASD's month-year label. Anything else is a shape change worth stopping for.
      if (!UPDATED.test(updated)) throw new Error(`${control.id} has an unexpected updated value ${JSON.stringify(updated)}`);
      row.updated = updated;
    }
    const applicability = order(propValues(control.props, "applicability"), ISM_APPLICABILITY);
    if (applicability.length) row.applicability = applicability;
    const e8 = order(propValues(control.props, "essential-eight-applicability"), ISM_E8_LEVELS);
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

const UPDATED = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/;
const CATALOG_VERSION = /^\d{4}\.\d{2}(?:\.\d+)?$/;

const ismSourceId = "asd-ism";

/** The framework document (header comment, framework fields, controls) as YAML text. */
export function ismYaml(file: OscalCatalogFile, extract: IsmExtract, opts: { tag: string; retrieved: string }): string {
  const meta = file.catalog.metadata;
  // These go into the header comment: a stray newline would start YAML of its own.
  if (!CATALOG_VERSION.test(meta.version)) throw new Error(`unexpected catalog version ${JSON.stringify(meta.version)}`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(meta.published) || Number.isNaN(Date.parse(meta.published)))
    throw new Error(`unexpected catalog published date ${JSON.stringify(meta.published)}`);
  if (!/^\d+\.\d+\.\d+$/.test(meta["oscal-version"])) throw new Error(`unexpected OSCAL version ${JSON.stringify(meta["oscal-version"])}`);
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
    `# Source: https://github.com/${ISM.repo} at release tag ${opts.tag} (ISM_catalog.json, OSCAL ${meta["oscal-version"]},`,
    `# catalog version ${meta.version}, published ${meta.published.slice(0, 10)}). Retrieved ${opts.retrieved}.`,
    "# © Commonwealth of Australia 2024, licensed CC BY 4.0 (Coat of Arms and ASD logo excepted).",
    "# Control titles are the statement of each control, shortened to 140 characters (an ellipsis marks a cut); the",
    "# full statements are in the ISM. To bump the release and review the diff, see docs/content-guide.md.",
    "id: ism",
    `name: Australian Government Information Security Manual (${long} release)`,
    `shortName: ISM (${short})`,
    "publisher: Australian Signals Directorate",
    `source: ${ismSourceId}`,
    `sources: [${ISM.source!.id}]`,
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
    if (r.updated) lines.push(`    updated: ${quoted(r.updated)}`);
    if (r.applicability) lines.push(`    applicability: ${inlineList(r.applicability)}`);
    if (r.e8) lines.push(`    e8: ${inlineList(r.e8)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The pinned control id list, in the style of the Prowler and ScubaGoggles fixture lists. */
function pinnedIdsText(extract: IsmExtract, opts: { tag: string; version: string }): string {
  const header = [
    `# Control ids in the ASD ISM OSCAL catalog at release tag ${opts.tag} (catalog version ${opts.version}),`,
    `# taken from ISM_catalog.json in https://github.com/${ISM.repo}/tree/${opts.tag}.`,
    "# One id per line, in ASD's own spelling (ism-1504; content/frameworks/ism.yaml shows ISM-1504),",
    `# covering all ${extract.oscalIds.length} controls including any the generator routes to its withdrawn list.`,
    "# Regenerate together with content/frameworks/ism.yaml: `pnpm ism:build -- --tag <tag>`.",
  ];
  return `${[...header, ...[...extract.oscalIds].sort()].join("\n")}\n`;
}

function buildIsm(file: OscalCatalogFile, opts: { tag: string; retrieved: string }): { yaml: string; ids: string } {
  const extract = extractControls(file);
  return { yaml: ismYaml(file, extract, opts), ids: pinnedIdsText(extract, { tag: opts.tag, version: file.catalog.metadata.version }) };
}

const CATALOG = "ISM_catalog.json";

export const ismGenerator: OscalGenerator = {
  files: [CATALOG],
  build: (files, opts) => buildIsm(parseOscal(CATALOG, files[CATALOG], oscalCatalogFileSchema), opts),
};

async function main() {
  const { values } = parseArgs({ args: cliArgs(), options: { tag: { type: "string" }, catalog: { type: "string" }, retrieved: { type: "string" } } });
  if (!values.tag) {
    console.error("usage: pnpm ism:build -- --tag v2026.09.4 [--catalog ISM_catalog.json] [--retrieved YYYY-MM-DD]");
    process.exit(1);
  }
  const catalog = values.catalog;
  await generate(ISM, ismGenerator, { tag: values.tag, retrieved: values.retrieved, read: catalog ? () => readFileSync(catalog, "utf8") : undefined });
}

if (isMain(import.meta.url)) await main();
