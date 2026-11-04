import { describe, expect, it } from "vitest";
import type { Framework, Question } from "../content/schema";
import { actionRating, domainPercentage, essentials, principleRating, transitionGaps, type EssentialsEvidence, type EssentialsRating } from "./essentials";
import type { Answer } from "./types";

const q = (id: string, over: Partial<Question> = {}): Question => ({
  id,
  module: "core",
  domain: "identity",
  appliesTo: ["tenant"],
  severity: "high",
  question: "Is it done?",
  why: "Because it matters a great deal.",
  yesLooksLike: "It is done.",
  remediation: "Do it properly and soon.",
  effort: "S",
  licence: [],
  sources: ["src"],
  refs: [],
  e8: [],
  essentials: [],
  ...over,
});

const ev = (answer: Answer | undefined, coverage: "full" | "partial" = "partial"): EssentialsEvidence => ({ question: q("MS-ID-001"), answer, coverage });

const chapter: Framework = {
  id: "asd-essentials-enterprise-it",
  name: "ASD Essentials for enterprise IT",
  shortName: "Essentials (enterprise IT)",
  publisher: "Australian Signals Directorate",
  source: "src",
  sources: [],
  closed: true,
  withdrawn: [],
  essentials: {
    chapter: "enterprise-it",
    release: "v2026.10.15",
    provisional: false,
    domains: [
      { id: "GC", name: "Governance and culture", type: "capability", phases: [1, 2, 3] },
      { id: "UD", name: "User devices", type: "technical", phases: [3] },
      { id: "IS", name: "Identity services", type: "technical", phases: [1] },
      { id: "BS", name: "Boundary services", type: "technical", phases: [1] },
    ],
    principles: [
      { id: "PRO-13", name: "Identity, credential and access management" },
      { id: "PRO-06", name: "Vulnerability management" },
      { id: "GOV-01", name: "Executive cyber security accountability" },
    ],
  },
  controls: [
    { id: "IT.PRO-13.4", title: "Use phishing-resistant MFA", principle: "PRO-13", domains: ["IS", "BS", "UD"] },
    { id: "IT.PRO-13.5", title: "Disable legacy authentication", principle: "PRO-13", domains: ["IS", "UD"] },
    { id: "IT.PRO-06.2", title: "Apply patches", principle: "PRO-06", domains: ["UD", "BS"] },
    { id: "IT.GOV-01.1", title: "Executive accountability", principle: "GOV-01", domains: ["GC"] },
  ],
};

describe("Essentials action ratings", () => {
  it("is not effective when any tagged question is No", () => expect(actionRating([ev("yes", "full"), ev("no")])).toBe("not-effective"));
  it("is fully effective only with a Yes that covers the whole action", () => {
    expect(actionRating([ev("yes", "full"), ev("na")])).toBe("fully-effective");
    expect(actionRating([ev("yes"), ev("yes")])).toBe("partially-effective");
  });
  it("caps Partial at partially effective", () => expect(actionRating([ev("yes", "full"), ev("partial")])).toBe("partially-effective"));
  it("never counts Unknown as effective, nor as not effective on its own", () => {
    expect(actionRating([ev("unknown")])).toBe("not-assessed");
    expect(actionRating([ev(undefined), ev("unknown")])).toBe("not-assessed");
    expect(actionRating([ev("yes", "full"), ev("unknown")])).toBe("partially-effective");
  });
  it("is not assessed with no evidence, and does not apply when everything is N/A", () => {
    expect(actionRating([])).toBe("not-assessed");
    expect(actionRating([ev("na"), ev("na")])).toBeNull();
  });
});

