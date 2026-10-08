import { severities, type Catalogue, type Question } from "../content/schema";
import type { Answer, Assessment, CrownJewel } from "./types";

export type Band = "Low" | "Medium" | "High" | "Extreme";

/** Score credited for an answer. Unknown and unanswered never count as compliant. N/A is excluded. */
export function answerValue(a: Answer | undefined): number | null {
  switch (a) {
    case "yes":
      return 1;
    case "partial":
      return 0.5;
    case "na":
      return null;
    default:
      return 0;
  }
}

export const isGap = (a: Answer | undefined) => a !== "yes" && a !== "na";

/** N/A must be justified. Without a reason it doesn't count as an answer, so it is scored as a gap. */
export const needsReason = (a: Assessment, questionId: string) => a.answers[questionId] === "na" && !a.notes[questionId]?.trim();

/** The answers the scoring uses: unjustified N/A answers are dropped (treated as unanswered). */
export function effectiveAnswers(a: Assessment): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, ans] of Object.entries(a.answers)) if (!needsReason(a, id)) out[id] = ans;
  return out;
}

/**
 * Questions in scope: selected platforms, core module plus enabled optional modules,
 * and either platform-wide ("*") or protecting at least one recorded crown jewel.
 */
export function activeQuestions(catalogue: Catalogue, assessment: Assessment): Question[] {
  return assessment.platforms.flatMap((pid) => {
    const bundle = catalogue.platforms.get(pid);
    if (!bundle) return [];
    const enabled = new Set(
      bundle.platform.modules.filter((m) => !m.optional || assessment.modules[pid]?.includes(m.id)).map((m) => m.id),
    );
    const jewelTypes = new Set(assessment.jewels.filter((j) => j.platform === pid).map((j) => j.assetType));
    return bundle.questions.filter(
      (q) => enabled.has(q.module) && q.appliesTo.some((a) => a === "*" || jewelTypes.has(a)),
    );
  });
}

export function questionsForJewel(jewel: CrownJewel, questions: Question[]): Question[] {
  return questions.filter((q) => q.appliesTo.includes(jewel.assetType) || q.appliesTo.includes("*"));
}

export interface GapStats {
  /** Total severity weight of non-N/A questions. */
  weight: number;
  /** Weighted shortfall: sum of weight × (1 − value). */
  gap: number;
  unknownWeight: number;
}

export function gapStats(questions: Question[], answers: Record<string, Answer>): GapStats {
  const s: GapStats = { weight: 0, gap: 0, unknownWeight: 0 };
  for (const q of questions) {
    const a = answers[q.id];
    const v = answerValue(a);
    if (v === null) continue;
    const w = severities[q.severity];
    s.weight += w;
    s.gap += w * (1 - v);
    if (a === undefined || a === "unknown") s.unknownWeight += w;
  }
  return s;
}

const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

export function impactOf(j: CrownJewel): number {
  const base = Math.max(j.confidentiality, j.integrity, j.availability);
  const uplift = j.regulations.length > 0 || j.classification === "highly-confidential" ? 1 : 0;
  return Math.min(5, base + uplift);
}

/**
 * Likelihood 1–5: 1 + 4 × weighted gap ratio, +0.5 per exposure flag.
 * Any open critical-severity gap floors likelihood at 3 ("Possible").
 */
export function likelihoodOf(stats: GapStats, exposureCount: number, openCritical: boolean): number {
  const ratio = stats.weight === 0 ? 0 : stats.gap / stats.weight;
  const raw = 1 + 4 * ratio + 0.5 * exposureCount;
  return clamp(openCritical ? Math.max(raw, 3) : raw);
}

export function bandOf(score: number): Band {
  if (score >= 20) return "Extreme";
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

export interface JewelRisk {
  jewel: CrownJewel;
  impact: number;
  likelihood: number;
  score: number;
  band: Band;
  /** Share of question weight with a real answer (not unknown/unanswered), 0–1. */
  confidence: number;
  gaps: { question: Question; answer: Answer | undefined }[];
}

const bySeverity = (a: Question, b: Question) => severities[b.severity] - severities[a.severity] || a.id.localeCompare(b.id);

export function assessJewel(jewel: CrownJewel, questions: Question[], answers: Record<string, Answer>): JewelRisk {
  const relevant = questionsForJewel(jewel, questions);
  const stats = gapStats(relevant, answers);
  const gaps = relevant
    .filter((q) => isGap(answers[q.id]))
    .sort(bySeverity)
    .map((question) => ({ question, answer: answers[question.id] }));
  const openCritical = gaps.some((g) => g.question.severity === "critical");
  const impact = impactOf(jewel);
  const likelihood = likelihoodOf(stats, jewel.exposures.length, openCritical);
  const score = impact * likelihood;
  return {
    jewel,
    impact,
    likelihood,
    score,
    band: bandOf(score),
    confidence: stats.weight === 0 ? 0 : 1 - stats.unknownWeight / stats.weight,
    gaps,
  };
}

export function assessAll(catalogue: Catalogue, assessment: Assessment): JewelRisk[] {
  const questions = activeQuestions(catalogue, assessment);
  return assessment.jewels
    .filter((j) => assessment.platforms.includes(j.platform))
    .map((j) => assessJewel(j, questions, effectiveAnswers(assessment)))
    .sort((a, b) => b.score - a.score || b.impact - a.impact);
}

export interface DomainPosture {
  platform: string;
  domain: string;
  name: string;
  /** Weighted compliance 0–1, or null when every question is N/A. */
  score: number | null;
  questions: number;
  gaps: number;
  unknown: number;
}

export function domainPosture(catalogue: Catalogue, assessment: Assessment): DomainPosture[] {
  const questions = activeQuestions(catalogue, assessment);
  const answers = effectiveAnswers(assessment);
  return assessment.platforms.flatMap((pid) => {
    const bundle = catalogue.platforms.get(pid);
    if (!bundle) return [];
    return bundle.platform.domains
      .map((d) => {
        const qs = questions.filter((q) => q.domain === d.id && bundle.questions.includes(q));
        const s = gapStats(qs, answers);
        return {
          platform: pid,
          domain: d.id,
          name: d.name,
          score: s.weight === 0 ? null : 1 - s.gap / s.weight,
          questions: qs.length,
          gaps: qs.filter((q) => isGap(answers[q.id])).length,
          unknown: qs.filter((q) => (answers[q.id] ?? "unknown") === "unknown").length,
        };
      })
      .filter((d) => d.questions > 0);
  });
}

export function overallPosture(catalogue: Catalogue, assessment: Assessment): { score: number | null; confidence: number } {
  const s = gapStats(activeQuestions(catalogue, assessment), effectiveAnswers(assessment));
  if (s.weight === 0) return { score: null, confidence: 0 };
  return { score: 1 - s.gap / s.weight, confidence: 1 - s.unknownWeight / s.weight };
}
