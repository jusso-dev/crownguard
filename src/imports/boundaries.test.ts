import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogue } from "../content/catalogue";
import { emptyAssessment } from "../format/empty";
import { detectImporter, importers, readScan, resolveImporter } from "./index";
import { parseCsv } from "./csv";
import { readGoogleConsent, readGraphConsent } from "./consent";
import { importLimits, ImportLimitError } from "./limits";

// Exercise real guards with small inputs. Production policy is asserted separately.
vi.mock("./limits", async (original) => {
  const actual = await original<typeof import("./limits")>();
  Object.assign(actual.importLimits, { maxBytes: 1024, maxRows: 3, m365MaxRows: 2 });
  return actual;
});

beforeEach(() => Object.assign(importLimits, { maxBytes: 1024, maxRows: 3, m365MaxRows: 2 }));
afterEach(() => vi.restoreAllMocks());
const read = (id: string, text: string) => importers.find((i) => i.id === id)!.read(text, catalogue.imports.get(id)!);

describe("raw records before filtering or grouping", () => {
  it("rejects duplicate Prowler CSV rows including the EOF row", () => {
    expect(() => read("prowler-aws", "CHECK_ID,STATUS\nunknown,PASS\nunknown,PASS\nunknown,PASS\nunknown,FAIL")).toThrow(ImportLimitError);
  });
  it("rejects Prowler OCSF array slots before validating them", () => {
    expect(() => read("prowler-aws", "[null,null,null,null]")).toThrow(ImportLimitError);
  });
  it("rejects M365 findings before schema traversal", () => {
    expect(() => read("m365-secure", '{"findings":[null,null,null]}')).toThrow(ImportLimitError);
  });
  it("counts blank Scuba IDs across products and groups", () => {
    const text = JSON.stringify({ MetaData: { Tool: "ScubaGoggles" }, Results: { A: [{ Controls: [{}, {}] }], B: [{ Controls: [{}, {}] }] } });
    expect(() => read("scubagoggles", text)).toThrow(ImportLimitError);
  });
  it("counts unmatched Graph principals across files", () => {
    expect(() => readGraphConsent(['[{"clientId":"a","scope":"openid"}]', '[{"appId":"x"},{"appId":"x"},{"appId":"x"}]'], [], [])).toThrow(ImportLimitError);
  });
  it("counts revoked and unusable Google rows", () => {
    expect(() => readGoogleConsent("Application name,Scope,Event\na,openid,Grant\na,openid,Revoke\n,openid,Grant\na,openid,Revoke", [], [])).toThrow(ImportLimitError);
  });
});

describe("text guards before format work", () => {
  // A parse sentinel proves the input is refused before JSON.parse, without parsing a large document.
  it("guards registry, explicit tool, shared read and every direct detector/reader", () => {
    const text = "x".repeat(1025);
    const parse = vi.spyOn(JSON, "parse").mockImplementation(() => { throw new Error("parse reached"); });
    for (const entry of [
      () => detectImporter(text),
      () => resolveImporter("prowler", text),
      () => parseCsv(text),
      () => readGoogleConsent(text, [], []),
      () => readGraphConsent(text, [], []),
      ...importers.flatMap((i) => [
        () => i.detect(text),
        () => i.read(text, catalogue.imports.get(i.id)!),
        () => readScan(catalogue, i, text, emptyAssessment()),
      ]),
    ]) expect(entry).toThrow(ImportLimitError);
    expect(parse).not.toHaveBeenCalled();
  });
});


it("admits exact row limits and keeps the last failure in each scan format", () => {
  const mapping = { id: "test", name: "Test", platform: "microsoft", url: "https://example.com", mappings: [{ question: "Q", checks: ["A"], rationale: "test" }] };
  const importer = (id: string) => importers.find((i) => i.id === id)!;
  const csv = "CHECK_ID,STATUS\nA,PASS\nA,PASS\nA,FAIL";
  expect(importer("prowler-aws").read(csv, mapping).suggestions[0].evidence).toMatchObject({ suggested: "no", checks: [{ count: "1 of 3 resources failing" }] });
  const finding = { metadata: { event_code: "A" }, status_code: "PASS" };
  const ocsf = JSON.stringify([finding, finding, { ...finding, status_code: "FAIL" }]);
  expect(importer("prowler-aws").read(ocsf, mapping).suggestions[0].evidence.suggested).toBe("no");
  expect(importer("prowler-aws").read(JSON.stringify(finding), mapping)).toEqual(importer("prowler-aws").read(JSON.stringify([finding]), mapping));
  const ms = { summary: { timestamp: "2026-01-01", tenant: { display_name: "Test", primary_domain: "example.test" } }, findings: [{ check_id: "A", status: "pass" }, { check_id: "A", status: "fail" }] };
  expect(importer("m365-secure").read(JSON.stringify(ms), mapping).suggestions[0].evidence.suggested).toBe("partial");
  const scuba = { MetaData: { Tool: "ScubaGoggles" }, Results: { A: [{ Controls: [{}, { "Control ID": "A", Result: "Pass" }] }], B: [{ Controls: [{ "Control ID": "A", Result: "Fail" }] }] } };
  expect(importer("scubagoggles").read(JSON.stringify(scuba), mapping).suggestions[0].evidence.suggested).toBe("partial");
});

