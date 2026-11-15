import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessmentSchema, formatIssues, SCHEMA_VERSION, type Assessment } from "./schema";
import { detectSchemaVersion, migrate, migrations } from "./migrations";
import { parseAssessment } from "./parse";
import { SCHEMA_URL, toSaveFile } from "./saveFile";
import { emptyAssessment } from "./empty";

const fixtureText = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");
const fixture = (name: string) => JSON.parse(fixtureText(name)) as Record<string, unknown>;
const questionIds = new Set(["MS-ID-001", "MS-ID-002"]);

describe("schema versions", () => {
  it("recognises the version a file claims, and refuses anything that isn't one", () => {
    expect(detectSchemaVersion({ version: 1 })).toBe(1);
    expect(detectSchemaVersion({ schemaVersion: 2 })).toBe(2);
    expect(detectSchemaVersion({ schemaVersion: 99 })).toBe(99);
    expect(detectSchemaVersion({ schemaVersion: 2, version: 1 })).toBe(2);
    expect(detectSchemaVersion({})).toBeUndefined();
    expect(detectSchemaVersion({ version: 2 })).toBeUndefined();
    expect(detectSchemaVersion("nope")).toBeUndefined();
  });

  it("brings a version 1 file up to the current schema and drops the old marker", () => {
    const { raw, from, migrated } = migrate({ version: 1, org: { name: "Old Co" } }, 1);
    expect(from).toBe(1);
    expect(migrated).toBe(true);
    expect(raw).toHaveProperty("schemaVersion", SCHEMA_VERSION);
    expect(raw).toEqual({ org: { name: "Old Co" }, schemaVersion: SCHEMA_VERSION });
  });

  it("does not touch a file that is already current", () => {
    const raw = { schemaVersion: SCHEMA_VERSION, org: { name: "Now Co" } };
    expect(migrate(raw, SCHEMA_VERSION).raw).toEqual(raw);
  });

  it("will not rewrite a file from a newer crownguard", () => {
    const raw = { schemaVersion: 99, org: { name: "Future Co" } };
    expect(migrate(raw, 99)).toEqual({ raw, from: 99, migrated: false });
  });

  it("migrates one step at a time", () => {
    expect(migrations.map((m) => [m.from, m.to])).toEqual(migrations.map((m) => [m.from, m.from + 1]));
    expect(migrations[0].from).toBe(1);
    expect(migrations.at(-1)?.to).toBe(SCHEMA_VERSION);
  });
});

