import type { Catalogue, Question } from "../content/schema";
import type { Answer } from "./types";

/**
 * The ISM baselines an assessor can annotate a report with, matching ASD's OSCAL baseline profiles. Each maps to the
 * ISM's own `applicability` code on every control in `content/frameworks/ism.yaml`. Annotation only: choosing a
 * baseline never changes a score, it marks which findings touch controls the baseline includes.
 */
export const ismBaselines = {
  NON_CLASSIFIED: { label: "NON_CLASSIFIED", applicability: "NC" },
  OFFICIAL_SENSITIVE: { label: "OFFICIAL: Sensitive", applicability: "OS" },
  PROTECTED: { label: "PROTECTED", applicability: "P" },
} as const;
export type IsmBaseline = keyof typeof ismBaselines;

/** One open finding and the ISM controls in the chosen baseline it relates to. */
export interface IsmFinding {
  question: Question;
  /** Display ids, e.g. ISM-1504. */
  controls: string[];
}

export interface IsmBaselineSummary {
  baseline: IsmBaseline;
  label: string;
  /** Findings not fully in place that touch at least one control in the baseline. */
  findings: IsmFinding[];
  /** Every finding not fully in place, so the summary can say "4 of 9 findings". */
  totalFindings: number;
  /** Distinct mapped ISM controls the baseline includes, across all in-scope questions. */
  controls: number;
}

/** Questions that appear in the findings section: anything not answered Yes or N/A. */
const isFinding = (q: Question, answers: Record<string, Answer>) => !["yes", "na"].includes(answers[q.id] ?? "");

/**
 * Which open findings touch the chosen ISM baseline. Reads only the `applicability` prop carried on each generated
 * ISM control, so it needs no extra files, and it never touches scoring.
 */
export function ismBaselineReport(
  catalogue: Catalogue,
  questions: Question[],
  answers: Record<string, Answer>,
  baseline: IsmBaseline,
): IsmBaselineSummary {
  const { label, applicability } = ismBaselines[baseline];
  const ism = catalogue.frameworks.get("ism");
  const inBaseline = new Map(
    (ism?.controls ?? [])
      .filter((c) => c.applicability?.includes(applicability))
      .map((c) => [c.id, c] as const),
  );
  const findings: IsmFinding[] = [];
  for (const q of questions) {
    if (!isFinding(q, answers)) continue;
    const controls = q.refs.filter((r) => r.framework === "ism" && inBaseline.has(r.ref)).map((r) => r.ref);
    if (controls.length) findings.push({ question: q, controls });
  }
  const mapped = new Set(
    questions.flatMap((q) => q.refs.filter((r) => r.framework === "ism" && inBaseline.has(r.ref)).map((r) => r.ref)),
  );
  return {
    baseline,
    label,
    findings,
    totalFindings: questions.filter((q) => isFinding(q, answers)).length,
    controls: mapped.size,
  };
}
