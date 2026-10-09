import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Assessment } from "../engine/types";
import { assessmentSchema, formatIssues, SCHEMA_VERSION } from "./assessmentSchema";
import { detectSchemaVersion, migrate, migrations } from "./migrations";
import { parseAssessment } from "./parseAssessment";
import { checkedStorage, setStorageReadOnly, STORAGE_KEY, unreadableBackup, writeProgress } from "./persistence";
import { toSaveFile } from "./saveFile";
import { emptyAssessment } from "./store";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
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
    expect(raw).toEqual({ org: { name: "Old Co" }, schemaVersion: 2 });
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
    // Every answer and jewel survives the trip.
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
    for (const name of ["legacy.crownguard.json", "branded.crownguard.json", "current.crownguard.json"]) {
      const result = parseAssessment(fixture(name), { questionIds: new Set(["MS-ID-001"]) });
      expect(result.kind, name).toBe("ok");
    }
  });
});

describe("the saved file format", () => {
  it("always writes the current schema version, a link to the JSON Schema and who saved it", () => {
    const text = toSaveFile(emptyAssessment(), { contentHash: "feedface", now: new Date("2026-10-09T00:00:00.000Z") });
    const saved = JSON.parse(text) as Record<string, unknown>;
    expect(saved.$schema).toMatch(/crownguard-assessment\.v2\.json$/);
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.savedBy).toMatchObject({ app: "crownguard", contentHash: "feedface", savedAt: "2026-10-09T00:00:00.000Z" });
  });

  it("passes its own schema", () => {
    const result = assessmentSchema.safeParse(JSON.parse(toSaveFile(emptyAssessment())));
    expect(result.success).toBe(true);
  });
});

describe("progress saved in this browser", () => {
  it("validates it like an opened file, and keeps the answers it doesn't recognise", () => {
    const a: Assessment = { ...emptyAssessment(), org: { ...emptyAssessment().org, name: "Stored Co" }, answers: { "MS-ID-001": "no", GONE: "yes" } };
    checkedStorage.setItem(STORAGE_KEY, { state: { assessment: a }, version: 2 });
    const stored = checkedStorage.getItem(STORAGE_KEY);
    expect(stored?.state.assessment).toMatchObject({ org: { name: "Stored Co" } });
    expect(stored?.state.assessment?.answers).toEqual({ "MS-ID-001": "no" });
    expect(stored?.state.assessment?.orphans).toEqual({ GONE: { answer: "yes" } });
  });

  it("starts clean when the stored progress can't be read, and keeps it for download", () => {
    const unreadable = { org: "nonsense" } as unknown as Assessment;
    checkedStorage.setItem(STORAGE_KEY, { state: { assessment: unreadable }, version: 2 });
    expect(checkedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(unreadableBackup()).toContain("nonsense");
  });

  it("does the same for progress that isn't even valid JSON", () => {
    writeProgress(STORAGE_KEY, "{not json");
    expect(checkedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(unreadableBackup()).toBe("{not json");
  });

  it("writes nothing while a newer file is open read-only", () => {
    checkedStorage.setItem(STORAGE_KEY, { state: { assessment: emptyAssessment() }, version: 2 });
    setStorageReadOnly(true);
    checkedStorage.setItem(STORAGE_KEY, { state: { assessment: { ...emptyAssessment(), updatedAt: "later" } }, version: 2 });
    checkedStorage.removeItem(STORAGE_KEY);
    setStorageReadOnly(false);
    expect(checkedStorage.getItem(STORAGE_KEY)?.state.assessment?.updatedAt).not.toBe("later");
  });
});
