import { describe, expect, it } from "vitest";
import type { Question } from "../content/schema";
import { essentialEight } from "./maturity";
import { assessJewel, bandOf, gapStats, impactOf, likelihoodOf } from "./risk";
import { buildRoadmap } from "./roadmap";
import type { CrownJewel } from "./types";

const q = (id: string, over: Partial<Question> = {}): Question => ({
  id,
  module: "core",
  domain: "identity",
  appliesTo: ["tenant"],
  severity: "high",
  question: "Is it done?",
  why: "Because it matters a great deal.",
  yesLooksLike: "It is done properly.",
  remediation: "Do the thing properly, everywhere.",
  effort: "M",
  licence: [],
  sources: ["src"],
  refs: [],
  e8: [],
  ...over,
});

const jewel = (over: Partial<CrownJewel> = {}): CrownJewel => ({
  id: "j1",
  name: "Tenant",
  platform: "microsoft",
  assetType: "tenant",
  description: "",
  classification: "confidential",
  confidentiality: 4,
  integrity: 3,
  availability: 2,
  regulations: [],
  exposures: [],
  businessProcesses: "",
  ...over,
});

describe("scoring", () => {
  it("never counts unknown or unanswered as compliant", () => {
    const qs = [q("MS-ID-001"), q("MS-ID-002"), q("MS-ID-003")];
    const s = gapStats(qs, { "MS-ID-001": "yes", "MS-ID-002": "unknown" });
    expect(s.weight).toBe(9);
    expect(s.gap).toBe(6);
    expect(s.unknownWeight).toBe(6);
  });

  it("excludes N/A from the denominator", () => {
    const s = gapStats([q("MS-ID-001"), q("MS-ID-002")], { "MS-ID-001": "yes", "MS-ID-002": "na" });
    expect(s).toEqual({ weight: 3, gap: 0, unknownWeight: 0 });
  });

  it("uplifts impact for regulated or highly confidential data, capped at 5", () => {
    expect(impactOf(jewel())).toBe(4);
    expect(impactOf(jewel({ regulations: ["privacy-act"] }))).toBe(5);
    expect(impactOf(jewel({ confidentiality: 5, classification: "highly-confidential" }))).toBe(5);
  });

  it("maps gap ratio and exposures onto likelihood", () => {
    expect(likelihoodOf({ weight: 10, gap: 0, unknownWeight: 0 }, 0, false)).toBe(1);
    expect(likelihoodOf({ weight: 10, gap: 10, unknownWeight: 0 }, 0, false)).toBe(5);
    expect(likelihoodOf({ weight: 10, gap: 5, unknownWeight: 0 }, 2, false)).toBe(4);
    expect(likelihoodOf({ weight: 10, gap: 0, unknownWeight: 0 }, 0, true)).toBe(3);
  });

  it("bands the 5x5 matrix", () => {
    expect([1, 4, 5, 9, 10, 16, 20, 25].map(bandOf)).toEqual([
      "Low", "Low", "Medium", "Medium", "High", "High", "Extreme", "Extreme",
    ]);
  });

  it("scores a crown jewel end to end", () => {
    const qs = [
      q("MS-ID-001", { severity: "critical" }),
      q("MS-ID-002"),
      q("MS-ID-003", { appliesTo: ["other"] }),
      q("MS-ID-004", { appliesTo: ["*"], severity: "low" }),
    ];
    const r = assessJewel(jewel({ exposures: ["guest-access"] }), qs, { "MS-ID-001": "no", "MS-ID-002": "yes", "MS-ID-004": "yes" });
    expect(r.gaps.map((g) => g.question.id)).toEqual(["MS-ID-001"]);
    expect(r.impact).toBe(4);
    // ratio 4/8 → 3, +0.5 exposure → 3.5 → 4
    expect(r.likelihood).toBe(4);
    expect(r.band).toBe("High");
    expect(r.confidence).toBe(1);
  });

  it("includes an aws-ai-agents finding at the question's severity", () => {
    const qs = [
      q("AWS-AI-001", { appliesTo: ["aws-ai-agents"], severity: "high", domain: "ai-agents" }),
      q("AWS-AI-004", { appliesTo: ["aws-ai-agents"], severity: "low", domain: "ai-agents" }),
      q("AWS-NET-008", { appliesTo: ["aws-workloads", "aws-ai-agents"], severity: "medium", domain: "network-workloads" }),
    ];
    const r = assessJewel(
      jewel({ platform: "aws", assetType: "aws-ai-agents", name: "Bedrock claims agent" }),
      qs,
      { "AWS-AI-001": "no", "AWS-AI-004": "yes", "AWS-NET-008": "yes" },
    );
    expect(r.gaps.map((g) => g.question.id)).toEqual(["AWS-AI-001"]);
    expect(r.gaps[0]?.question.severity).toBe("high");
    expect(r.band).not.toBe("Low");
  });
});