describe("Essentials principles and domains", () => {
  it("takes the weakest link", () => {
    expect(principleRating(["fully-effective", "not-effective", "not-assessed"])).toBe("not-effective");
    expect(principleRating(["fully-effective", "partially-effective"])).toBe("partially-effective");
    expect(principleRating(["fully-effective", "not-assessed"])).toBe("not-assessed");
    expect(principleRating(["fully-effective", null])).toBe("fully-effective");
    expect(principleRating([null])).toBeNull();
  });

  it("reproduces ASD's worked example: 5 FE, 4 PE and 1 NE gives 70%", () => {
    const ratings: EssentialsRating[] = [...Array(5).fill("fully-effective"), ...Array(4).fill("partially-effective"), "not-effective"];
    expect(domainPercentage(ratings).percentage).toBe(70);
  });

  it("leaves not assessed principles out of the percentage and shows a domain with none assessed as not assessed, not 0%", () => {
    const { percentage, counts } = domainPercentage(["fully-effective", "not-assessed", "not-assessed"]);
    expect(percentage).toBe(100);
    expect(counts["not-assessed"]).toBe(2);
    expect(domainPercentage(["not-assessed"]).percentage).toBeNull();
    expect(domainPercentage([]).percentage).toBeNull();
  });
});

describe("essentials()", () => {
  const mfa = q("MS-ID-001", { essentials: [{ action: "IT.PRO-13.4", domains: ["IS"], coverage: "full", note: "Phishing-resistant strength for every user." }] });
  const legacy = q("MS-ID-002", { essentials: [{ action: "IT.PRO-13.5", domains: ["IS"], coverage: "partial" }] });
  const patch = q("MS-END-001", { essentials: [{ action: "IT.PRO-06.2", domains: ["UD"], coverage: "partial" }], e8: [{ strategy: "patch-applications", level: 1 }] });

  it("orders domains phase 1 technical first, capability last, and keeps the questions behind each action", () => {
    const r = essentials(chapter, [mfa, legacy, patch], { "MS-ID-001": "yes", "MS-ID-002": "no", "MS-END-001": "partial" });
    expect(r.domains.map((d) => d.id)).toEqual(["IS", "BS", "UD", "GC"]);
    const is = r.domains[0];
    expect(is.principles).toHaveLength(1);
    expect(is.principles[0].rating).toBe("not-effective");
    expect(is.principles[0].actions.map((a) => [a.id, a.rating])).toEqual([
      ["IT.PRO-13.4", "fully-effective"],
      ["IT.PRO-13.5", "not-effective"],
    ]);
    expect(is.principles[0].actions[0].evidence[0].question.id).toBe("MS-ID-001");
    expect(is.percentage).toBe(0);
    // Boundary services has actions but no tagged questions: everything not assessed, no percentage.
    expect(r.domains[1].percentage).toBeNull();
    expect(r.domains[1].counts["not-assessed"]).toBe(2);
    expect(r.domains[2].principles.find((p) => p.id === "PRO-06")?.rating).toBe("partially-effective");
    expect(r.tagged).toBe(3);
  });

  it("never changes when an Essential Eight level changes", () => {
    const answers: Record<string, Answer> = { "MS-ID-001": "yes", "MS-ID-002": "yes", "MS-END-001": "yes" };
    const before = essentials(chapter, [mfa, legacy, patch], answers);
    const bumped = { ...patch, e8: [{ strategy: "patch-applications" as const, level: 3 as const }] };
    const after = essentials(chapter, [mfa, legacy, bumped], answers);
    const strip = (r: typeof before) => r.domains.map((d) => [d.id, d.percentage, d.principles.map((p) => [p.id, p.rating, p.actions.map((a) => a.rating)])]);
    expect(strip(after)).toEqual(strip(before));
  });

  it("names the E8 strategies behind each principle and gives a gap class only where something was assessed", () => {
    const r = essentials(chapter, [mfa, legacy, patch], { "MS-ID-001": "yes", "MS-ID-002": "yes", "MS-END-001": "no" });
    const gaps = transitionGaps(r);
    expect(gaps.find((g) => g.principle === "PRO-13")).toMatchObject({ strategies: ["mfa", "restrict-admin-privileges"] });
    expect(gaps.find((g) => g.principle === "PRO-06")?.gap).toBe("not-addressed");
    const gov = gaps.find((g) => g.principle === "GOV-01")!;
    expect(gov.strategies).toEqual([]);
    expect(gov.gap).toBeNull();
    // Principles with no Essential Eight equivalent sort last.
    expect(gaps[gaps.length - 1].principle).toBe("GOV-01");
  });
});
