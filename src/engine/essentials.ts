import type { E8Strategy, EssentialsDomain, Framework, Question } from "../content/schema";
import type { EssentialsChapter } from "../format/vocab";
import type { Answer } from "../format/vocab";

/**
 * ASD's four-tier effectiveness scale (Essentials assessment process guide). `not-assessed` is neutral and is kept
 * apart from `not-effective` everywhere: in types, counts, table cells and JSON.
 */
export const ratingLabels = {
  "not-assessed": "Not assessed",
  "not-effective": "Not effective",
  "partially-effective": "Partially effective",
  "fully-effective": "Fully effective",
} as const;
export type EssentialsRating = keyof typeof ratingLabels;

/** Weight of each assessed rating in ASD's domain percentage. Not assessed has none: it is left out, not scored 0. */
export const ratingWeights = { "not-effective": 0, "partially-effective": 0.5, "fully-effective": 1 } as const;

export interface EssentialsEvidence {
  question: Question;
  answer: Answer | undefined;
  coverage: "full" | "partial";
}

interface ActionResult {
  id: string;
  title: string;
  /** False for a provisional id (the cloud chapter) that ASD hasn't published. */
  official: boolean;
  /** Null when every tagged question is N/A: the action doesn't apply to this domain here. */
  rating: EssentialsRating | null;
  evidence: EssentialsEvidence[];
}

interface PrincipleResult {
  id: string;
  name: string;
  rating: EssentialsRating;
  actions: ActionResult[];
}

type RatingCounts = Record<EssentialsRating, number>;

export interface DomainResult {
  id: EssentialsDomain;
  name: string;
  type: "capability" | "technical";
  phases: number[];
  /** ASD's domain percentage over the assessed principles, or null when none were assessed. */
  percentage: number | null;
  counts: RatingCounts;
  principles: PrincipleResult[];
}

export interface EssentialsResult {
  framework: { id: string; name: string; shortName: string; release: string; provisional: boolean };
  chapter: EssentialsChapter;
  /** Technical domains in phase order, then the capability domains that run across every phase. */
  domains: DomainResult[];
  /** Questions in scope that carry a tag for this chapter. */
  tagged: number;
}

/**
 * One action in one domain, from the answers to the questions tagged for it there. Indicative only: crownguard asks
 * about settings, not the Indicators of Good Practice an assessor checks.
 *  - any tagged question answered No gives not effective;
 *  - Yes or N/A on every question gives fully effective only when at least one Yes question covers the whole action,
 *    otherwise partially effective;
 *  - Partial anywhere caps it at partially effective, and so does any Unknown or unanswered once something is known;
 *  - Unknown or unanswered on its own, or no tagged question at all, gives not assessed. Uncertainty is never counted
 *    as protection and never as a failure.
 * All N/A gives null: the action doesn't apply to this domain.
 */
export function actionRating(evidence: EssentialsEvidence[]): EssentialsRating | null {
  if (!evidence.length) return "not-assessed";
  if (evidence.every((e) => e.answer === "na")) return null;
  if (evidence.some((e) => e.answer === "no")) return "not-effective";
  const known = evidence.filter((e) => e.answer === "yes" || e.answer === "partial");
  if (!known.length) return "not-assessed";
  const open = evidence.some((e) => e.answer === "partial" || e.answer === "unknown" || e.answer === undefined);
  if (open) return "partially-effective";
  return evidence.some((e) => e.answer === "yes" && e.coverage === "full") ? "fully-effective" : "partially-effective";
}

/**
 * ASD's weakest-link rule for a principle in a domain: not effective if any action is, fully effective only if every
 * action is, partially effective when everything is assessed and something falls short, and not assessed when its
 * actions haven't been sufficiently assessed. Actions that don't apply (null) are left out.
 */
export function principleRating(ratings: (EssentialsRating | null)[]): EssentialsRating | null {
  const applicable = ratings.filter((r): r is EssentialsRating => r !== null);
  if (!applicable.length) return null;
  if (applicable.includes("not-effective")) return "not-effective";
  if (applicable.includes("not-assessed")) return "not-assessed";
  return applicable.every((r) => r === "fully-effective") ? "fully-effective" : "partially-effective";
}

/** ASD's domain percentage: NE 0, PE 0.5, FE 1, summed over the assessed principles and divided by their number. */
export function domainPercentage(ratings: EssentialsRating[]): { percentage: number | null; counts: RatingCounts } {
  const counts: RatingCounts = { "not-assessed": 0, "not-effective": 0, "partially-effective": 0, "fully-effective": 0 };
  for (const r of ratings) counts[r]++;
  const assessed = ratings.filter((r): r is keyof typeof ratingWeights => r !== "not-assessed");
  const percentage = assessed.length ? Math.round((assessed.reduce((sum, r) => sum + ratingWeights[r], 0) / assessed.length) * 100) : null;
  return { percentage, counts };
}

/** Domains in the order a report shows them: phase 1 technical domains first, capability domains last. */
const domainOrder = (d: { type: string; phases: number[] }) => (d.type === "capability" ? 10 : Math.min(...d.phases));