describe("essential eight", () => {
  it("requires every lower level before a higher one", () => {
    const qs = [
      q("MS-ID-001", { e8: [{ strategy: "mfa", level: 1 }] }),
      q("MS-ID-002", { e8: [{ strategy: "mfa", level: 2 }] }),
      q("MS-ID-003", { e8: [{ strategy: "mfa", level: 3 }] }),
    ];
    const mfa = (answers: Record<string, "yes" | "no">) => essentialEight(qs, answers).find((r) => r.strategy === "mfa")!;
    expect(mfa({ "MS-ID-001": "no", "MS-ID-002": "yes", "MS-ID-003": "yes" }).level).toBe(0);
    expect(mfa({ "MS-ID-001": "yes", "MS-ID-002": "no", "MS-ID-003": "yes" }).level).toBe(1);
    expect(mfa({ "MS-ID-001": "yes", "MS-ID-002": "yes", "MS-ID-003": "yes" }).level).toBe(3);
  });

  it("stops at an unassessed level and reports uncovered strategies as null", () => {
    const qs = [q("MS-ID-001", { e8: [{ strategy: "mfa", level: 1 }] }), q("MS-ID-002", { e8: [{ strategy: "mfa", level: 3 }] })];
    const results = essentialEight(qs, { "MS-ID-001": "yes", "MS-ID-002": "yes" });
    expect(results.find((r) => r.strategy === "mfa")).toMatchObject({ level: 1, ceiling: 3, unasked: 2 });
    expect(results.find((r) => r.strategy === "regular-backups")?.level).toBeNull();
  });

  it("passes through a level ASD defines with no new requirements (patching operating systems at ML2)", () => {
    const os = (qs: ReturnType<typeof q>[], answers: Record<string, "yes" | "no">) => essentialEight(qs, answers).find((r) => r.strategy === "patch-operating-systems")!;
    const ml1 = q("MS-END-005", { e8: [{ strategy: "patch-operating-systems", level: 1 }] });
    const ml3 = q("MS-END-010", { e8: [{ strategy: "patch-operating-systems", level: 3 }] });
    expect(os([ml1], { "MS-END-005": "yes" })).toMatchObject({ level: 2, ceiling: 2, unasked: null });
    expect(os([ml1, ml3], { "MS-END-005": "yes", "MS-END-010": "yes" })).toMatchObject({ level: 3, ceiling: 3 });
    expect(os([ml1, ml3], { "MS-END-005": "yes", "MS-END-010": "no" })).toMatchObject({ level: 2, blockers: [ml3] });
    expect(os([ml1, ml3], { "MS-END-005": "no", "MS-END-010": "yes" }).level).toBe(0);
  });
});

describe("roadmap", () => {
  it("orders by risk reduction per unit effort and fast-tracks critical gaps", () => {
    const qs = [
      q("MS-ID-001", { severity: "low", effort: "S" }),
      q("MS-ID-002", { severity: "high", effort: "S" }),
      q("MS-ID-003", { severity: "high", effort: "L" }),
      q("MS-ID-004", { severity: "critical", effort: "M" }),
      q("MS-ID-005", { severity: "medium", effort: "S" }),
      q("MS-ID-006", { severity: "low", effort: "L" }),
    ];
    const items = buildRoadmap(qs, [jewel()], { "MS-ID-005": "yes" });
    expect(items.map((i) => i.question.id)).toEqual(["MS-ID-002", "MS-ID-004", "MS-ID-001", "MS-ID-003", "MS-ID-006"]);
    expect(items.find((i) => i.question.id === "MS-ID-004")?.phase).toBe("0–30 days");
    expect(items.at(-1)?.phase).toBe("61–90 days");
  });
});
