// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildIsm, displayId, extractControls, ismYaml, releaseMonth, shorten, TITLE_MAX } from "./build";
import { oscalCatalogFileSchema, type OscalCatalogFile } from "./oscal";

const sampleText = readFileSync(join(import.meta.dirname, "fixtures", "oscal-sample.json"), "utf8");
const sample = (): OscalCatalogFile => {
  const parsed = oscalCatalogFileSchema.safeParse(JSON.parse(sampleText));
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
};

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
    expect(displayId("ism-1504")).toBe("ISM-1504");
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

  it("writes the same text every time and keeps its retrieval date on a rerun", () => {
    const first = buildIsm(sample(), { tag: "v2026.09.4", retrieved: "2026-10-10" });
    const again = buildIsm(sample(), { tag: "v2026.09.4", retrieved: "2026-10-10" });
    expect(again.yaml).toBe(first.yaml);
    expect(again.ids).toBe(first.ids);
    // A rerun on another day changes nothing but would change the date, so the old date is kept: a true no-op.
    const rerun = buildIsm(sample(), { tag: "v2026.09.4", retrieved: "2027-01-05", previousYaml: first.yaml });
    expect(rerun.yaml).toBe(first.yaml);
  });

  it("fails loudly when the OSCAL shape changes", () => {
    const odd = JSON.parse(sampleText);
    odd.catalog.groups[0].brandNewKey = true;
    expect(oscalCatalogFileSchema.safeParse(odd).success).toBe(false);
    const noStatement = JSON.parse(sampleText);
    noStatement.catalog.groups[0].groups[0].groups[0].controls[0].parts = [];
    const parsed = oscalCatalogFileSchema.safeParse(noStatement);
    expect(parsed.success).toBe(true);
    expect(() => extractControls(parsed.data as OscalCatalogFile)).toThrowError(/no statement/);
  });

  it("parses the generated framework file as YAML with every control carrying its id, group and title", () => {
    const doc = parse(ismYaml(sample(), extractControls(sample()), { tag: "v2026.09.4", retrieved: "2026-10-10" }));
    expect(doc.id).toBe("ism");
    expect(doc.closed).toBe(true);
    expect(doc.source).toBe("asd-ism");
    expect(doc.sources).toEqual(["asd-ism-oscal"]);
    expect(doc.withdrawn).toEqual(["ISM-1999"]);
    for (const c of doc.controls) {
      expect(c.id).toMatch(/^ISM-/);
      expect(c.group.length).toBeGreaterThan(10);
      expect(c.title.length).toBeGreaterThan(2);
    }
  });
});

describe("the committed ISM artifacts", () => {
  const yamlText = readFileSync(join(import.meta.dirname, "..", "..", "content", "frameworks", "ism.yaml"), "utf8");
  const idsText = readFileSync(join(import.meta.dirname, "fixtures", "ism-controls.txt"), "utf8");
  const doc = parse(yamlText);

  it("has exactly the control count pinned in the fixture for this release", () => {
    const pinned = idsText.split("\n").filter((l) => l && !l.startsWith("#"));
    const listed = [...doc.controls.map((c: { id: string }) => c.id), ...doc.withdrawn];
    expect(pinned.length).toBe(listed.length);
    expect(new Set(pinned.map(displayId))).toEqual(new Set(listed));
  });

  it("pins the release tag in both files' headers", () => {
    const tag = idsText.match(/release tag (v[\d.]+)/)?.[1];
    expect(tag).toBeTruthy();
    expect(yamlText).toContain(`at release tag ${tag}`);
  });

  it("keeps every control's applicability and e8 values inside the ISM's own lists", () => {
    for (const c of doc.controls) {
      for (const a of c.applicability ?? []) expect(["NC", "OS", "P", "S", "TS"]).toContain(a);
      for (const e of c.e8 ?? []) expect(["ML1", "ML2", "ML3"]).toContain(e);
    }
  });
});
