import type { SocModel, SocQuestion } from "../content/schema";

/** A rating against a question's level descriptions: 0-5 for maturity, 0-3 for capability. */
export type SocRating = 0 | 1 | 2 | 3 | 4 | 5;
export type SocAnswer = SocRating | "unknown";
/** Who runs the organisation's security operations. */
export type SocProvider = "in-house" | "outsourced" | "hybrid" | "none";

export const socProviders: Record<SocProvider, string> = {
  "in-house": "In house",
  outsourced: "Managed provider (MSSP or MDR)",
  hybrid: "Hybrid (in house and a provider)",
  none: "We don't have a SOC",
};

/** Per-domain overrides of the model's default targets. */
export type SocTargets = Record<string, { maturity?: number; capability?: number }>;

export interface SocInput {
  answers: Record<string, SocAnswer>;
  /** Technology and service aspects left out of scoring. */
  outOfScope: string[];
  targets?: SocTargets;
}

export interface SocAspectResult {
  id: string;
  name: string;
  domain: string;
  inScope: boolean;
  /** Mean maturity rating, 0-5, or null when out of scope. */
  maturity: number | null;
  /** Mean capability rating, 0-3, or null when out of scope or not rated for capability. */
  capability: number | null;
  /** Questions given a valid answer: a rating the question takes, or Unknown. */
  answered: number;
  unknown: number;
  total: number;
}

export interface SocDomainResult {
  id: string;
  name: string;
  /** Mean of the in-scope aspect maturities, or null when every aspect is out of scope. */
  maturity: number | null;
  /** Mean of the in-scope aspect capabilities (capability domains only). */
  capability: number | null;
  target: { maturity: number; capability?: number };
  aspects: SocAspectResult[];
}

export interface SocPriority {
  aspect: SocAspectResult;
  domain: string;
  kind: "maturity" | "capability";
  score: number;
  target: number;
  gap: number;
  /** The aspect's lowest-rated question of this kind, and the description of the level above its rating. */
  question: SocQuestion;
  rating: SocAnswer | undefined;
  next?: { level: number; name: string; description: string };
}

export interface SocResult {
  domains: SocDomainResult[];
  /** Mean of the assessed domain maturities. Indicative only: SOC-CMM itself reports no single score. */
  overall: number | null;
  overallTarget: number;
  answered: number;
  unknown: number;
  total: number;
  /** Share of in-scope questions given a rating rather than Unknown or no answer. */
  confidence: number;
  /** In-scope aspects below their domain's maturity target, largest gap first. */
  priorities: SocPriority[];
  /** In-scope aspects below their domain's capability target, largest gap first. */
  capabilityGaps: SocPriority[];
}

/** Two decimals, as SOC-CMM keeps; scores are never rounded to a whole level. */
const two = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const mean = (xs: (number | null)[]) => {
  const ns = xs.filter((x): x is number => x !== null);
  return ns.length ? two(ns.reduce((n, x) => n + x, 0) / ns.length) : null;
};

/** The highest rating a question takes: 5 for maturity, 3 for capability. */
export const maxRating = (q: SocQuestion) => q.levels.length - 1;

/** True for a rating the question takes; Unknown and out-of-range answers (say 5 on a 0-3 question) are not. */
export const isRating = (q: SocQuestion, answer: SocAnswer | undefined): answer is SocRating => typeof answer === "number" && answer <= maxRating(q);

/** The rating a question scores: Unknown, unanswered and out-of-range answers all score 0. */
export const ratingOf = (q: SocQuestion, answer: SocAnswer | undefined): number => (isRating(q, answer) ? answer : 0);

/** Level whose name describes a score: the floor of the score, so 2.6 is level 2, never rounded up. */
export function levelFor<L extends { level: number }>(scale: L[], score: number): L {
  return scale[Math.max(0, Math.min(scale.length - 1, Math.floor(score + 1e-9)))];
}

