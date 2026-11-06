/**
 * Headless crownguard CLI: `pnpm cg <command>`.
 *
 * JSON on stdout, human messages on stderr.
 * Exit codes: 0 ok, 1 invalid input, 2 content error, 3 unexpected.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadCatalogueFromDisk } from "../content/disk";
import { answerableQuestionIds } from "../content/schema";
import { aboutRows, registerTable, toCsv } from "../engine/aiExport";
import { emptyAssessment } from "../format/empty";
import { detectSchemaVersion, migrate } from "../format/migrations";
import { parseAssessment } from "../format/parse";
import { toSaveFile } from "../format/saveFile";
import { assessmentSchema, formatIssues, SCHEMA_VERSION, type Assessment } from "../format/schema";
import { applyScan } from "../imports/apply";
import { readScan, resolveImporter, toolChoices } from "../imports";
import { buildReport } from "../report/model";
import { renderPdfToFile } from "../report/nodePdf";
import { documentFor } from "../report/render";
import { buildXlsx } from "../lib/xlsx";
import { catalogueView, scoreSummary, scoreText } from "./views";

export const EXIT = { OK: 0, INVALID: 1, CONTENT: 2, UNEXPECTED: 3 } as const;

const err = (...args: unknown[]) => console.error(...args);
const out = (value: unknown) => {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
};

const helpTop = `crownguard headless CLI — local files only, no network.

Usage:
  pnpm cg <command> [options]

Commands:
  catalogue [--platform aws|microsoft|google] [--out file.json]
  new --org "Name" --platforms microsoft,aws [--out a.crownguard.json] [--force]
  import <assessment> <scan-file> [--tool ${toolChoices.join("|")}] [--overwrite] [--licence]
  score <assessment> [--format json|text]
  render <assessment> <out.pdf> [--kind full|ai-register]
  ai-register export <assessment> --format csv|xlsx --out file
  migrate <assessment> [--out file]
  validate <assessment>

Exit codes: 0 ok, 1 invalid input, 2 content error, 3 unexpected.
JSON on stdout; human messages on stderr. See docs/cli.md.
`;

const helpFor: Record<string, string> = {
  catalogue: `cg catalogue [--platform aws|microsoft|google] [--out file.json]
  Dump questions, asset types, licence tiers and domains as JSON.`,
  new: `cg new --org "Name" --platforms microsoft,aws [--out a.crownguard.json] [--force]
  Write an empty assessment that parseAssessment accepts. Refuses to replace an existing file without --force.`,
  import: `cg import <assessment> <scan-file> [--tool ${toolChoices.join("|")}] [--overwrite] [--licence]
  Pre-fill answers from a local scan file. Writes the assessment back in place, so a file saved by a newer
  build (higher schemaVersion) is refused rather than rewritten as this build's schema.`,
  score: `cg score <assessment> [--format json|text]
  Posture, risks, domains, Essential Eight, roadmap, plus SOC/IDCF/AI when present.
  JSON is the default.`,
  render: `cg render <assessment> <out.pdf> [--kind full|ai-register]
  Render a PDF. Branding comes from the assessment file only.`,
  "ai-register": `cg ai-register export <assessment> --format csv|xlsx --out file
  Export the AI use-case register.`,
  migrate: `cg migrate <assessment> [--out file]
  Write migrated JSON to stdout (or --out). Never overwrites the input without --out.`,
  validate: `cg validate <assessment>
  List every Zod issue and path. Exit 1 on failure.`,
};

/** A local file as text, without the UTF-8 byte order mark Windows tools (PowerShell, Excel) often write. */
function readText(path: string): string {
  const text = readFileSync(path, "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readText(path));
  } catch (e) {
    throw Object.assign(new Error(`cannot read ${path}: ${(e as Error).message}`), { code: EXIT.INVALID });
  }
}

