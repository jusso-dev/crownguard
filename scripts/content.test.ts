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

  it("ships the AI register with DTA sources and a question for every theme", () => {
    const ai = catalogue.aiRegister!;
    expect(ai.model.sources.every((s) => catalogue.sources.get(s)?.url.startsWith("https://www.digital.gov.au/"))).toBe(true);
    for (const q of ai.questions) expect(q.sources.length, q.id).toBeGreaterThan(0);
    expect(ai.model.dates.filter((d) => d.derived).every((d) => d.text.includes("confirm"))).toBe(true);
  });

  it("rejects AI register questions with unknown themes, refs, sources or related questions", () => {
    const files = readContentFiles();
    const bad = `- { id: AIR-ACC-001, theme: nope, basis: guidance, severity: low, question: "Is it recorded?", why: "Because it matters a great deal.", yesLooksLike: "It is recorded.", remediation: "Record it in the register now.", sources: [nowhere], refs: [{ framework: dta-agentic-ai, ref: AGT.9.9 }] }
- { id: AIR-ACC-001, theme: accountability, basis: guidance, severity: low, question: "Is it recorded?", why: "Because it matters a great deal.", yesLooksLike: "It is recorded.", remediation: "Record it in the register now.", sources: [dta-ai-policy] }`;
    const { errors: found } = loadCatalogue({
      ...files,
      "content/ai-register/questions.yaml": bad,
      "content/ai-register/model.yaml": files["content/ai-register/model.yaml"].replace("relatedQuestions: [MS-AI-001,", "relatedQuestions: [MS-AI-999,"),
    });
    expect(found).toContain("ai-register: unknown source nowhere");
    expect(found).toContain("ai-register: kind m365-copilot has unknown related question MS-AI-999");
    expect(found).toContain("ai-register: AIR-ACC-001: unknown theme nope");
    expect(found).toContain("ai-register: AIR-ACC-001: dta-agentic-ai has no control AGT.9.9");
    expect(found).toContain("ai-register: AIR-ACC-001: duplicate question id");
    expect(found).toContain("ai-register: theme oversight has no questions");
  });

  it("tags Essential Eight strategies the frameworks file knows about", () => {
    const e8 = catalogue.frameworks.get("essential-eight");
    expect(e8?.controls).toHaveLength(8);
  });
});
