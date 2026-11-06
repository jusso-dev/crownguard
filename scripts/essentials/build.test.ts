// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readRepoFile } from "../lib/repo";
import { parseIdList } from "../lib/text";
import { ESSENTIALS_IT } from "../lib/upstreams";
import { essentialsGenerator, essentialsYaml, extractEssentials, parseInputs } from "./build";
import { cloudCatalogueSchema, cloudYaml } from "./cloud";

const dir = join(import.meta.dirname, "fixtures", "sample");
const read = (name: string) => readFileSync(join(dir, name), "utf8");
const inputs = () => parseInputs(read);

describe("the Essentials generator", () => {
  it("reads principles, actions, domains, ISM evidence and IGP counts from ASD's OSCAL", () => {
    const x = extractEssentials(inputs());
    expect(x.version).toBe("2026.10.15");
    expect(x.principles).toEqual([
      { id: "GOV-01", name: "Executive cyber security accountability" },
      { id: "PRO-13", name: "Identity, credential and access management" },
    ]);
    const mfa = x.actions.find((a) => a.id === "IT.PRO-13.4")!;
    expect(mfa.principle).toBe("PRO-13");
    expect(mfa.domains).toEqual(["BS", "IS", "CPS", "PE", "BUS", "UD"]);
    expect(mfa.e8).toContain("ISM-1504");
    expect(mfa.igp).toEqual({ ne: 4, pe: 3, fe: 4 });
    expect(x.actions.find((a) => a.id === "IT.PRO-13.3")!.domains).toEqual(["VR"]);
  });

  it("takes domain names and phases from the profiles, with capability domains in every phase", () => {
    const { domains } = extractEssentials(inputs());
    expect(domains.map((d) => [d.id, d.type, d.phases])).toEqual([
      ["GC", "capability", [1, 2, 3]],
      ["VR", "capability", [1, 2, 3]],
      ["BS", "technical", [1]],
      ["IS", "technical", [1]],
      ["CPS", "technical", [2]],
      ["PE", "technical", [2]],
      ["BUS", "technical", [3]],
      ["UD", "technical", [3]],
    ]);
    expect(domains.find((d) => d.id === "IS")!.name).toBe("Identity services");
  });

  it("reads every release file it needs and writes the same text every time", () => {
    const files = Object.fromEntries(essentialsGenerator.files.map((n) => [n, read(n)]));
    const first = essentialsGenerator.build(files, { tag: "v2026.10.15", retrieved: "2026-11-04" });
    expect(essentialsGenerator.build(files, { tag: "v2026.10.15", retrieved: "2026-11-04" })).toEqual(first);
    expect(parseIdList(first.ids)).toEqual(["IT.GOV-01.1", "IT.PRO-13.3", "IT.PRO-13.4"]);
  });

  it("fails loudly when the OSCAL shape changes", () => {
    const odd = JSON.parse(read("E4EIT_catalog.json"));
    odd.catalog.groups[0].brandNewKey = true;
    expect(() => parseInputs((n) => (n === "E4EIT_catalog.json" ? JSON.stringify(odd) : read(n)))).toThrowError(/expected OSCAL shape/);
  });

  it("produces a framework file the content schema reads", () => {
    const doc = parse(essentialsYaml(extractEssentials(inputs()), { tag: "v2026.10.15", retrieved: "2026-11-04" }));
    expect(doc.essentials.chapter).toBe("enterprise-it");
    expect(doc.essentials.release).toBe("v2026.10.15");
    expect(doc.controls.every((c: { id: string }) => /^IT\.[A-Z]{3}-\d{2}\.\d+$/.test(c.id))).toBe(true);
  });
});

describe("the cloud chapter generator", () => {
  const sample = {
    chapter: "cloud",
    version: "2026-10",
    source: "https://www.cyber.gov.au/publication/essentials-for-cloud",
    idScheme: "provisional",
    retrievedAt: "2026-10-17",
    expected: { domains: 2, principles: 1, actions: 1 },
    domains: [
      { key: "GC", name: "Governance and culture", type: "capability" },
      { key: "IS", name: "Identity services", type: "technical" },
    ],
    phases: [{ phase: "P1", domains: ["IS"] }],
    principles: [{ key: "PRO-13", name: "Identity, credential and access management" }],
    actions: [{ id: "CL.PRO-13.x5", principle: "PRO-13", statement: "Use phishing-resistant MFA for users authenticating to systems.", domains: ["IS"], provisional: true, sharedResponsibility: { paas: "S", saas: "S" } }],
  };

  it("marks every id provisional and carries the shared responsibility markers", () => {
    const doc = parse(cloudYaml(cloudCatalogueSchema.parse(sample)));
    expect(doc.essentials.provisional).toBe(true);
    expect(doc.essentials.domains).toEqual([
      { id: "GC", name: "Governance and culture", type: "capability", phases: [1, 2, 3] },
      { id: "IS", name: "Identity services", type: "technical", phases: [1] },
    ]);
    expect(doc.controls[0]).toMatchObject({ id: "CL.PRO-13.x5", responsibility: { paas: "S", saas: "S" } });
  });

  it("refuses a catalogue whose counts don't match what it says it holds", () => {
    expect(() => cloudYaml(cloudCatalogueSchema.parse({ ...sample, expected: { domains: 2, principles: 1, actions: 2 } }))).toThrowError(/don't match/);
  });
});

describe("the committed Essentials artifacts", () => {
  const it_ = parse(readRepoFile(ESSENTIALS_IT.frameworkFile));
  const cloud = parse(readRepoFile("content/frameworks/asd-essentials-cloud.yaml"));
  const pinned = readRepoFile(ESSENTIALS_IT.idsFile);

  it("list exactly the enterprise IT actions pinned for this release, under the eight domains", () => {
    expect(it_.essentials.domains).toHaveLength(8);
    expect(new Set(parseIdList(pinned))).toEqual(new Set(it_.controls.map((c: { id: string }) => c.id)));
    expect(pinned).toContain(`release tag ${it_.essentials.release}`);
  });

  it("give every action a principle the chapter lists", () => {
    for (const doc of [it_, cloud]) {
      const principles = new Set(doc.essentials.principles.map((p: { id: string }) => p.id));
      for (const c of doc.controls) expect(principles, `${c.id}: ${c.principle}`).toContain(c.principle);
    }
  });

  it("mark every cloud action provisional", () => {
    expect(cloud.essentials.provisional).toBe(true);
    for (const c of cloud.controls) expect(c.id).toMatch(/^CL\.[A-Z]{3}-\d{2}\.x\d+$/);
  });

  it("keep phases as data: phase 1 is Boundary services and Identity services in both chapters", () => {
    for (const doc of [it_, cloud])
      expect(doc.essentials.domains.filter((d: { phases: number[]; type: string }) => d.type === "technical" && d.phases.includes(1)).map((d: { id: string }) => d.id)).toEqual(["BS", "IS"]);
  });
});
