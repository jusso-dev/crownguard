import { readdirSync, readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/wizard/assessmentSchema";
import { detectSchemaVersion, migrate } from "../src/wizard/migrations";
import { toSaveFile } from "../src/wizard/saveFile";
import { emptyAssessment } from "../src/wizard/store";
import { SCHEMA_PATH, schemaDocument, schemaText } from "./gen-schema";

const validate = () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schemaDocument());
};

/** The fixture files the e2e suite opens, in whatever shape their era saved them. */
const fixtures = readdirSync(new URL("../e2e/fixtures", import.meta.url))
  .filter((f) => f.endsWith(".crownguard.json"))
  .sort();

describe("the published JSON Schema", () => {
  it("is committed up to date with the schema the app validates against", () => {
    const committed = readFileSync(new URL(`../${SCHEMA_PATH}`, import.meta.url), "utf8");
    expect(committed).toBe(schemaText());
  });

  it("describes the current format and allows the fields it doesn't know", () => {
    const doc = schemaDocument();
    expect(doc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(doc.required).toContain("schemaVersion");
    expect(doc.additionalProperties).toEqual({});
  });

  it("validates every file the app saves", () => {
    const check = validate();
    const saved = JSON.parse(toSaveFile(emptyAssessment(), { contentHash: "feedface" })) as unknown;
    expect(check(saved), JSON.stringify(check.errors, null, 2)).toBe(true);
  });

  it("validates the e2e fixtures, brought up to the current format first", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    const check = validate();
    for (const name of fixtures) {
      const raw = JSON.parse(readFileSync(new URL(`../e2e/fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
      const from = detectSchemaVersion(raw);
      expect(from, name).toBeGreaterThanOrEqual(1);
      const current = migrate(raw, from!).raw;
      expect(check(current), `${name}: ${JSON.stringify(check.errors, null, 2)}`).toBe(true);
    }
  });

  it("rejects a saved file that is missing what the format requires", () => {
    const check = validate();
    const saved = JSON.parse(toSaveFile(emptyAssessment())) as Record<string, unknown>;
    delete saved.schemaVersion;
    expect(check(saved)).toBe(false);
  });

  it("is the file the saved format points at", () => {
    const saved = JSON.parse(toSaveFile(emptyAssessment())) as { $schema: string };
    expect(saved.$schema).toContain(`crownguard-assessment.v${SCHEMA_VERSION}.json`);
  });
});