/**
 * Indicative SOC maturity. Each aspect scores the mean of its question ratings (maturity 0-5, and capability 0-3 for
 * technology and services); a domain scores the unweighted mean of its in-scope aspects, as in SOC-CMM's basic tool.
 * Unknown and unanswered questions score 0, the same "uncertainty is not protection" rule the rest of crownguard uses.
 */
export function socMaturity(model: SocModel, questions: SocQuestion[], input: SocInput): SocResult {
  const skipped = new Set(input.outOfScope);
  let answered = 0;
  let unknown = 0;
  let total = 0;
  let rated = 0;
  const priorities: SocPriority[] = [];
  const capabilityGaps: SocPriority[] = [];

  const domains = model.domains.map((d) => {
    const target = {
      maturity: input.targets?.[d.id]?.maturity ?? model.targets.maturity,
      ...(d.capability ? { capability: input.targets?.[d.id]?.capability ?? model.targets.capability } : {}),
    };
    const aspects = d.aspects.map((a): SocAspectResult => {
      const qs = questions.filter((q) => q.aspect === a.id);
      const inScope = !(d.scopable && skipped.has(a.id));
      // An out-of-range rating (say 5 on a 0-3 question, from a hand-edited file) counts as unanswered.
      const given = qs.filter((q) => input.answers[q.id] === "unknown" || isRating(q, input.answers[q.id]));
      const unsure = given.filter((q) => input.answers[q.id] === "unknown").length;
      if (inScope) {
        answered += given.length;
        unknown += unsure;
        total += qs.length;
        rated += given.filter((q) => input.answers[q.id] !== "unknown").length;
      }
      const scores = (kind: SocQuestion["kind"]) => qs.filter((q) => q.kind === kind).map((q) => ratingOf(q, input.answers[q.id]));
      return {
        id: a.id,
        name: a.name,
        domain: d.id,
        inScope,
        maturity: inScope ? mean(scores("maturity")) : null,
        capability: inScope && d.capability ? mean(scores("capability")) : null,
        answered: given.length,
        unknown: unsure,
        total: qs.length,
      };
    });

    for (const aspect of aspects) {
      const gap = (kind: SocQuestion["kind"], score: number | null, goal: number | undefined) => {
        if (score === null || goal === undefined || score >= goal) return;
        const qs = questions.filter((q) => q.aspect === aspect.id && q.kind === kind);
        const weakest = qs.reduce((low, q) => (ratingOf(q, input.answers[q.id]) < ratingOf(low, input.answers[low.id]) ? q : low), qs[0]);
        const level = Math.min(maxRating(weakest), ratingOf(weakest, input.answers[weakest.id]) + 1);
        const scale = kind === "maturity" ? model.scales.maturity : model.scales.capability;
        (kind === "maturity" ? priorities : capabilityGaps).push({
          aspect,
          domain: d.name,
          kind,
          score,
          target: goal,
          gap: two(goal - score),
          question: weakest,
          rating: input.answers[weakest.id],
          next: { level, name: scale[level].name, description: weakest.levels[level] },
        });
      };
      gap("maturity", aspect.maturity, target.maturity);
      gap("capability", aspect.capability, target.capability);
    }

    const inScope = aspects.filter((a) => a.inScope);
    return {
      id: d.id,
      name: d.name,
      maturity: mean(inScope.map((a) => a.maturity)),
      capability: d.capability ? mean(inScope.map((a) => a.capability)) : null,
      target,
      aspects,
    };
  });

  // Largest gap first; equal gaps keep the model's order (business to services).
  const byGap = (x: SocPriority, y: SocPriority) => y.gap - x.gap;
  const assessed = domains.filter((d) => d.maturity !== null);
  return {
    domains,
    overall: mean(assessed.map((d) => d.maturity)),
    overallTarget: mean((assessed.length ? assessed : domains).map((d) => d.target.maturity))!,
    answered,
    unknown,
    total,
    confidence: total ? two(rated / total) : 0,
    priorities: priorities.sort(byGap),
    capabilityGaps: capabilityGaps.sort(byGap),
  };
}
