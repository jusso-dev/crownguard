import { describe, expect, it } from "vitest";
import { contentDigest, loadCatalogue } from "../src/content/loader";
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

  it("shows ISM control ids in display form and rejects a made-up one", () => {
    for (const { questions } of catalogue.platforms.values())
      for (const q of questions)
        for (const r of q.refs.filter((x) => x.framework === "ism")) expect(r.ref, q.id).toMatch(/^ISM-/);
    for (const q of catalogue.aiRegister?.questions ?? [])
      for (const r of q.refs.filter((x) => x.framework === "ism")) expect(r.ref, q.id).toMatch(/^ISM-/);
    const files = readContentFiles();
    const target = "content/platforms/microsoft/questions/identity.yaml";
    const { errors: found } = loadCatalogue({ ...files, [target]: files[target].replace("ref: ISM-1504", "ref: ISM-9999") });
    expect(found).toContain("platform microsoft: MS-ID-001: ism has no control ISM-9999");
  });

  it("warns, never fails, on a ref to a withdrawn ISM control", () => {
    const files = readContentFiles();
    const target = "content/platforms/microsoft/questions/identity.yaml";
    const { errors, warnings } = loadCatalogue({
      ...files,
      "content/frameworks/ism.yaml": files["content/frameworks/ism.yaml"].replace("withdrawn: []", "withdrawn: [ISM-9999]"),
      [target]: files[target].replace("ref: ISM-1504", "ref: ISM-9999"),
    });
    expect(errors).toEqual([]);
    expect(warnings).toContain("platform microsoft: MS-ID-001: ism ref ISM-9999 names a control ASD has withdrawn");
  });

  it("ships both Essentials chapters and leaves the Essential Eight and ISM files alone", () => {
    expect(catalogue.frameworks.get("asd-essentials-enterprise-it")?.controls).toHaveLength(58);
    expect(catalogue.frameworks.get("asd-essentials-cloud")?.controls).toHaveLength(78);
    expect(catalogue.frameworks.get("essential-eight")?.essentials).toBeUndefined();
    expect(catalogue.frameworks.get("ism")?.essentials).toBeUndefined();
  });

  it("rejects an Essentials action in an unknown domain, mixing capability and technical domains, or citing a made-up ISM control", () => {
    const files = readContentFiles();
    const target = "content/frameworks/asd-essentials-enterprise-it.yaml";
    const text = files[target];
    const bad = text
      .replace(/( {2}- id: IT\.GOV-01\.1\n(?: {4}.*\n)*? {4}domains: )\[GC\]/, "$1[GC, IS]")
      .replace(/( {2}- id: IT\.GOV-14\.1\n(?: {4}.*\n)*? {4}evidence: \{ ism: \[)/, "$1ISM-9999, ")
      .replace(/( {2}- id: IT\.IDE-04\.1\n(?: {4}.*\n)*? {4}principle: )IDE-04/, "$1IDE-99");
    expect(bad).not.toBe(text);
    const { errors: found } = loadCatalogue({ ...files, [target]: bad });
    expect(found).toContain("framework asd-essentials-enterprise-it: IT.GOV-01.1: mixes capability and technical domains");
    expect(found).toContain("framework asd-essentials-enterprise-it: IT.GOV-14.1: evidence ISM-9999 is not in the ISM");
    expect(found).toContain("framework asd-essentials-enterprise-it: IT.IDE-04.1: unknown principle IDE-99");
    expect(found).toContain("framework asd-essentials-enterprise-it: principle IDE-04 has no actions");
  });

  /** MS-ID-001's YAML block with its Essentials fields replaced by `extra` (raw YAML lines, or nothing). */
  const withMsId001 = (extra: string) => {
    const files = readContentFiles();
    const target = "content/platforms/microsoft/questions/identity.yaml";
    const block = files[target].split(/\n(?=- id: )/)[0];
    const stripped = block.replace(/\n {2}essentials:(?: \[\])?(?:\n {4}- .*)*/, "").replace(/\n {2}essentialsReviewed: .*/, "");
    return loadCatalogue({ ...files, [target]: files[target].replace(block, `${stripped.trimEnd()}${extra}\n`) });
  };

  it("rejects an Essentials tag naming an unknown action or a domain the action doesn't apply to, and a full tag without a note", () => {
    const { errors: found } = withMsId001(
      "\n  essentialsReviewed: Overridden for this test only.\n  essentials:\n    - { action: IT.PRO-99.1, domains: [IS], coverage: partial }\n    - { action: IT.GOV-01.1, domains: [IS], coverage: partial }",
    );
    expect(found).toContain("MS-ID-001: essentials IT.PRO-99.1: unknown action");
    expect(found).toContain("MS-ID-001: essentials IT.GOV-01.1: action doesn't apply to domain IS");
    const { errors: full } = withMsId001("\n  essentials:\n    - { action: IT.PRO-13.4, domains: [IS], coverage: full }");
    expect(full.some((e) => e.endsWith("essentials.0.note: coverage: full needs a note"))).toBe(true);
  });

  it("warns when a question's ISM refs suggest an Essentials action it isn't tagged with", () => {
    const { errors: found, warnings } = withMsId001("");
    expect(found).toEqual([]);
    expect(warnings.some((w) => w.startsWith("MS-ID-001: ISM refs suggest Essentials IT.PRO-13.4"))).toBe(true);
  });

  it("warns when an e8-tagged question maps to no ISM control in the matching E8 profile", () => {
    const files = readContentFiles();
    const target = "content/platforms/microsoft/questions/identity.yaml";
    const gap = files[target].replace("    - { framework: ism, ref: ISM-1504 }\n", "");
    expect(loadCatalogue(files).warnings).not.toContain("MS-ID-001: e8 mfa ML1 maps to no ISM control in the E8 ML1 profile");
    const { errors, warnings } = loadCatalogue({ ...files, [target]: gap });
    expect(warnings).toContain("MS-ID-001: e8 mfa ML1 maps to no ISM control in the E8 ML1 profile");
    // The gap is a warning, not an error: the Essential Eight tag and the question stand on their own.
    expect(errors).toEqual([]);
  });
  it("rejects unknown keys, so a renamed key can't silently drop mappings", () => {
    const files = readContentFiles();
    const target = "content/platforms/microsoft/questions/identity.yaml";
    const renamed = files[target].replace(/^ {2}refs:/m, "  ref:").replace(/^ {2}e8:/m, "  E8:");
    const { errors: found } = loadCatalogue({ ...files, [target]: renamed });
    expect(found.filter((e) => e.startsWith(`${target}: `)).join("\n")).toMatch(/Unrecognized keys: "ref", "E8"/);
  });

  it("rejects a duplicate platform id, a platform outside its own directory and a duplicate import mapping id", () => {
    const files = readContentFiles();
    const copy = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("content/platforms/aws/")).map(([p, t]) => [p.replace("/aws/", "/aws2/"), t]));
    const { errors: found } = loadCatalogue({
      ...files,
      ...copy,
      "content/imports/zz-copy.yaml": files["content/imports/prowler-aws.yaml"],
    });
    expect(found).toContain("content/platforms/aws2/platform.yaml: id aws does not match its directory aws2");
    expect(found).toContain("content/platforms/aws2/platform.yaml: duplicate platform id aws");
    expect(found).toContain("content/imports/zz-copy.yaml: duplicate import mapping id prowler-aws");
  });

  it("lists questions in id order and leaves them in place when taking the content digest", () => {
    const { catalogue: fresh } = loadCatalogue(readContentFiles());
    const before = [...fresh.platforms.values()].map((b) => b.questions.map((q) => q.id));
    for (const ids of before) expect(ids).toEqual(ids.slice().sort((x, y) => x.localeCompare(y)));
    const reversed = new Map([...fresh.platforms].map(([id, b]) => [id, { ...b, questions: b.questions.slice().reverse() }]));
    const order = [...reversed.values()].map((b) => b.questions.map((q) => q.id));
    expect(contentDigest({ ...fresh, platforms: reversed })).toBe(contentDigest(fresh));
    expect([...reversed.values()].map((b) => b.questions.map((q) => q.id))).toEqual(order);
  });
});
