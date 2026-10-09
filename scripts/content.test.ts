import { describe, expect, it } from "vitest";
import { loadCatalogue } from "../src/content/loader";
import { readContentFiles } from "./read-content";

const { catalogue, errors } = loadCatalogue(readContentFiles());

describe("content", () => {
  it("validates", () => expect(errors).toEqual([]));

  it("ships every platform", () => expect([...catalogue.platforms.keys()].sort()).toEqual(["aws", "google", "microsoft"]));

  it("grounds every question in the platform vendor's own guidance", () => {
    for (const { platform, questions } of catalogue.platforms.values())
      for (const q of questions) {
        const publishers = q.sources.map((s) => catalogue.sources.get(s)?.publisher ?? "");
        expect(publishers.some((p) => p.includes(platform.vendor)), `${q.id} cites no ${platform.vendor} source`).toBe(true);
      }
  });

  it("rejects sources nothing cites and sources that point at the same page", () => {
    const files = {
      "content/sources/a.yaml": `- { id: used, title: Used page, publisher: Microsoft, url: "https://learn.microsoft.com/en-us/a", retrieved: 2026-01-01 }
- { id: unused, title: Unused page, publisher: Microsoft, url: "https://learn.microsoft.com/en-us/b", retrieved: 2026-01-01 }
- { id: twin, title: Same page, publisher: Microsoft, url: "https://learn.microsoft.com/en-us/A/", retrieved: 2026-01-01 }
- { id: section, title: Another section, publisher: Microsoft, url: "https://learn.microsoft.com/en-us/a#steps", retrieved: 2026-01-01 }`,
      "content/frameworks/f.yaml": "id: f\nname: F\nshortName: F\npublisher: X\nsource: used\nsources: [twin, section]\nclosed: false\n",
    };
    const { errors: found } = loadCatalogue(files);
    expect(found).toEqual(["source unused: not cited by any question, framework or platform", "source twin: same page as used"]);
  });

  it("never maps questions to an IDCF cyber row: those are read from the Essential Eight tags", () => {
    for (const { questions } of catalogue.platforms.values())
      for (const q of questions)
        for (const r of q.refs.filter((x) => x.framework === "idcf")) expect(r.ref, `${q.id} refs ${r.ref}`).not.toMatch(/^DSL-\d\+? Cyber$/);
  });

  it("ships the SOC module with one maturity question per aspect and one capability question per technology or service aspect", () => {
    const soc = catalogue.soc!;
    expect(soc.model.domains.map((d) => d.aspects.length)).toEqual([5, 5, 7, 4, 6]);
    for (const d of soc.model.domains)
      for (const a of d.aspects) {
        const kinds = soc.questions.filter((q) => q.aspect === a.id).map((q) => q.kind);
        expect(kinds, a.id).toEqual(d.capability ? ["maturity", "capability"] : ["maturity"]);
      }
  });

  it("rejects SOC questions in the wrong domain, missing capability questions and unknown refs", () => {
    const files = {
      "content/sources/s.yaml": `- { id: model, title: Model, publisher: X, url: "https://example.com/m", retrieved: 2026-01-01 }
- { id: deed, title: Deed, publisher: Y, url: "https://example.com/d", retrieved: 2026-01-01 }`,
      "content/soc/model.yaml": readContentFiles()["content/soc/model.yaml"].replace(/^source: .*$/m, "source: model").replace(/^licenceSource: .*$/m, "licenceSource: deed").replace(/^sources: .*$/m, "sources: []"),
      "content/soc/questions.yaml": `- { id: SOC-PPL-001, aspect: business-drivers, question: "Is it defined?", why: "Because it matters a great deal.", levels: [aaaaaaaa, bbbbbbbb, cccccccc, dddddddd, eeeeeeee, ffffffff], refs: [{ framework: nope, ref: X }] }
- { id: SOC-BUS-002, aspect: charter, kind: capability, question: "Is it chartered?", why: "Because it matters a great deal.", levels: [aaaaaaaa, bbbbbbbb, cccccccc, dddddddd] }`,
    };
    const { errors: found } = loadCatalogue(files);
    expect(found).toContain("soc: SOC-PPL-001: id should start SOC-BUS- for the Business domain");
    expect(found).toContain("soc: SOC-PPL-001: unknown framework nope");
    expect(found).toContain("soc: SOC-BUS-002: capability questions belong only in capability domains");
    expect(found).toContain("soc: aspect charter has no maturity question");
    expect(found).toContain("soc: aspect log-monitoring has no capability question");
  });

  it("tags Essential Eight strategies the frameworks file knows about", () => {
    const e8 = catalogue.frameworks.get("essential-eight");
    expect(e8?.controls).toHaveLength(8);
  });
});
