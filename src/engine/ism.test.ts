import { describe, expect, it } from "vitest";
import type { Catalogue, Framework, Question } from "../content/schema";
import { ismBaselineReport, ismBaselines } from "./ism";
import type { Answer } from "./types";

const control = (id: string, applicability?: string[], e8?: string[]): Framework["controls"][number] => ({
  id,
  title: `${id} does something sensible`,
  ...(applicability ? { applicability } : {}),
  ...(e8 ? { e8: e8 as never } : {}),
});

const ism: Framework = {
  id: "ism",
  name: "Australian Government Information Security Manual",
  shortName: "ISM",
  publisher: "Australian Signals Directorate",
  source: "asd-ism",
  sources: [],
  closed: true,
  withdrawn: [],
  controls: [control("ISM-1", ["NC", "OS", "P"]), control("ISM-2", ["P"]), control("ISM-3", ["S", "TS"]), control("ISM-4")],
};

const catalogue: Catalogue = {
  sources: new Map(),
  frameworks: new Map([["ism", ism]]),
  platforms: new Map(),
  imports: new Map(),
};

const q = (id: string, refs: string[], over: Partial<Question> = {}): Question => ({
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
  refs: refs.map((ref) => ({ framework: "ism", ref })),
  e8: [],
  ...over,
});

describe("the ISM baseline annotation", () => {
  const questions = [q("MS-ID-001", ["ISM-1", "ISM-2"]), q("MS-ID-002", ["ISM-3"]), q("MS-ID-003", ["ISM-4"]), q("MS-ID-004", [])];
  const answers: Record<string, Answer> = { "MS-ID-001": "no", "MS-ID-002": "partial", "MS-ID-003": "no", "MS-ID-004": "no" };

  it("includes a control in every baseline its applicability lists, and no others", () => {
    for (const baseline of ["NON_CLASSIFIED", "OFFICIAL_SENSITIVE", "PROTECTED"] as const) {
      const r = ismBaselineReport(catalogue, questions, answers, baseline);
      expect(r.controls, baseline).toBe(baseline === "PROTECTED" ? 2 : 1);
      expect(r.findings.map((f) => f.question.id), baseline).toEqual(["MS-ID-001"]);
    }
    // SECRET-only and applicability-free controls sit outside all three public baselines.
    const protectedRun = ismBaselineReport(catalogue, questions, answers, "PROTECTED");
    expect(protectedRun.findings[0].controls).toEqual(["ISM-1", "ISM-2"]);
    // The findings count is every open finding, so the summary can say "1 of 4".
    expect(protectedRun.totalFindings).toBe(4);
  });

  it("annotates only findings that are not fully in place, and only with baseline controls", () => {
    const settled = { ...answers, "MS-ID-001": "yes" as Answer };
    const r = ismBaselineReport(catalogue, questions, settled, "PROTECTED");
    expect(r.findings).toEqual([]);
    expect(r.totalFindings).toBe(3);
    // A question with no ISM refs, or only ones outside the baseline, is never annotated.
    const all = ismBaselineReport(catalogue, questions, answers, "NON_CLASSIFIED");
    expect(all.findings.map((f) => f.question.id)).toEqual(["MS-ID-001"]);
  });

  it("offers the three public baselines and nothing classified", () => {
    expect(Object.values(ismBaselines).map((b) => b.label)).toEqual(["NON_CLASSIFIED", "OFFICIAL: Sensitive", "PROTECTED"]);
    expect(Object.values(ismBaselines).map((b) => b.applicability)).toEqual(["NC", "OS", "P"]);
  });
});
