import type { Catalogue, Question } from "../content/schema";
import { isGap } from "./risk";
import { ismBaselines, type Answer, type IsmBaseline } from "../format/vocab";


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

const isFinding = (q: Question, answers: Record<string, Answer>) => isGap(answers[q.id]);

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