/** `writesBack`: the command saves the file in place, which would rewrite a newer file as this build's schema. */
function loadAssessment(path: string, questionIds?: ReadonlySet<string>, { writesBack = false } = {}): Assessment {
  const result = parseAssessment(readJson(path), { questionIds });
  if (result.kind === "error") {
    for (const i of result.issues) err(i);
    throw Object.assign(new Error(result.message), { code: EXIT.INVALID, issues: result.issues });
  }
  if (result.kind === "newer") {
    for (const n of result.notices) err(`${n.kind}: ${n.text}`);
    if (!result.assessment) {
      for (const i of result.issues) err(i);
      throw Object.assign(new Error(`assessment is schema ${result.schemaVersion}; this build cannot read it`), {
        code: EXIT.INVALID,
        issues: result.issues,
      });
    }
    if (writesBack)
      throw Object.assign(
        new Error(`assessment is schema ${result.schemaVersion}, newer than this build (schema ${SCHEMA_VERSION}); refusing to rewrite it. Use a newer crownguard build.`),
        { code: EXIT.INVALID },
      );
    err(`warn: file is schema ${result.schemaVersion} (newer than this build); using a best-effort parse`);
    return result.assessment;
  }
  for (const n of result.notices) err(`${n.kind}: ${n.text}`);
  return result.assessment;
}

function catalogueOrThrow() {
  const loaded = loadCatalogueFromDisk();
  if (loaded.errors.length) {
    for (const e of loaded.errors) err(e);
    throw Object.assign(new Error(`content has ${loaded.errors.length} error(s)`), { code: EXIT.CONTENT });
  }
  return loaded;
}

function hasHelp(argv: string[]) {
  return argv.includes("--help") || argv.includes("-h");
}

const commands: Record<string, ((argv: string[]) => number | Promise<number>) | undefined> = {
  catalogue: (argv) => cmdCatalogue(argv),
  new: (argv) => cmdNew(argv),
  import: (argv) => cmdImport(argv),
  score: (argv) => cmdScore(argv),
  render: (argv) => cmdRender(argv),
  migrate: (argv) => cmdMigrate(argv),
  validate: (argv) => cmdValidate(argv),
};

export async function run(argv: string[]): Promise<number> {
  try {
    if (!argv.length || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
      err(helpTop);
      return EXIT.OK;
    }

    const command = argv[0];
    const rest = argv.slice(1);

    if (command === "ai-register") {
      if (!rest.length || hasHelp(rest)) {
        err(helpFor["ai-register"]);
        return EXIT.OK;
      }
      if (rest[0] !== "export") {
        err(`unknown ai-register subcommand '${rest[0]}'`);
        err(helpFor["ai-register"]);
        return EXIT.INVALID;
      }
      return cmdAiRegisterExport(rest.slice(1));
    }

    const handler = commands[command];
    if (!handler) {
      err(`unknown command '${command}'`);
      err(helpTop);
      return EXIT.INVALID;
    }
    if (hasHelp(rest)) {
      err(helpFor[command]);
      return EXIT.OK;
    }
    // catalogue and new run on flags alone; the others need a file, so running them bare shows how to use them.
    if (rest.length === 0 && command !== "catalogue" && command !== "new") {
      err(helpFor[command]);
      return EXIT.INVALID;
    }
    return await handler(rest);
  } catch (e) {
    const raw = typeof e === "object" && e && "code" in e ? (e as { code: unknown }).code : undefined;
    // node:util parseArgs rejects unknown or malformed options with ERR_PARSE_ARGS_* codes: that's bad input.
    const code = typeof raw === "number" ? raw : typeof raw === "string" && raw.startsWith("ERR_PARSE_ARGS_") ? EXIT.INVALID : EXIT.UNEXPECTED;
    err((e as Error).message ?? String(e));
    return code === EXIT.INVALID || code === EXIT.CONTENT ? code : EXIT.UNEXPECTED;
  }
}

function cmdCatalogue(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      platform: { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: false,
  });
  const { catalogue } = catalogueOrThrow();
  if (values.platform && !catalogue.platforms.has(values.platform)) {
    err(`unknown platform '${values.platform}' (want aws|microsoft|google)`);
    return EXIT.INVALID;
  }
  const view = catalogueView(catalogue, values.platform);
  const json = JSON.stringify(view, null, 2);
  if (values.out) {
    writeFileSync(values.out, json);
    err(`Wrote ${view.reduce((n, p) => n + p.questions.length, 0)} questions to ${values.out}`);
  } else out(view);
  return EXIT.OK;
}