describe("schema 5: the usage patterns DTA's AI policy v2.1 added", () => {
  const registerEntry = (usagePatterns: string[]) => ({
    id: "uc-1",
    kind: "other",
    name: "Code assistant",
    reference: "AI-1",
    description: "Helps developers write and review code.",
    product: "",
    technology: ["generative-ai"],
    domains: ["corporate"],
    usagePatterns,
    ownerName: "Jo",
    ownerEmail: "jo@example.com",
    criteria: ["none"],
    data: [],
    jewels: [],
    answers: {},
    notes: {},
  });
  const withRegister = (schemaVersion: number, usagePatterns: string[]) => ({
    ...emptyAssessment(),
    schemaVersion,
    aiRegister: { entries: [registerEntry(usagePatterns)] },
  });

  it("opens a schema 4 file, brings it up to the current version and keeps its patterns", () => {
    const result = parseAssessment(withRegister(4, ["workplace-productivity", "analytics"]));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.assessment.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.assessment.aiRegister?.entries[0].usagePatterns).toEqual(["workplace-productivity", "analytics"]);
    expect(result.notices.some((n) => n.text.includes("older 4 format"))).toBe(true);
  });

  it("round-trips a schema 5 file that uses the new patterns", () => {
    const patterns = ["coding", "strategic-support", "workflow-automation"];
    const opened = parseAssessment(withRegister(5, patterns));
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;
    expect(opened.notices).toEqual([
      { kind: "info", text: `Opened a file saved in the older 5 format and brought it up to schema ${SCHEMA_VERSION}.` },
    ]);

    const saved = JSON.parse(toSaveFile(opened.assessment)) as Assessment;
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.$schema).toBe(SCHEMA_URL);
    const reopened = parseAssessment(saved);
    expect(reopened.kind).toBe("ok");
    if (reopened.kind !== "ok") return;
    expect(reopened.assessment.aiRegister?.entries[0].usagePatterns).toEqual(patterns);
  });

  it("opens a schema 5 file holding an 83 character check id, which an earlier build wrote but could not reopen", () => {
    const id = "cloudwatch_log_metric_filter_and_alarm_for_cloudtrail_configuration_changes_enabled";
    const check = (checkId: string) => ({ id: checkId, status: "pass", setting: "s", current: "", expected: "" });
    const withCheck = (checkId: string) => ({
      ...emptyAssessment(),
      schemaVersion: 5,
      evidence: { "AWS-LOG-006": { source: "Prowler (AWS)", tenant: "Example", scannedAt: "2026-10-08T22:00:00Z", checks: [check(checkId)] } },
    });
    const opened = parseAssessment(withCheck(id));
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;
    expect(opened.assessment.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened.assessment.evidence?.["AWS-LOG-006"]?.checks[0].id).toBe(id);

    const refused = parseAssessment(withCheck("x".repeat(201)));
    expect(refused.kind).toBe("error");
    if (refused.kind !== "error") return;
    expect(refused.issues.some((i) => /checks\.0\.id\b/.test(i.split(":")[0]))).toBe(true);
  });

  it("opens a file with a pattern this build doesn't know read-only, the way a schema 4 build sees `coding`", () => {
    // A schema 4 build reading a schema 5 file takes the newer-file path: never migrated, never offered for editing.
    // Here the file is one version ahead of this build, with a pattern this build has never heard of.
    const result = parseAssessment(withRegister(SCHEMA_VERSION + 1, ["coding", "some-later-pattern"]));
    expect(result.kind).toBe("newer");
    if (result.kind !== "newer") return;
    expect(result.schemaVersion).toBe(SCHEMA_VERSION + 1);
    expect(result.assessment).toBeUndefined();
    expect(result.issues[0]).toMatch(/^aiRegister\.entries\.0\.usagePatterns\.1: /);
    expect(migrate(withRegister(SCHEMA_VERSION + 1, ["coding"]), SCHEMA_VERSION + 1).migrated).toBe(false);
  });
});