/**
 * Indicative Essentials results for one chapter: phases, then domains, then principles, then actions, each with the
 * questions behind it. Reads only `essentials:` tags and answers, never an Essential Eight level or ISM baseline.
 */
export function essentials(framework: Framework, questions: Question[], answers: Record<string, Answer>): EssentialsResult {
  const meta = framework.essentials;
  if (!meta) throw new Error(`${framework.id} is not an Essentials chapter`);
  const ids = new Set(framework.controls.map((c) => c.id));
  const tags = questions.flatMap((q) => q.essentials.filter((t) => ids.has(t.action)).map((t) => ({ q, t })));
  const principleName = new Map(meta.principles.map((p) => [p.id, p.name]));
  const domains: DomainResult[] = [...meta.domains]
    .sort((a, b) => domainOrder(a) - domainOrder(b))
    .map((d) => {
      const principles: PrincipleResult[] = [];
      for (const p of meta.principles) {
        const actions: ActionResult[] = framework.controls
          .filter((c) => c.principle === p.id && c.domains?.includes(d.id))
          .map((c) => {
            const evidence = tags
              .filter(({ t }) => t.action === c.id && t.domains.includes(d.id))
              .map(({ q, t }) => ({ question: q, answer: answers[q.id], coverage: t.coverage }));
            return { id: c.id, title: c.title, official: !meta.provisional, rating: actionRating(evidence), evidence };
          });
        if (!actions.length) continue;
        const rating = principleRating(actions.map((a) => a.rating));
        if (rating) principles.push({ id: p.id, name: principleName.get(p.id) ?? p.id, rating, actions });
      }
      return { ...d, ...domainPercentage(principles.map((p) => p.rating)), principles };
    });
  return {
    framework: { id: framework.id, name: framework.name, shortName: framework.shortName, release: meta.release, provisional: meta.provisional },
    chapter: meta.chapter,
    domains,
    tagged: new Set(tags.map(({ q }) => q.id)).size,
  };
}

/**
 * ASD's transition gap classes. They are gap analysis findings, not ratings, so they get their own type and can't be
 * put in a ratings column by mistake.
 */
export const gapLabels = {
  "already-effectively-addressed": "Already effectively addressed",
  "partially-addressed": "Partially addressed",
  "not-addressed": "Not addressed",
} as const;
type GapClass = keyof typeof gapLabels;

/** Table 2 of ASD's "Transitioning from the Essential Eight": each strategy and the principles it maps to. */
const E8_TO_PRINCIPLES: Record<E8Strategy, string[]> = {
  "application-control": ["PRO-07", "PRO-04"],
  "patch-applications": ["PRO-06", "IDE-01", "GOV-14"],
  "patch-operating-systems": ["PRO-06", "IDE-01", "GOV-14"],
  mfa: ["PRO-13"],
  "restrict-admin-privileges": ["PRO-13", "PRO-12", "PRO-05", "PRO-18"],
  "office-macros": ["PRO-07", "PRO-04"],
  "user-application-hardening": ["PRO-04"],
  "regular-backups": ["PRO-10", "PRO-12"],
};

export interface TransitionGap {
  principle: string;
  name: string;
  /** Essential Eight strategies ASD maps to the principle; empty for a principle with no E8 equivalent. */
  strategies: E8Strategy[];
  gap: GapClass | null;
}

/**
 * The transition view: for each principle, the Essential Eight strategies that feed it and a gap class worked out
 * from the principle's own Essentials results across the domains it was assessed in. It takes the E8 strategies only
 * to name them; it never reads a maturity level, because ASD says levels "do not automatically translate".
 * A principle with nothing assessed has no gap class (null), rather than counting as not addressed.
 */
export function transitionGaps(result: EssentialsResult): TransitionGap[] {
  const byPrinciple = new Map<string, { name: string; ratings: EssentialsRating[] }>();
  for (const d of result.domains)
    for (const p of d.principles) {
      const entry = byPrinciple.get(p.id) ?? { name: p.name, ratings: [] };
      entry.ratings.push(p.rating);
      byPrinciple.set(p.id, entry);
    }
  const strategiesFor = (principle: string) =>
    (Object.entries(E8_TO_PRINCIPLES) as [E8Strategy, string[]][]).filter(([, ps]) => ps.includes(principle)).map(([s]) => s);
  return [...byPrinciple]
    .map(([principle, { name, ratings }]) => {
      const assessed = ratings.filter((r) => r !== "not-assessed");
      const gap: GapClass | null = !assessed.length
        ? null
        : assessed.every((r) => r === "fully-effective")
          ? "already-effectively-addressed"
          : assessed.every((r) => r === "not-effective")
            ? "not-addressed"
            : "partially-addressed";
      return { principle, name, strategies: strategiesFor(principle), gap };
    })
    .sort((a, b) => Number(!a.strategies.length) - Number(!b.strategies.length) || a.principle.localeCompare(b.principle));
}