function cmdNew(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      org: { type: "string" },
      platforms: { type: "string" },
      out: { type: "string", default: "assessment.crownguard.json" },
      force: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (!values.org?.trim()) {
    err("missing --org");
    return EXIT.INVALID;
  }
  if (!values.platforms?.trim()) {
    err("missing --platforms (comma-separated: aws,microsoft,google)");
    return EXIT.INVALID;
  }
  const { catalogue, contentHash } = catalogueOrThrow();
  const platforms = values.platforms.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of platforms) {
    if (!catalogue.platforms.has(p)) {
      err(`unknown platform '${p}'`);
      return EXIT.INVALID;
    }
  }
  const a = emptyAssessment();
  a.org = { ...a.org, name: values.org.trim() };
  a.platforms = platforms;
  const path = values.out!;
  try {
    writeFileSync(path, toSaveFile(a, { contentHash }), { flag: values.force ? "w" : "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    err(`${path} already exists; pass --force to replace it`);
    return EXIT.INVALID;
  }
  err(`Wrote ${path}`);
  out({ out: path, schemaVersion: a.schemaVersion, org: a.org.name, platforms });
  return EXIT.OK;
}

function cmdImport(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      tool: { type: "string", default: "auto" },
      overwrite: { type: "boolean", default: false },
      licence: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [assessmentPath, scanPath] = positionals;
  if (!assessmentPath || !scanPath) {
    err(`usage: cg import <assessment> <scan-file> [--tool ${toolChoices.join("|")}] [--overwrite] [--licence]`);
    return EXIT.INVALID;
  }
  const tool = values.tool ?? "auto";
  if (!toolChoices.includes(tool)) {
    err(`unknown --tool '${tool}'`);
    return EXIT.INVALID;
  }
  const { catalogue, contentHash } = catalogueOrThrow();
  const assessment = loadAssessment(assessmentPath, new Set(answerableQuestionIds(catalogue)), { writesBack: true });
  let text: string;
  try {
    text = readText(scanPath);
  } catch (e) {
    err(`cannot read ${scanPath}: ${(e as Error).message}`);
    return EXIT.INVALID;
  }
  const importer = resolveImporter(tool, text, assessment);
  const scan = readScan(catalogue, importer, text, assessment);
  const { assessment: next, applied } = applyScan(assessment, scan, {
    platform: importer.platform,
    overwrite: !!values.overwrite,
    licence: !!values.licence,
  });
  writeFileSync(assessmentPath, toSaveFile(next, { contentHash }));
  out({
    tool: scan.tool,
    importer: importer.id,
    tenant: scan.tenant,
    mapped: scan.suggestions.length,
    applied,
    unmappedChecks: scan.unmapped,
    licence: scan.licence ?? null,
    warnings: scan.warnings ?? [],
  });
  return EXIT.OK;
}

function cmdScore(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      format: { type: "string", default: "json" },
    },
    allowPositionals: true,
  });
  const [assessmentPath] = positionals;
  if (!assessmentPath) {
    err("usage: cg score <assessment> [--format json|text]");
    return EXIT.INVALID;
  }
  const format = values.format ?? "json";
  if (format !== "json" && format !== "text") {
    err(`unknown --format '${format}'`);
    return EXIT.INVALID;
  }
  const { catalogue } = catalogueOrThrow();
  const assessment = loadAssessment(assessmentPath, new Set(answerableQuestionIds(catalogue)));
  const model = buildReport(catalogue, assessment);
  if (format === "text") out(scoreText(model));
  else out(scoreSummary(model));
  return EXIT.OK;
}

async function cmdRender(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      kind: { type: "string", default: "full" },
    },
    allowPositionals: true,
  });
  const [assessmentPath, outPdf] = positionals;
  if (!assessmentPath || !outPdf) {
    err("usage: cg render <assessment> <out.pdf> [--kind full|ai-register]");
    return EXIT.INVALID;
  }
  const kind = values.kind ?? "full";
  if (kind !== "full" && kind !== "ai-register") {
    err(`unknown --kind '${kind}'`);
    return EXIT.INVALID;
  }
  const { catalogue } = catalogueOrThrow();
  const assessment = loadAssessment(assessmentPath, new Set(answerableQuestionIds(catalogue)));
  const dest = resolve(outPdf);
  if (kind === "ai-register" && !assessment.aiRegister?.entries.length) {
    err("assessment has no AI register entries");
    return EXIT.INVALID;
  }
  await renderPdfToFile(documentFor(catalogue, kind === "full" ? "report" : "ai-register", assessment), dest);
  err(`Wrote ${dest}`);
  out({ out: dest, kind });
  return EXIT.OK;
}