describe("opening a file", () => {
  it("round-trips a version 1 file through a save without losing anything", () => {
    const legacy = fixture("legacy.crownguard.json");
    const opened = parseAssessment(legacy);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const saved = JSON.parse(toSaveFile(opened.assessment, { contentHash: "abc", now: new Date("2026-10-09T00:00:00.000Z") })) as Assessment;
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.version).toBeUndefined();
    expect(saved.savedBy).toEqual({ app: "crownguard", appVersion: expect.any(String), contentHash: "abc", savedAt: "2026-10-09T00:00:00.000Z" });
    expect(saved.answers).toEqual(opened.assessment.answers);
    expect(saved.jewels).toEqual(opened.assessment.jewels);
    expect(saved.org.name).toBe("Legacy Health");

    const reopened = parseAssessment(saved);
    expect(reopened.kind).toBe("ok");
    if (reopened.kind !== "ok") return;
    // All data intact, not just the fields this build knows about.
    expect(reopened.assessment.org).toEqual(opened.assessment.org);
    expect(reopened.assessment.jewels).toEqual(opened.assessment.jewels);
    expect(reopened.assessment.answers).toEqual(opened.assessment.answers);
    expect(reopened.assessment.notes).toEqual(opened.assessment.notes);
    expect(reopened.assessment.branding).toEqual(opened.assessment.branding);
    expect(reopened.notices).toEqual([]);
  });

  it("warns about a file from a newer crownguard instead of opening it for editing", () => {
    const result = parseAssessment({ ...emptyAssessment(), schemaVersion: 99 });
    expect(result.kind).toBe("newer");
    if (result.kind !== "newer") return;
    expect(result.schemaVersion).toBe(99);
    // It is still legible enough to show, so the user can look before reloading.
    expect(result.assessment?.org.name).toBe("");
  });

  it("refuses a file that is newer and unreadable, rather than guessing", () => {
    const result = parseAssessment({ schemaVersion: 99, org: "not an org" });
    expect(result.kind).toBe("newer");
    if (result.kind !== "newer") return;
    expect(result.assessment).toBeUndefined();
    expect(result.issues[0]).toMatch(/^org:/);
  });

  it("keeps fields it doesn't understand instead of stripping them", () => {
    const result = parseAssessment({ ...emptyAssessment(), somethingNew: { nested: true }, futureFeature: [] });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.assessment).toHaveProperty("somethingNew");
    expect(result.notices.some((n) => n.text.includes("somethingNew"))).toBe(true);

    // And they survive the next save, so nothing is lost by opening the file in an older build.
    const saved = JSON.parse(toSaveFile(result.assessment)) as Record<string, unknown>;
    expect(saved.somethingNew).toEqual({ nested: true });
    expect(saved.futureFeature).toEqual([]);
  });

  it("lists answers for questions this build no longer asks, and keeps them", () => {
    const result = parseAssessment(
      { ...emptyAssessment(), answers: { "MS-ID-001": "yes", "OLD-QUESTION": "no" }, notes: { "OLD-QUESTION": "was here" } },
      { questionIds },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.assessment.answers).toEqual({ "MS-ID-001": "yes" });
    expect(result.assessment.orphans).toEqual({ "OLD-QUESTION": { answer: "no", note: "was here" } });
    expect(result.notices.some((n) => n.text.includes("OLD-QUESTION"))).toBe(true);
  });

  it("keeps an AWS-NET-008 answer when the file is opened after the question was narrowed", () => {
    const ids = new Set(["AWS-NET-008", "AWS-AI-001", "MS-ID-001"]);
    const result = parseAssessment(
      {
        ...emptyAssessment(),
        platforms: ["aws"],
        answers: { "AWS-NET-008": "partial", "MS-ID-001": "yes" },
        notes: { "AWS-NET-008": "Notebooks in VPC; agents reviewed separately." },
      },
      { questionIds: ids },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.assessment.answers["AWS-NET-008"]).toBe("partial");
    expect(result.assessment.notes["AWS-NET-008"]).toBe("Notebooks in VPC; agents reviewed separately.");
    expect(result.assessment.orphans ?? {}).toEqual({});
  });

  it("reports every problem with its path, and no more than five of them", () => {
    const result = parseAssessment({
      ...emptyAssessment(),
      org: { name: 4, sector: "", size: "", jurisdiction: "", regulations: [] },
      createdAt: 5,
      updatedAt: 6,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.issues).toHaveLength(3);
    expect(result.issues[0]).toMatch(/^org\.name: /);
    for (const line of result.issues) expect(line).toMatch(/^(file|[\w.[\]-]+): /);
    expect(formatIssues(Array.from({ length: 9 }, (_, i) => ({ path: [`a${i}`], message: "bad" })))).toHaveLength(5);
  });

  it("names the file-level problem when there is no path to give", () => {
    const issues = formatIssues([{ path: [], message: "unrecognised format" }]);
    expect(issues).toEqual(["file: unrecognised format"]);
  });

  it("rejects something that isn't an assessment at all", () => {
    expect(parseAssessment(null).kind).toBe("error");
    expect(parseAssessment([1, 2, 3]).kind).toBe("error");
    expect(parseAssessment({ hello: "world" }).kind).toBe("error");
  });

  it("opens the committed fixtures from every past shape", () => {
    for (const name of ["legacy.crownguard.json", "branded.crownguard.json", "schema3.crownguard.json", "schema4.crownguard.json", "schema5.crownguard.json"]) {
      const result = parseAssessment(fixture(name), { questionIds: new Set(["MS-ID-001"]) });
      expect(result.kind, name).toBe("ok");
    }
  });
});