it("aggregates the last admitted failure beyond saved checks and resource examples", () => {
  Object.assign(importLimits, { maxBytes: 32_000, maxRows: 52 });
  const ids = Array.from({ length: 52 }, (_, i) => `check${i}`);
  const mapping = { id: "test", name: "Test", platform: "aws", url: "https://example.com", mappings: [{ question: "Q", checks: ids, rationale: "test" }] };
  const importer = importers.find((i) => i.id === "prowler-aws")!;
  const csv = "CHECK_ID,STATUS\n" + ids.map((id, i) => `${id},${i === 51 ? "FAIL" : "PASS"}`).join("\n");
  const evidence = importer.read(csv, mapping).suggestions[0].evidence;
  expect(evidence.suggested).toBe("partial");
  expect(evidence.checks).toHaveLength(50);
  const resources = "CHECK_ID,STATUS,RESOURCE_UID\n" + ids.map((id, i) => `check0,${i === 51 ? "PASS" : "FAIL"},${id}`).join("\n");
  const resourceEvidence = importer.read(resources, mapping).suggestions[0].evidence;
  expect(resourceEvidence.checks[0].count).toBe("51 of 52 resources failing");
  expect(resourceEvidence.checks[0].examples).toHaveLength(10);
});

it("checks combined UTF-8 Graph bytes before parsing any file", () => {
  const grant = '[{"clientId":"a","scope":"openid"}]';
  const principal = '[{"appId":"a"}]';
  const total = new TextEncoder().encode(grant + principal).length;
  Object.assign(importLimits, { maxBytes: total });
  expect(readGraphConsent([grant, principal], [], []).grants).toBe(1);
  const parse = vi.spyOn(JSON, "parse");
  expect(() => readGraphConsent([grant, principal + " "], [], [])).toThrow(ImportLimitError);
  expect(parse).not.toHaveBeenCalled();
  expect(() => readGraphConsent([grant, principal.replace("a", "é")], [], [])).toThrow(ImportLimitError);
  expect(parse).not.toHaveBeenCalled();
});

it("admits exact combined Graph rows and logical Google rows, preserving counts and privacy", () => {
  expect(readGraphConsent(['[{"clientId":"a","scope":"openid","principalId":"person@example.test"}]', '{"value":[{"appId":"a"},{"appId":"unmatched"}]}'], [], []).grants).toBe(1);
  const csv = 'Application name,Scope,Event,User\n"two\nlines",openid,Grant,person@example.test\na,openid,Revoke,person@example.test\n,openid,Grant,person@example.test';
  const result = readGoogleConsent(csv, [], []);
  expect(result.grants).toBe(1);
  expect(result.apps[0].name).toBe("two\nlines");
  expect(JSON.stringify(result)).not.toContain("person@example.test");
});

it("counts ignored Raw/metadata bytes and keeps the byte error ahead of ScubaGear diagnostics", () => {
  const parse = vi.spyOn(JSON, "parse");
  const text = JSON.stringify({ MetaData: { Tool: "ScubaGear" }, Raw: "é".repeat(600) });
  expect(() => read("scubagoggles", text)).toThrow(ImportLimitError);
  expect(parse).not.toHaveBeenCalled();
});

it("guards registry detection and shared dispatch before invoking a concrete importer", () => {
  const text = "x".repeat(1025);
  const detectors = importers.map((i) => vi.spyOn(i, "detect").mockReturnValue(false));
  expect(() => detectImporter(text)).toThrow(ImportLimitError);
  expect(() => resolveImporter("m365-secure", text)).toThrow(ImportLimitError);
  for (const detector of detectors) expect(detector).not.toHaveBeenCalled();
  const reader = vi.spyOn(importers[0], "read");
  expect(() => readScan(catalogue, importers[0], text, { ...emptyAssessment(), platforms: ["microsoft"] })).toThrow(ImportLimitError);
  expect(reader).not.toHaveBeenCalled();
});