function cmdAiRegisterExport(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      format: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    err(helpFor["ai-register"]);
    return EXIT.OK;
  }
  const [assessmentPath] = positionals;
  if (!assessmentPath || !values.format || !values.out) {
    err("usage: cg ai-register export <assessment> --format csv|xlsx --out file");
    return EXIT.INVALID;
  }
  if (values.format !== "csv" && values.format !== "xlsx") {
    err(`unknown --format '${values.format}'`);
    return EXIT.INVALID;
  }
  const { catalogue } = catalogueOrThrow();
  const assessment = loadAssessment(assessmentPath, new Set(answerableQuestionIds(catalogue)));
  if (!assessment.aiRegister?.entries.length) {
    err("assessment has no AI register entries");
    return EXIT.INVALID;
  }
  const table = registerTable(catalogue, assessment);
  if (values.format === "csv") {
    writeFileSync(values.out, toCsv(table));
  } else {
    const bytes = buildXlsx([
      {
        name: "Register",
        rows: [table.headers, ...table.rows],
        header: true,
        widths: table.headers.map((h) => (/Description|gaps|missing/i.test(h) ? 48 : 22)),
      },
      { name: "About", rows: aboutRows(catalogue, assessment), widths: [18, 110] },
    ]);
    writeFileSync(values.out, bytes);
  }
  err(`Wrote ${values.out}`);
  out({ out: values.out, format: values.format, rows: table.rows.length });
  return EXIT.OK;
}

/**
 * Read a file, bring it up to the current schema and check it, listing every issue on stderr and stdout. Undefined
 * when the file can't be used; the caller returns EXIT.INVALID.
 */
function readCurrent(path: string, { allowNewer }: { allowNewer: boolean }): Assessment | undefined {
  const fail = (issues: string[]) => {
    for (const i of issues) err(i);
    out({ ok: false, issues });
    return undefined;
  };
  const raw = readJson(path);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(["file: not a crownguard assessment"]);
  const from = detectSchemaVersion(raw);
  if (from === undefined) return fail(["file: no schemaVersion (or version: 1)"]);
  if (from > SCHEMA_VERSION && !allowNewer) return fail([`file: schema ${from}; this build only knows schema ${SCHEMA_VERSION}`]);
  const parsed = assessmentSchema.safeParse(migrate(raw as Record<string, unknown>, from).raw);
  if (!parsed.success) return fail(formatIssues(parsed.error.issues, Number.POSITIVE_INFINITY));
  return parsed.data;
}

function cmdMigrate(argv: string[]): number {
  const { values, positionals } = parseArgs({ args: argv, options: { out: { type: "string" } }, allowPositionals: true });
  const [assessmentPath] = positionals;
  if (!assessmentPath) {
    err("usage: cg migrate <assessment> [--out file]");
    return EXIT.INVALID;
  }
  const assessment = readCurrent(assessmentPath, { allowNewer: false });
  if (!assessment) return EXIT.INVALID;
  const text = toSaveFile(assessment, { contentHash: catalogueOrThrow().contentHash });
  if (values.out) {
    writeFileSync(values.out, text);
    err(`Wrote ${values.out}`);
  } else {
    console.log(text);
  }
  return EXIT.OK;
}

function cmdValidate(argv: string[]): number {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  const [assessmentPath] = positionals;
  if (!assessmentPath) {
    err("usage: cg validate <assessment>");
    return EXIT.INVALID;
  }
  const assessment = readCurrent(assessmentPath, { allowNewer: true });
  if (!assessment) return EXIT.INVALID;
  out({ ok: true, schemaVersion: assessment.schemaVersion });
  return EXIT.OK;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await run(process.argv.slice(2));
}
