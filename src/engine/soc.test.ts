import { describe, expect, it } from "vitest";
import type { SocModel, SocQuestion } from "../content/schema";
import { levelFor, socMaturity } from "./soc";

const level = (n: number, name: string) => ({ level: n, name, description: `Level ${n} looks like this.` });
const model = {
  id: "soc",
  name: "SOC maturity",
  shortName: "SOC maturity",
  source: "soc-cmm",
  licence: "CC BY-SA 4.0",
  licenceSource: "cc-by-sa-4",
  sources: [],
  basisVersion: "2.4.2",
  attribution: "Structure from the SOC-CMM model, licensed CC BY-SA 4.0.",
  scales: {
    maturity: ["Non-existent", "Initial", "Managed", "Defined", "Quantitatively managed", "Optimising"].map((n, i) => level(i, n)),
    capability: ["Incomplete", "Performed", "Managed", "Defined"].map((n, i) => level(i, n)),
  },
  targets: { maturity: 3, capability: 2 },
  domains: [
    {
      id: "business",
      name: "Business",
      description: "Why the SOC exists.",
      scopable: false,
      capability: false,
      aspects: ["drivers", "customers", "charter", "governance", "privacy"].map((id) => ({ id, name: id })),
    },
    {
      id: "technology",
      name: "Technology",
      description: "The platforms the SOC runs.",
      scopable: true,
      capability: true,
      aspects: ["log", "network", "endpoint", "secops"].map((id) => ({ id, name: id })),
    },
  ],
} satisfies SocModel;

const q = (id: string, aspect: string, kind: SocQuestion["kind"] = "maturity"): SocQuestion => ({
  id,
  aspect,
  kind,
  question: "How well is this done?",
  why: "Because it matters to the SOC.",
  levels: Array.from({ length: kind === "maturity" ? 6 : 4 }, (_, i) => `${aspect} at level ${i}`),
  refs: [],
});
const questions = [
  ...["drivers", "customers", "charter", "governance", "privacy"].map((a, i) => q(`SOC-BUS-00${i + 1}`, a)),
  ...["log", "network", "endpoint", "secops"].flatMap((a, i) => [q(`SOC-TEC-00${2 * i + 1}`, a), q(`SOC-TEC-00${2 * i + 2}`, a, "capability")]),
];
const business = { "SOC-BUS-001": 3, "SOC-BUS-002": 2, "SOC-BUS-003": 3, "SOC-BUS-004": 2, "SOC-BUS-005": 1 } as const;
const technology = { "SOC-TEC-001": 3, "SOC-TEC-002": 2, "SOC-TEC-005": 4, "SOC-TEC-006": 2, "SOC-TEC-007": 1, "SOC-TEC-008": 1 } as const;

describe("socMaturity", () => {
  it("scores domains as the unweighted mean of their in-scope aspects, with capability alongside", () => {
    const r = socMaturity(model, questions, { answers: { ...business, ...technology }, outOfScope: ["network"] });
    const [bus, tec] = r.domains;
    expect(bus).toMatchObject({ maturity: 2.2, capability: null, target: { maturity: 3 } });
    expect(tec).toMatchObject({ maturity: 2.67, capability: 1.67, target: { maturity: 3, capability: 2 } });
    expect(tec.aspects.find((a) => a.id === "network")).toMatchObject({ inScope: false, maturity: null, capability: null });
    expect(levelFor(model.scales.maturity, bus.maturity!).name).toBe("Managed");
    expect(r.overall).toBe(2.44);
    expect(r).toMatchObject({ answered: 11, unknown: 0, total: 11, confidence: 1, overallTarget: 3 });
  });

  it("scores Unknown, unanswered and out-of-range answers as 0 and lowers confidence", () => {
    const r = socMaturity(model, questions, { answers: { ...business, ...technology, "SOC-TEC-007": "unknown", "SOC-TEC-008": 5 }, outOfScope: ["network"] });
    expect(r.domains[1].maturity).toBe(2.33);
    expect(r.domains[1].aspects.find((a) => a.id === "secops")).toMatchObject({ maturity: 0, capability: 0, unknown: 1 });
    expect(r).toMatchObject({ answered: 10, unknown: 1, total: 11, confidence: 0.82 });
  });

  it("leaves a domain unassessed when every aspect is out of scope", () => {
    const r = socMaturity(model, questions, { answers: business, outOfScope: ["log", "network", "endpoint", "secops"] });
    expect(r.domains[1]).toMatchObject({ maturity: null, capability: null });
    expect(r.overall).toBe(2.2);
    expect(r.total).toBe(5);
  });

  it("ignores scope-outs in domains that can't be scoped", () => {
    const r = socMaturity(model, questions, { answers: business, outOfScope: ["charter"] });
    expect(r.domains[0].maturity).toBe(2.2);
  });

  it("lists aspects below target, largest gap first in model order, with what the next level looks like", () => {
    const r = socMaturity(model, questions, { answers: { ...business, ...technology }, outOfScope: ["network"], targets: { business: { maturity: 2.5 } } });
    expect(r.domains[0].target.maturity).toBe(2.5);
    expect(r.priorities.map((p) => [p.aspect.id, p.gap])).toEqual([
      ["secops", 2],
      ["privacy", 1.5],
      ["customers", 0.5],
      ["governance", 0.5],
    ]);
    expect(r.priorities[0].next).toEqual({ level: 2, name: "Managed", description: "secops at level 2" });
    expect(r.capabilityGaps.map((p) => [p.aspect.id, p.score, p.next?.name])).toEqual([["secops", 1, "Managed"]]);
    expect(r.overallTarget).toBe(2.75);
  });

  it("names the level a score falls in without rounding up", () => {
    expect([0, 1.2, 2.6, 2.99, 3, 4.5, 5].map((s) => levelFor(model.scales.maturity, s).level)).toEqual([0, 1, 2, 2, 3, 4, 5]);
    expect(levelFor(model.scales.capability, 2.67).name).toBe("Managed");
  });
});
