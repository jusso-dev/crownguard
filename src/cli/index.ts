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
import {
  aboutRows,
  applyScan,
  assessmentSchema,
  buildAiRegisterReport,
  buildReport,
  buildXlsx,
  catalogueView,
  detectSchemaVersion,
  emptyAssessment,
  formatIssues,
  loadCatalogueFromDisk,
  migrate,
  parseAssessment,
  questionIdsOf,
  readScan,
  registerTable,
  renderAiRegisterToFile,
  renderReportToFile,
  resolveImporter,
  SCHEMA_VERSION,
  scoreSummary,
  scoreText,
  toCsv,
  toSaveFile,
  type Assessment,
  type ToolChoice,
} from "../lib/index";

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
  new --org "Name" --platforms microsoft,aws [--out a.crownguard.json]
  import <assessment> <scan-file> [--tool auto|m365-secure|prowler|scubagoggles] [--overwrite] [--licence]
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
  new: `cg new --org "Name" --platforms microsoft,aws [--out a.crownguard.json]
  Write an empty assessment that parseAssessment accepts.`,
  import: `cg import <assessment> <scan-file> [--tool auto|m365-secure|prowler|scubagoggles] [--overwrite] [--licence]
  Pre-fill answers from a local scan file. Writes the assessment back in place.`,
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

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw Object.assign(new Error(`cannot read ${path}: ${(e as Error).message}`), { code: EXIT.INVALID });
  }
}

function loadAssessment(path: string, questionIds?: ReadonlySet<string>): Assessment {
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

export async function run(argv: string[]): Promise<number> {
  try {
    if (!argv.length || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
      err(helpTop);
      return EXIT.OK;
    }

    const command = argv[0];
    const rest = argv.slice(1);

    if (command === "ai-register") {
      if (!rest.length || rest[0] === "--help" || rest[0] === "-h") {
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

    if (!(command in helpFor) && command !== "ai-register") {
      err(`unknown command '${command}'`);
      err(helpTop);
      return EXIT.INVALID;
    }

    if (hasHelp(rest) || (rest.length === 0 && command !== "catalogue" && command !== "new")) {
      // catalogue/new can run with only flags; others need positionals — show help when bare.
      if (hasHelp(rest) || command === "import" || command === "score" || command === "render" || command === "migrate" || command === "validate") {
        if (hasHelp(rest) || rest.length === 0) {
          err(helpFor[command]);
          return hasHelp(rest) ? EXIT.OK : EXIT.INVALID;
        }
      }
    }
    if (hasHelp(rest)) {
      err(helpFor[command]);
      return EXIT.OK;
    }

    switch (command) {
      case "catalogue":
        return cmdCatalogue(rest);
      case "new":
        return cmdNew(rest);
      case "import":
        return cmdImport(rest);
      case "score":
        return cmdScore(rest);
      case "render":
        return await cmdRender(rest);
      case "migrate":
        return cmdMigrate(rest);
      case "validate":
        return cmdValidate(rest);
      default:
        err(`unknown command '${command}'`);
        return EXIT.INVALID;
    }
  } catch (e) {
    const code = typeof e === "object" && e && "code" in e && typeof (e as { code: unknown }).code === "number" ? (e as { code: number }).code : EXIT.UNEXPECTED;
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
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    err(helpFor.catalogue);
    return EXIT.OK;
  }
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
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    err(helpFor.new);
    return EXIT.OK;
  }
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
  writeFileSync(path, toSaveFile(a, { contentHash }));
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
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    err(helpFor.import);
    return EXIT.OK;
  }
  const [assessmentPath, scanPath] = positionals;
  if (!assessmentPath || !scanPath) {
    err("usage: cg import <assessment> <scan-file> [--tool auto|m365-secure|prowler|scubagoggles] [--overwrite] [--licence]");
    return EXIT.INVALID;
  }
  const tool = (values.tool ?? "auto") as ToolChoice;
  if (!["auto", "m365-secure", "prowler", "scubagoggles"].includes(tool)) {
    err(`unknown --tool '${tool}'`);
    return EXIT.INVALID;
  }
  const { catalogue, contentHash } = catalogueOrThrow();
  const assessment = loadAssessment(assessmentPath, questionIdsOf(catalogue));
  let text: string;
  try {
    text = readFileSync(scanPath, "utf8");
  } catch (e) {
    err(`cannot read ${scanPath}: ${(e as Error).message}`);
    return EXIT.INVALID;
  }
  const importer = resolveImporter(tool, text, assessment);
  if (importer.platform && !assessment.platforms.includes(importer.platform)) {
    err(`${importer.label} targets ${importer.platform}, which is not in this assessment's platforms`);
    return EXIT.INVALID;
  }
  const scan = readScan(catalogue, importer, text);
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
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    err(helpFor.score);
    return EXIT.OK;
  }
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
  const assessment = loadAssessment(assessmentPath, questionIdsOf(catalogue));
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
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    err(helpFor.render);
    return EXIT.OK;
  }
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
  const assessment = loadAssessment(assessmentPath, questionIdsOf(catalogue));
  const dest = resolve(outPdf);
  if (kind === "ai-register") {
    if (!assessment.aiRegister?.entries.length) {
      err("assessment has no AI register entries");
      return EXIT.INVALID;
    }
    await renderAiRegisterToFile(buildAiRegisterReport(catalogue, assessment), dest);
  } else {
    await renderReportToFile(buildReport(catalogue, assessment), dest);
  }
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
  const assessment = loadAssessment(assessmentPath, questionIdsOf(catalogue));
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