describe("the saved file format", () => {
  it("always writes the current schema version, a link to the JSON Schema and who saved it", () => {
    const text = toSaveFile(emptyAssessment(), { contentHash: "feedface", now: new Date("2026-10-09T00:00:00.000Z") });
    const saved = JSON.parse(text) as Record<string, unknown>;
    expect(saved.$schema).toMatch(/crownguard-assessment\.v\d+\.json$/);
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.savedBy).toMatchObject({ app: "crownguard", contentHash: "feedface", savedAt: "2026-10-09T00:00:00.000Z" });
  });

  it("only takes a logo the PDF can draw", () => {
    const withLogo = (logoDataUrl: string) => ({ ...emptyAssessment(), branding: { ...emptyAssessment().branding, logoDataUrl } });
    expect(assessmentSchema.safeParse(withLogo("data:image/png;base64,iVBORw0KGgo=")).success).toBe(true);
    expect(assessmentSchema.safeParse(withLogo("data:image/jpeg;base64,/9j/4AAQ")).success).toBe(true);
    expect(assessmentSchema.safeParse(withLogo("data:image/webp;base64,UklGRg==")).success).toBe(false);
  });

  it("doesn't claim to keep __proto__, which validation drops, but reports the prototype names it keeps", () => {
    const file = JSON.parse(toSaveFile(emptyAssessment())) as Record<string, unknown>;
    const hostile = JSON.parse(`{"__proto__": {"polluted": true}, "constructor": 1, "prototype": 2, "extra": 3, ${JSON.stringify(file).slice(1)}`) as unknown;
    const opened = parseAssessment(hostile);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;
    const kept = opened.notices.find((n) => n.text.startsWith("Kept"));
    expect(kept?.text).toContain("Kept 3 fields");
    expect(kept?.text).toContain("constructor, prototype, extra");
    expect(kept?.text).not.toContain("__proto__");
    expect(Object.hasOwn(opened.assessment, "constructor")).toBe(true);
    expect(Object.hasOwn(opened.assessment, "__proto__")).toBe(false);
  });

  it("doesn't mistake an inherited property for a note when moving an orphaned answer", () => {
    const a = { ...emptyAssessment(), answers: { toString: "yes" as const } };
    const opened = parseAssessment(JSON.parse(toSaveFile(a)), { questionIds });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;
    expect(opened.assessment.orphans).toEqual({ toString: { answer: "yes" } });
  });

  it("passes its own schema", () => {
    const result = assessmentSchema.safeParse(JSON.parse(toSaveFile(emptyAssessment())));
    expect(result.success).toBe(true);
  });
});

/**
 * Frozen files, one per schema version, as a build of that era wrote them. They are never regenerated: a change that
 * makes one of these tests fail has broken reading of files people already hold, so fix the reader, not the fixture.
 * Provenance: schema3 is the web-app save committed with schema 3 (formerly `current.crownguard.json`); schema4 and
 * schema5 are synthetic, hand-written against the schemas at 2d9ca88 (schema 4) and 0e5fdf0 (schema 5), with one
 * unknown field in every loose object. The schema 4 build at 2d9ca88 opens schema4 unchanged and refuses to edit schema5.
 */
