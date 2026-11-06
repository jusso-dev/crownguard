import { severities, type Catalogue, type Question, type Severity } from "../content/schema";
import type { Answer } from "../format/vocab";
import type { Assessment, CrownJewel } from "../format/schema";

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

/** Fully in place or justified as not applicable: the answers that leave nothing to fix. */
export const isSatisfied = (a: Answer | undefined) => a === "yes" || a === "na";
export const isGap = (a: Answer | undefined) => !isSatisfied(a);

/** How far a group of questions is met, from their answers. N/A answers are left out. */
export function metStatus(answers: (Answer | undefined)[]): "Met" | "Partly met" | "Not met" | "Not applicable" {
  const v = answers.map(answerValue).filter((x): x is number => x !== null);
  if (!v.length) return "Not applicable";
  if (v.every((x) => x === 1)) return "Met";
  if (v.some((x) => x > 0)) return "Partly met";
  return "Not met";
}

/** Answers and the notes beside them: an assessment's Controls answers, or one AI register entry's. */
type Answered = { answers: Record<string, Answer>; notes: Record<string, string> };

/** N/A must be justified. Without a reason it doesn't count as an answer, so it is scored as a gap. */
export const needsReason = (a: Answered, questionId: string) => a.answers[questionId] === "na" && !a.notes[questionId]?.trim();

/** The answers the scoring uses: unjustified N/A answers are dropped (treated as unanswered). */
export function effectiveAnswers(a: Answered): Record<string, Answer> {
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

/** The selected platform a question belongs to. Questions are shared by reference with their platform bundle. */
export const questionPlatform = (catalogue: Catalogue, platforms: string[]) => (q: Question) =>
  platforms.find((pid) => catalogue.platforms.get(pid)?.questions.includes(q));

/** Pass only the jewel's own platform's questions: platform-wide ("*") questions match every asset type. */
export function questionsForJewel(jewel: CrownJewel, questions: Question[]): Question[] {
  return questions.filter((q) => q.appliesTo.includes(jewel.assetType) || q.appliesTo.includes("*"));
}

/** Anything scored by severity: platform control questions and AI readiness questions. */
type Weighted = { id: string; severity: Severity };

interface GapStats {
  /** Total severity weight of non-N/A questions. */
  weight: number;
  /** Weighted shortfall: sum of weight × (1 − value). */
  gap: number;
  unknownWeight: number;
  /** Weight of questions with any answer, including Unknown. */
  answeredWeight: number;
}

export function gapStats(questions: Weighted[], answers: Record<string, Answer>): GapStats {
  const s: GapStats = { weight: 0, gap: 0, unknownWeight: 0, answeredWeight: 0 };
  for (const q of questions) {
    const a = answers[q.id];
    const v = answerValue(a);
    if (v === null) continue;
    const w = severities[q.severity];
    s.weight += w;
    s.gap += w * (1 - v);
    if (a === undefined || a === "unknown") s.unknownWeight += w;
    if (a !== undefined) s.answeredWeight += w;
  }
  return s;
}

/** Weighted compliance 0–1, or null when every question is N/A. */
export const scoreOf = (s: GapStats): number | null => (s.weight === 0 ? null : 1 - s.gap / s.weight);
/** Share of question weight with a real answer (not unknown/unanswered), 0–1. */
export const confidenceOf = (s: GapStats): number => (s.weight === 0 ? 0 : 1 - s.unknownWeight / s.weight);

export const bySeverity = (a: Weighted, b: Weighted) => severities[b.severity] - severities[a.severity] || a.id.localeCompare(b.id);

export const maxImpact = (j: Pick<CrownJewel, "confidentiality" | "integrity" | "availability">) => Math.max(j.confidentiality, j.integrity, j.availability);

const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

export function impactOf(j: CrownJewel): number {
  const base = maxImpact(j);
  const uplift = j.regulations.length > 0 || j.classification === "highly-confidential" ? 1 : 0;
  return Math.min(5, base + uplift);
}

/**
 * Likelihood 1–5: 1 + 4 × weighted gap ratio, +0.5 per exposure flag.
 * Any open critical-severity gap floors likelihood at 3 ("Possible").
 */
export function likelihoodOf(stats: Pick<GapStats, "weight" | "gap">, exposureCount: number, openCritical: boolean): number {
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
    confidence: confidenceOf(stats),
    gaps,
  };
}

export function assessAll(catalogue: Catalogue, assessment: Assessment): JewelRisk[] {
  const questions = activeQuestions(catalogue, assessment);
  const platformOf = questionPlatform(catalogue, assessment.platforms);
  const answers = effectiveAnswers(assessment);
  return assessment.jewels
    .filter((j) => assessment.platforms.includes(j.platform))
    .map((j) => assessJewel(j, questions.filter((q) => platformOf(q) === j.platform), answers))
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
          score: scoreOf(s),
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
  return { score: scoreOf(s), confidence: confidenceOf(s) };
}
