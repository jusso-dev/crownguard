// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exampleEntries } from "../engine/aiExamples";
import {
  buildReport,
  fixtureAssessment,
  loadCatalogueFromDisk,
  scoreSummary,
  toSaveFile,
} from "../lib/index";
import { EXIT, run } from "./index";

const dir = () => mkdtempSync(join(tmpdir(), "cg-cli-"));

let catalogue: ReturnType<typeof loadCatalogueFromDisk>["catalogue"];
let contentHash: string;

beforeAll(() => {
  const loaded = loadCatalogueFromDisk();
  expect(loaded.errors).toEqual([]);
  catalogue = loaded.catalogue;
  contentHash = loaded.contentHash;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function capture(argv: string[]) {
  const logs: string[] = [];
  const errs: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...a) => {
    errs.push(a.map(String).join(" "));
  });
  const code = await run(argv);
  log.mockRestore();
  error.mockRestore();
  return { code, stdout: logs.join("\n"), stderr: errs.join("\n") };
}

const writeAssessment = (path: string, a = fixtureAssessment(catalogue, ["microsoft"])) => {
  writeFileSync(path, toSaveFile(a, { contentHash }));
  return a;
};

describe("argument parsing / help", () => {
  it("prints top-level help", async () => {
    const r = await capture(["--help"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.stderr).toMatch(/Exit codes/);
  });

  it("rejects unknown commands", async () => {
    const r = await capture(["frobnicate"]);
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.stderr).toMatch(/unknown command/);
  });

  it("shows per-command help", async () => {
    const r = await capture(["score", "--help"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.stderr).toMatch(/cg score/);
  });
});

describe("cg catalogue", () => {
  it("writes platform JSON", async () => {
    const out = join(dir(), "cat.json");
    const r = await capture(["catalogue", "--platform", "microsoft", "--out", out]);
    expect(r.code).toBe(EXIT.OK);
    const data = JSON.parse(readFileSync(out, "utf8"));
    expect(data).toHaveLength(1);
    expect(data[0].platform.id).toBe("microsoft");
    expect(data[0].questions.length).toBeGreaterThan(10);
  });

  it("rejects unknown platform", async () => {
    const r = await capture(["catalogue", "--platform", "ibm"]);
    expect(r.code).toBe(EXIT.INVALID);
  });
});

describe("cg new", () => {
  it("writes a valid empty assessment", async () => {
    const out = join(dir(), "new.crownguard.json");
    const r = await capture(["new", "--org", "Acme", "--platforms", "microsoft,aws", "--out", out]);
    expect(r.code).toBe(EXIT.OK);
    const raw = JSON.parse(readFileSync(out, "utf8"));
    expect(raw.org.name).toBe("Acme");
    expect(raw.platforms).toEqual(["microsoft", "aws"]);
    expect(raw.schemaVersion).toBeTypeOf("number");
    const v = await capture(["validate", out]);
    expect(v.code).toBe(EXIT.OK);
  });

  it("requires --org", async () => {
    const r = await capture(["new", "--platforms", "microsoft"]);
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.stderr).toMatch(/--org/);
  });
});

describe("cg import", () => {
  it("applies an m365-secure fixture", async () => {
    const root = dir();
    const assessmentPath = join(root, "a.crownguard.json");
    // Empty answers so suggestions apply without --overwrite.
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.answers = {};
    a.notes = {};
    writeFileSync(assessmentPath, toSaveFile(a, { contentHash }));
    const scan = join(process.cwd(), "e2e/fixtures/m365-secure-scan.json");
    const r = await capture(["import", assessmentPath, scan, "--tool", "m365-secure", "--licence"]);
    expect(r.code).toBe(EXIT.OK);
    const summary = JSON.parse(r.stdout);
    expect(summary.applied).toBeGreaterThan(0);
    expect(summary.importer).toBe("m365-secure");
    const saved = JSON.parse(readFileSync(assessmentPath, "utf8"));
    expect(Object.keys(saved.answers).length).toBeGreaterThan(0);
    expect(saved.imports?.length).toBe(1);
  });

  it("fails when the scan file is missing", async () => {
    const root = dir();
    const assessmentPath = join(root, "a.crownguard.json");
    writeAssessment(assessmentPath);
    const r = await capture(["import", assessmentPath, join(root, "nope.json")]);
    expect(r.code).toBe(EXIT.INVALID);
  });
});

describe("cg score", () => {
  it("JSON matches buildReport for posture, risk bands and E8 levels", async () => {
    const root = dir();
    const path = join(root, "a.crownguard.json");
    const assessment = writeAssessment(path);
    const model = buildReport(catalogue, assessment);
    const expected = scoreSummary(model);
    const r = await capture(["score", path]);
    expect(r.code).toBe(EXIT.OK);
    const got = JSON.parse(r.stdout);
    expect(got.posture).toEqual(expected.posture);
    expect(got.risks.map((x: { band: string; score: number }) => ({ band: x.band, score: x.score }))).toEqual(
      expected.risks.map((x) => ({ band: x.band, score: x.score })),
    );
    expect(got.e8.map((x: { strategy: string; level: number | null }) => ({ strategy: x.strategy, level: x.level }))).toEqual(
      expected.e8.map((x) => ({ strategy: x.strategy, level: x.level })),
    );
  });

  it("text format is a short human summary", async () => {
    const path = join(dir(), "a.crownguard.json");
    writeAssessment(path);
    const r = await capture(["score", path, "--format", "text"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.stdout).toMatch(/Riverbend Health/);
    expect(r.stdout).toMatch(/posture/);
  });

  it("rejects a missing assessment", async () => {
    const r = await capture(["score", join(dir(), "missing.json")]);
    expect(r.code).toBe(EXIT.INVALID);
  });
});

describe("cg render", () => {
  it("PDF text contains org name and a top risk; AI register when present", async () => {
    const root = dir();
    const assessmentPath = join(root, "a.crownguard.json");
    const pdfPath = join(root, "out.pdf");
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.aiRegister = { entries: exampleEntries(a) };
    writeFileSync(assessmentPath, toSaveFile(a, { contentHash }));

    const r = await capture(["render", assessmentPath, pdfPath]);
    expect(r.code).toBe(EXIT.OK);
    expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe("%PDF-");

    const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++)
      pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
    const text = pages.join("\n").replace(/\s+/g, " ");
    expect(text).toContain("Riverbend Health");
    const top = buildReport(catalogue, a).risks[0];
    expect(text).toContain(top.jewel.name);
    expect(text).toContain("AI use-case register");
  }, 120_000);

  it("rejects unknown --kind", async () => {
    const path = join(dir(), "a.crownguard.json");
    writeAssessment(path);
    const r = await capture(["render", path, join(dir(), "x.pdf"), "--kind", "slides"]);
    expect(r.code).toBe(EXIT.INVALID);
  });
});

