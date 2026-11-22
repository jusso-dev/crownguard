// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseOscal } from "../lib/oscal";
import { readRepoFile } from "../lib/repo";
import { parseIdList, shorten, TITLE_MAX } from "../lib/text";
import { ISM } from "../lib/upstreams";
import { displayId, extractControls, ismGenerator, ismYaml, releaseMonth } from "./build";
import { ISM_APPLICABILITY, ISM_E8_LEVELS, oscalCatalogFileSchema, type OscalCatalogFile } from "./oscal";

const sampleText = readFileSync(join(import.meta.dirname, "fixtures", "oscal-sample.json"), "utf8");
const sample = (): OscalCatalogFile => parseOscal("oscal-sample.json", sampleText, oscalCatalogFileSchema);
const build = (catalog: string, retrieved = "2026-10-10") => ismGenerator.build({ "ISM_catalog.json": catalog }, { tag: "v2026.09.4", retrieved });

describe("the ISM generator", () => {
  it("shows every control id in display form and its guideline / section / topic path", () => {
    const { rows, withdrawn, oscalIds } = extractControls(sample());
    expect(rows.map((r) => r.id)).toEqual(["ISM-1504", "ISM-1504A", "ISM-1679", "ISM-PRINCIPLE-PRO-01"]);
    expect(rows.map((r) => r.group)).toEqual([
      "Guidelines for system access / Identity and access management / Multi-factor authentication",
      "Guidelines for system access / Identity and access management / Multi-factor authentication",
      "Guidelines for system access / Identity and access management / Multi-factor authentication",
      "Cyber security principles / The cyber security principles / Protect cyber security principles",
    ]);
    expect(withdrawn).toEqual(["ISM-1999"]);
    expect(oscalIds).toContain("ism-1999");
  });

  it("shortens each statement to a title, marking cuts with an ellipsis", () => {
    const { rows } = extractControls(sample());
    const mfa = rows.find((r) => r.id === "ISM-1504")!;
    expect(mfa.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(mfa.title.endsWith("…")).toBe(true);
    expect(mfa.title.startsWith("Multi-factor authentication is used")).toBe(true);
    // The parent's first sentence fits in full, so no ellipsis.
    const nested = rows.find((r) => r.id === "ISM-1504A")!;
    expect(nested.title).toBe("A nested control, picked up under its parent’s group");
    expect(shorten("One sentence. Another one.")).toBe("One sentence");
    expect(shorten("a".repeat(TITLE_MAX))).toBe("a".repeat(TITLE_MAX));
    expect(shorten("a".repeat(TITLE_MAX + 1))).toBe(`${"a".repeat(TITLE_MAX - 1)}…`);
  });

  it("keeps the ISM's own attributes and drops the rest", () => {
    const { rows } = extractControls(sample());
    const mfa = rows.find((r) => r.id === "ISM-1504")!;
    expect(mfa.updated).toBe("Sep-26");
    expect(mfa.applicability).toEqual(["NC", "OS", "P", "S", "TS"]);
    expect(mfa.e8).toEqual(["ML1", "ML2", "ML3"]);
    expect(rows.find((r) => r.id === "ISM-1679")!.applicability).toEqual(["P"]);
    // Principles carry no `updated` prop in the catalog, so the field stays out.
    expect(rows.find((r) => r.id === "ISM-PRINCIPLE-PRO-01")).not.toHaveProperty("updated");
  });

  it("takes nested controls under their parent's group and withdrawn ones out of the list", () => {
    const { rows, withdrawn } = extractControls(sample());
    expect(rows.some((r) => r.id === "ISM-1504A")).toBe(true);
    expect(rows.some((r) => r.id === "ISM-1999")).toBe(false);
    expect(withdrawn).toEqual(["ISM-1999"]);
  });

  it("names the release tag and retrieval date in the header and labels the release in the names", () => {
    const yaml = ismYaml(sample(), extractControls(sample()), { tag: "v2026.09.4", retrieved: "2026-10-10" });
    expect(yaml).toContain("at release tag v2026.09.4");
    expect(yaml).toContain("Retrieved 2026-10-10.");
    expect(yaml).toContain("shortName: ISM (Sep 2026)");
    expect(yaml).toContain("name: Australian Government Information Security Manual (September 2026 release)");
    expect(yaml).toContain("closed: true");
    expect(releaseMonth("v2026.09.4")).toEqual({ short: "Sep 2026", long: "September 2026" });
    expect(() => releaseMonth("2026.09.4")).toThrow();
  });

  it("writes the same text every time, differing only in the retrieval date", () => {
    const first = build(sampleText);
    expect(build(sampleText)).toEqual(first);
    expect(build(sampleText, "2027-01-05").yaml).toBe(first.yaml.replace("Retrieved 2026-10-10.", "Retrieved 2027-01-05."));
  });

  it("quotes each control's updated month and refuses catalog metadata that could break out of the header", () => {
    const yaml = ismYaml(sample(), extractControls(sample()), { tag: "v2026.09.4", retrieved: "2026-10-10" });
    expect(yaml).toContain('    updated: "Sep-26"');
    expect(yaml).not.toMatch(/^ {4}updated: [^"]/m);
    const odd = sample();
    odd.catalog.metadata.version = "2026.09.4\nclosed: false";
    expect(() => ismYaml(odd, extractControls(odd), { tag: "v2026.09.4", retrieved: "2026-10-10" })).toThrowError(/catalog version/);
    const late = sample();
    late.catalog.metadata.published = "soon";
    expect(() => ismYaml(late, extractControls(late), { tag: "v2026.09.4", retrieved: "2026-10-10" })).toThrowError(/published date/);
    const month = JSON.parse(sampleText.replace('"value": "Dec-22"', '"value": "2022-12"'));
    expect(() => extractControls(month)).toThrowError(/unexpected updated value/);
  });

  it("stops when the OSCAL shape changes or a control has no statement", () => {
    const odd = JSON.parse(sampleText);
    odd.catalog.groups[0].brandNewKey = true;
    expect(() => build(JSON.stringify(odd))).toThrowError(/ISM_catalog\.json does not match the expected OSCAL shape/);
    const noStatement = JSON.parse(sampleText);
    noStatement.catalog.groups[0].groups[0].groups[0].controls[0].parts = [];
    expect(() => build(JSON.stringify(noStatement))).toThrowError(/no statement/);
  });

  it("writes a framework file the content loader reads, citing the ISM and its OSCAL release", () => {
    const doc = parse(build(sampleText).yaml);
    expect(doc).toMatchObject({ id: "ism", closed: true, source: "asd-ism", sources: [ISM.source!.id], withdrawn: ["ISM-1999"] });
  });
});

describe("the committed ISM artifacts", () => {
  const yamlText = readRepoFile(ISM.frameworkFile);
  const idsText = readRepoFile(ISM.idsFile);
  const doc = parse(yamlText);

  it("list every control in the pinned id list for this release, live or withdrawn", () => {
    const listed = [...doc.controls.map((c: { id: string }) => c.id), ...doc.withdrawn];
    expect(new Set(parseIdList(idsText).map(displayId))).toEqual(new Set(listed));
  });

  it("keep every control's applicability and e8 values inside the ISM's own lists", () => {
    for (const c of doc.controls) {
      for (const a of c.applicability ?? []) expect(ISM_APPLICABILITY).toContain(a);
      for (const e of c.e8 ?? []) expect(ISM_E8_LEVELS).toContain(e);
    }
  });
});