function cmdMigrate(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    err(helpFor.migrate);
    return EXIT.OK;
  }
  const [assessmentPath] = positionals;
  if (!assessmentPath) {
    err("usage: cg migrate <assessment> [--out file]");
    return EXIT.INVALID;
  }
  const raw = readJson(assessmentPath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    err("not a crownguard assessment");
    return EXIT.INVALID;
  }
  const record = raw as Record<string, unknown>;
  const from = detectSchemaVersion(record);
  if (from === undefined) {
    err("unrecognised format: no schemaVersion (or version: 1)");
    return EXIT.INVALID;
  }
  if (from > SCHEMA_VERSION) {
    err(`file is schema ${from}; this build only knows schema ${SCHEMA_VERSION}`);
    return EXIT.INVALID;
  }
  const { raw: migrated } = migrate(record, from);
  // Validate the migrated shape so callers get a usable file.
  const parsed = assessmentSchema.safeParse(migrated);
  if (!parsed.success) {
    const issues = formatIssues(parsed.error.issues, Number.POSITIVE_INFINITY);
    for (const i of issues) err(i);
    out({ ok: false, issues });
    return EXIT.INVALID;
  }
  const { contentHash } = catalogueOrThrow();
  const text = toSaveFile(parsed.data, { contentHash });
  if (values.out) {
    writeFileSync(values.out, text);
    err(`Wrote ${values.out}`);
  } else {
    console.log(text);
  }
  return EXIT.OK;
}

function cmdValidate(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    err(helpFor.validate);
    return EXIT.OK;
  }
  const [assessmentPath] = positionals;
  if (!assessmentPath) {
    err("usage: cg validate <assessment>");
    return EXIT.INVALID;
  }
  const raw = readJson(assessmentPath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    err("file: not a crownguard assessment");
    out({ ok: false, issues: ["file: not a crownguard assessment"] });
    return EXIT.INVALID;
  }
  const record = raw as Record<string, unknown>;
  const from = detectSchemaVersion(record);
  if (from === undefined) {
    const issues = ["file: no schemaVersion (or version: 1)"];
    for (const i of issues) err(i);
    out({ ok: false, issues });
    return EXIT.INVALID;
  }
  const { raw: migrated } = migrate(record, from);
  const parsed = assessmentSchema.safeParse(migrated);
  if (!parsed.success) {
    const issues = formatIssues(parsed.error.issues, Number.POSITIVE_INFINITY);
    for (const i of issues) err(i);
    out({ ok: false, issues });
    return EXIT.INVALID;
  }
  out({ ok: true, schemaVersion: parsed.data.schemaVersion });
  return EXIT.OK;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await run(process.argv.slice(2));
}