describe("cg ai-register export", () => {
  it("writes CSV", async () => {
    const root = dir();
    const assessmentPath = join(root, "a.crownguard.json");
    const csvPath = join(root, "reg.csv");
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.aiRegister = { entries: exampleEntries(a) };
    writeFileSync(assessmentPath, toSaveFile(a, { contentHash }));
    const r = await capture(["ai-register", "export", assessmentPath, "--format", "csv", "--out", csvPath]);
    expect(r.code).toBe(EXIT.OK);
    const csv = readFileSync(csvPath, "utf8");
    expect(csv.length).toBeGreaterThan(50);
    expect(csv).toMatch(/Use case|Name|Owner/i);
  });

  it("fails without AI entries", async () => {
    const root = dir();
    const assessmentPath = join(root, "a.crownguard.json");
    writeAssessment(assessmentPath);
    const r = await capture(["ai-register", "export", assessmentPath, "--format", "csv", "--out", join(root, "x.csv")]);
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.stderr).toMatch(/no AI register/);
  });
});

describe("cg migrate", () => {
  it("writes migrated JSON to --out without touching the input", async () => {
    const root = dir();
    const input = join(root, "old.json");
    const output = join(root, "new.json");
    // schema 1 shape: version marker only
    const legacy = {
      version: 1,
      org: { name: "Legacy Co", sector: "", size: "", jurisdiction: "Australia", regulations: [] },
      platforms: ["microsoft"],
      modules: {},
      licence: {},
      jewels: [],
      answers: {},
      notes: {},
      branding: { primary: "#1f3a5f", accent: "#d97706", marking: "OFFICIAL: Sensitive", preparedBy: "", preparedFor: "" },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    writeFileSync(input, JSON.stringify(legacy));
    const before = readFileSync(input, "utf8");
    const r = await capture(["migrate", input, "--out", output]);
    expect(r.code).toBe(EXIT.OK);
    expect(readFileSync(input, "utf8")).toBe(before);
    const migrated = JSON.parse(readFileSync(output, "utf8"));
    expect(migrated.schemaVersion).toBeGreaterThanOrEqual(2);
    expect(migrated.version).toBeUndefined();
  });

  it("refuses a newer schema", async () => {
    const root = dir();
    const input = join(root, "future.json");
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    // toSaveFile always stamps the current schemaVersion; write the raw object instead.
    writeFileSync(input, JSON.stringify({ ...a, schemaVersion: 99_999 }, null, 2));
    const r = await capture(["migrate", input, "--out", join(root, "out.json")]);
    expect(r.code).toBe(EXIT.INVALID);
    expect(r.stderr).toMatch(/schema 99999/);
  });
});

describe("cg validate", () => {
  it("accepts a valid file", async () => {
    const path = join(dir(), "ok.json");
    writeAssessment(path);
    const r = await capture(["validate", path]);
    expect(r.code).toBe(EXIT.OK);
    expect(JSON.parse(r.stdout).ok).toBe(true);
  });

  it("exits 1 and lists every issue path", async () => {
    const path = join(dir(), "bad.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 4,
        org: { name: 123, sector: "", size: "", jurisdiction: "Australia", regulations: [] },
        platforms: "microsoft",
        modules: {},
        licence: {},
        jewels: [],
        answers: { "MS-ID-001": "maybe" },
        notes: {},
        branding: { primary: "#1f3a5f", accent: "#d97706", marking: "OFFICIAL: Sensitive", preparedBy: "", preparedFor: "" },
        createdAt: "nope",
        updatedAt: "nope",
      }),
    );
    const r = await capture(["validate", path]);
    expect(r.code).toBe(EXIT.INVALID);
    const body = JSON.parse(r.stdout);
    expect(body.ok).toBe(false);
    expect(body.issues.length).toBeGreaterThan(1);
    for (const issue of body.issues as string[]) {
      expect(issue).toMatch(/:/);
      expect(r.stderr).toContain(issue);
    }
    // paths should appear
    expect(body.issues.some((i: string) => i.startsWith("org.name") || i.startsWith("platforms") || i.startsWith("answers"))).toBe(true);
  });
});

describe("temp dir hygiene", () => {
  it("creates nested dirs for render destination parent", async () => {
    const root = dir();
    mkdirSync(join(root, "nested"), { recursive: true });
    const assessmentPath = join(root, "a.crownguard.json");
    writeAssessment(assessmentPath);
    const r = await capture(["render", assessmentPath, join(root, "nested", "report.pdf")]);
    expect(r.code).toBe(EXIT.OK);
  }, 120_000);
});