describe("frozen files from schema 3, 4 and 5", () => {
  const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const userData = (file: Record<string, unknown>) => Object.fromEntries(Object.entries(file).filter(([k]) => k !== "$schema" && k !== "savedBy"));

  it("are byte-for-byte the files that were committed", () => {
    expect(sha256(fixtureText("schema3.crownguard.json"))).toBe("cc0c6da86c5503c1a8b6e8ca774e34e635faa8f9b31ed6168bdeefd4bdc493f4");
    expect(sha256(fixtureText("schema4.crownguard.json"))).toBe("65600f658919fb92bfba6e04b910451442a5bca318f168996dd0b2d40c9d4651");
    expect(sha256(fixtureText("schema5.crownguard.json"))).toBe("e81355a4d79c5c0f4bb64ab6fdbd2123453e888bd0dcfd946c6cf87b3ee109d5");
  });

  it("opens the schema 4 file with its register metadata, parts and every unknown field intact", () => {
    const raw = fixture("schema4.crownguard.json");
    expect(raw.schemaVersion).toBe(4);
    const result = parseAssessment(raw, { questionIds });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Nothing is added, dropped or reshaped on the way in: only the version moves.
    expect(plain(result.assessment)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    expect(result.notices).toEqual([
      { kind: "info", text: `Opened a file saved in the older 4 format and brought it up to schema ${SCHEMA_VERSION}.` },
      { kind: "warn", text: "Kept 1 field this version doesn't understand: fixtureTopLevelExtra. Save the file only if you mean to keep them." },
    ]);

    const register = plain(result.assessment.aiRegister);
    expect(register.createdAt).toBe("2026-10-20");
    expect(register.lastSharedWithDta).toBe("2026-11-01");
    expect(register.dateConfirmation).toEqual({ by: "Alex Example, Chief Information Officer", on: "2026-11-02", fixtureConfirmationExtra: "kept" });
    expect(register.fixtureRegisterExtra).toEqual(["kept"]);
    const entries = result.assessment.aiRegister!.entries;
    expect(entries.map((e) => e.groupOf)).toEqual(["Microsoft 365 Copilot", undefined]);
    expect(entries.map((e) => e.foundBy)).toEqual([undefined, "Consent import"]);
    expect(entries.map((e) => e.usagePatterns)).toEqual([["workplace-productivity", "analytics"], ["decision-making", "image-processing"]]);
    expect(plain(entries[0]).fixtureEntryExtra).toBe("kept");
    expect(result.assessment.orphans).toEqual({
      "MS-OLD-014": { answer: "no", note: "Question retired in the September content update.", fixtureOrphanExtra: "kept" },
    });
    expect(plain(result.assessment.soc).fixtureSocExtra).toEqual({ kept: true });
    expect(plain(result.assessment).fixtureTopLevelExtra).toEqual({ kept: true, list: [1, 2, 3] });
    // An evidence check id at schema 4's 80 character limit, and the schema 3 provenance fields, survive.
    const evidence = result.assessment.evidence!["MS-ID-001"];
    expect(evidence.checks[1].id).toBe("fixture_check_id_exactly_eighty_characters_long_0123456789_0123456789_0123456789");
    expect(evidence.checks[1].id).toHaveLength(80);
    expect(evidence).toMatchObject({ tool: "m365-secure", toolVersion: "2.4.1", account: "scanner@schemafour.example" });
    expect(result.assessment.progress).toEqual({ step: 3, section: "microsoft:identity", socSection: "people", aiSection: "register", layout: 2 });
  });

  it("opens the schema 5 file with the v2.1 usage patterns and reports migration and the unknown field", () => {
    const raw = fixture("schema5.crownguard.json");
    expect(raw.schemaVersion).toBe(5);
    const result = parseAssessment(raw, { questionIds });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(plain(result.assessment)).toEqual({ ...raw, schemaVersion: SCHEMA_VERSION });
    expect(result.notices).toEqual([
      { kind: "info", text: `Opened a file saved in the older 5 format and brought it up to schema ${SCHEMA_VERSION}.` },
      { kind: "warn", text: "Kept 1 field this version doesn't understand: fixtureTopLevelExtra. Save the file only if you mean to keep them." },
    ]);
    const entries = result.assessment.aiRegister!.entries;
    expect(entries.map((e) => e.usagePatterns)).toEqual([["workplace-productivity", "strategic-support", "workflow-automation"], ["coding"]]);
    expect(entries.map((e) => e.groupOf)).toEqual(["Microsoft 365 Copilot", undefined]);
    expect(result.assessment.aiRegister).toMatchObject({ createdAt: "2026-10-20", lastSharedWithDta: "2026-11-01" });
  });

  it.each(["schema4.crownguard.json", "schema5.crownguard.json"])("carries everything in %s through a save and a reopen", (name) => {
    const raw = fixture(name);
    const opened = parseAssessment(raw, { questionIds });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const saved = JSON.parse(toSaveFile(opened.assessment, { now: new Date("2026-11-15T00:00:00.000Z") })) as Record<string, unknown>;
    // `$schema` and `savedBy` are the writer's to set; everything else is the user's and must come back untouched.
    expect(userData(saved)).toEqual({ ...userData(raw), schemaVersion: SCHEMA_VERSION });
    expect(saved.savedBy).toMatchObject({ app: "crownguard", contentHash: (raw.savedBy as { contentHash: string }).contentHash, savedAt: "2026-11-15T00:00:00.000Z" });

    const reopened = parseAssessment(saved, { questionIds });
    expect(reopened.kind).toBe("ok");
    if (reopened.kind !== "ok") return;
    expect(plain(reopened.assessment)).toEqual(saved);
  });

  it.each(["schema3.crownguard.json", "schema4.crownguard.json"])("links the current JSON Schema when %s is saved again", (name) => {
    const raw = fixture(name);
    const opened = parseAssessment(raw, { questionIds });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const saved = JSON.parse(toSaveFile(opened.assessment)) as Record<string, unknown>;
    expect(saved.$schema).toBe(SCHEMA_URL);
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    // The writer leaves the opened assessment alone.
    expect(plain(opened.assessment).$schema).toBe(raw.$schema);
    expect(parseAssessment(saved, { questionIds }).kind).toBe("ok");
  });

  it("moves an answer this build no longer asks beside the orphan the schema 5 file already carried", () => {
    const result = parseAssessment(fixture("schema5.crownguard.json"), { questionIds: new Set(["MS-ID-001"]) });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.assessment.answers).toEqual({ "MS-ID-001": "yes" });
    expect(result.assessment.notes).toEqual({});
    expect(result.assessment.orphans).toEqual({
      "MS-OLD-014": { answer: "no", note: "Question retired in the September content update.", fixtureOrphanExtra: "kept" },
      "MS-ID-002": { answer: "partial", note: "Rolled out to admins first." },
    });
  });
});
