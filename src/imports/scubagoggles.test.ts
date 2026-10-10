import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { importers } from "./index";
import { parseScubagoggles, readScuba, scubagogglesImporter, stripHtml, toStatus } from "./scubagoggles";

const fixture = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");
const mapping = catalogue.imports.get("scubagoggles")!;
const read = (text: string) => readScuba(parseScubagoggles(text), mapping);
const answers = (text: string) => Object.fromEntries(read(text).suggestions.map((s) => [s.question, s.evidence.suggested]));
const example = fixture("ScubaResults.json");

describe("ScubaGoggles JSON", () => {
  it("reads the metadata and every policy result", () => {
    const report = parseScubagoggles(example);
    expect(report).toMatchObject({ toolVersion: "1.0.1", domain: "example.com", scannedAt: "2026-10-08T22:00:00.000Z" });
    expect(report.controls).toHaveLength(26);
    expect(report.controls.find((c) => c.id === "GWS.GMAIL.4.2v1")).toMatchObject({ result: "Fail", criticality: "Shall" });
  });

  it("says so when the file is cut off", () => {
    expect(() => parseScubagoggles(example.slice(0, 500))).toThrow(/isn't valid JSON.*cut off/);
  });

  it("refuses a ScubaGear (Microsoft 365) file with a plain message", () => {
    const gear = JSON.parse(example);
    gear.MetaData.Tool = "ScubaGear";
    gear.MetaData.ProductSuite = "Microsoft 365";
    expect(() => parseScubagoggles(JSON.stringify(gear))).toThrow(/ScubaGear report for Microsoft 365.*ScubaGoggles reports for Google Workspace/);
  });

  it("refuses a file that isn't ScubaGoggles output at all", () => {
    expect(() => parseScubagoggles('{"summary": true}')).toThrow(/isn't a ScubaGoggles report/);
    const other = JSON.parse(example);
    other.MetaData.Tool = "SomeOtherScanner";
    expect(() => parseScubagoggles(JSON.stringify(other))).toThrow(/came from SomeOtherScanner/);
  });

  it("says so when the report has no policy results", () => {
    const empty = JSON.parse(example);
    empty.Results = { gmail: [{ GroupName: "x", Controls: [] }] };
    expect(() => parseScubagoggles(JSON.stringify(empty))).toThrow(/no policy results/);
  });

  it("warns when the report carries different policy versions, but still lines the policies up", () => {
    const older = example.replaceAll("GWS.GMAIL.4.2v1", "GWS.GMAIL.4.2v0.1");
    const result = read(older);
    expect(result.warnings?.join(" ")).toMatch(/different SCuBA policy versions.*checked against v1\.0\.1/);
    expect(result.warnings?.join(" ")).toContain("GWS.GMAIL.4.2v0.1 here against GWS.GMAIL.4.2v1");
    expect(result.suggestions.find((s) => s.question === "GO-GML-001")?.evidence.checks[0].id).toBe("GWS.GMAIL.4.2v0.1");
    expect(read(example).warnings).toBeUndefined();
  });
});

describe("turning ScubaGoggles results into answers", () => {
  it("passes, fails, caps a failed SHOULD at Partial and leaves the rest for the assessor", () => {
    const a = answers(example);
    // Pass: the mapped policy is the whole question.
    expect(a["GO-ADM-007"]).toBe("yes");
    expect(a["GO-GEM-005"]).toBe("yes");
    expect(a["GO-MEET-001"]).toBe("yes");
    expect(a["GO-DRV-002"]).toBe("yes");
    // Fail on a SHALL: No.
    expect(a["GO-GML-001"]).toBe("no");
    // Warning (a failed SHOULD): fail capped at Partial, even beside a Fail.
    expect(a["GO-GML-003"]).toBe("partial");
    expect(a["GO-GML-002"]).toBe("partial");
    expect(a["GO-DRV-001"]).toBe("partial");
    // Mixed pass and fail: Partial.
    expect(a["GO-MEET-002"]).toBe("partial");
    expect(a["GO-GEM-007"]).toBe("partial");
    expect(a["GO-APP-001"]).toBe("partial");
    // cap: partial on the mapping: a pass that only covers part of the question is still Partial.
    expect(a["GO-ADM-001"]).toBe("partial");
    expect(a["GO-GEM-004"]).toBe("partial");
    expect(a["GO-GML-005"]).toBe("partial");
    // N/A, Omitted, Error and Incorrect Result settle nothing.
    expect(a["GO-GML-004"]).toBeUndefined();
    expect(a["GO-DRV-003"]).toBeUndefined();
    expect(a["GO-DRV-006"]).toBeUndefined();
    expect(a["GO-MEET-003"]).toBeUndefined();
  });

  it("reads the whole result table as the ScubaGoggles report writes it", () => {
    expect(toStatus("Pass")).toBe("pass");
    expect(toStatus("Fail")).toBe("fail");
    expect(toStatus("Warning")).toBe("warning");
    for (const r of ["N/A", "Omitted", "Incorrect Result", "Error", "Error - Test results missing", "No events found", "anything else"])
      expect(toStatus(r), r).toBe("review");
  });

  it("strips the HTML out of Details before keeping it as evidence", () => {
    expect(stripHtml('The following OUs are non-compliant: <div class="details">- All Users: automatic forwarding is <span class="value">on</span> &amp; allowed</div>')).toBe(
      "The following OUs are non-compliant: - All Users: automatic forwarding is on & allowed",
    );
    expect(stripHtml("Requirement met.<br><br>")).toBe("Requirement met.");
    expect(stripHtml("1 &lt; 2 &#8212; ok&#x21;")).toBe("1 < 2 — ok!");
    const forwarding = read(example).suggestions.find((s) => s.question === "GO-GML-002")!.evidence.checks.find((c) => c.id === "GWS.GMAIL.11.1v1")!;
    expect(forwarding.current).toBe("The following OUs are non-compliant: - All Users: automatic forwarding is on & allowed to any address");
  });

  it("names the scanner, its version and the domain on every piece of evidence", () => {
    const ev = read(example).suggestions[0].evidence;
    expect(ev).toMatchObject({ source: "ScubaGoggles", tool: "ScubaGoggles", toolVersion: "1.0.1", tenant: "example.com", scannedAt: "2026-10-08T22:00:00.000Z" });
  });

  it("lists failing checks it has no question for", () => {
    const result = read(example);
    expect(result.unmapped).toBe(1);
    expect(result.unmappedFailing).toEqual(["GWS.GMAIL.14.1v1"]);
  });
});

describe("privacy: nothing from Raw survives the import", () => {
  it("keeps super admin and break-glass addresses out of the parsed result and every suggestion", () => {
    const secret = "break.glass.admin@example.com";
    expect(example).toContain(secret); // it is in the file's Raw section...
    const result = read(example);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("Break Glass");
    expect(JSON.stringify(result)).not.toContain("organizational_unit_names");
    expect(JSON.stringify(result.suggestions.flatMap((s) => s.evidence.checks))).not.toContain(secret);
  });
});

describe("the pinned ScubaGoggles control list", () => {
  const pinned = new Set(
    fixture("scubagoggles-controls.txt")
      .split("\n")
      .filter((l) => l && !l.startsWith("#")),
  );

  it("has every control id the mapping uses, so a ScubaGoggles bump shows up as a rename", () => {
    const used = mapping.mappings.flatMap((m) => m.checks);
    expect(used.length).toBeGreaterThan(60);
    expect(used.filter((c) => !pinned.has(c)), "control ids the SCuBA baselines at v1.0.1 don't have").toEqual([]);
    expect(mapping.checkedAgainst).toBe("v1.0.1");
  });

  it("covers at least half of the Gmail, Drive, Common Controls and Gemini policies", () => {
    const covered = new Set(mapping.mappings.flatMap((m) => m.checks));
    const byProduct = (product: string) => [...pinned].filter((id) => id.startsWith(`GWS.${product}.`));
    for (const product of ["GMAIL", "DRIVEDOCS", "COMMONCONTROLS", "GEMINI"]) {
      const all = byProduct(product);
      const hit = all.filter((id) => covered.has(id));
      expect(hit.length * 2, `${product}: ${hit.length} of ${all.length} mapped`).toBeGreaterThanOrEqual(all.length);
    }
  });
});

describe("the ScubaGoggles importer crownguard registers", () => {
  it("detects its own format and no one else's", () => {
    expect(scubagogglesImporter.detect(example)).toBe(true);
    expect(scubagogglesImporter.detect(fixture("prowler-aws.csv"))).toBe(false);
    expect(scubagogglesImporter.detect(fixture("m365-secure-scan.json"))).toBe(false);
    expect(importers).toContain(scubagogglesImporter);
    expect(catalogue.imports.has(scubagogglesImporter.id)).toBe(true);
  });
});

describe("stripping HTML out of Details", () => {
  it("takes out tags, entities and tags left open", () => {
    expect(stripHtml("Passes <span class='x'>for all</span> OUs<br>today")).toBe("Passes for all OUs today");
    expect(stripHtml("&lt;b&gt;literal&lt;/b&gt; stays as text")).toBe("b>literal/b> stays as text");
    expect(stripHtml("half a tag <script")).toBe("half a tag");
    expect(stripHtml("3 < 4 and a > b")).toBe("3 < 4 and a > b");
  });
});
