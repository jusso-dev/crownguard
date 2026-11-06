import { e8Strategies, type Catalogue, type E8Strategy, type Question } from "../content/schema";
import type { Answer } from "../format/vocab";
import { isSatisfied } from "./risk";

export interface E8Result {
  strategy: E8Strategy;
  /** Indicative maturity level reached, or null when the questionnaire doesn't cover the strategy. */
  level: 0 | 1 | 2 | 3 | null;
  /** Highest level the questionnaire has questions for. */
  ceiling: number;
  /** Open questions blocking the next level. */
  blockers: Question[];
  /** A level below the ceiling with no questions, which stops the assessment there. */
  unasked: number | null;
}

/**
 * Levels at which ASD's Essential Eight Maturity Model (November 2023) adds no requirement over the level below, so
 * they are met whenever the level below is: patching operating systems has identical requirements at Maturity Levels
 * One and Two.
 */
const NO_NEW_REQUIREMENTS: Partial<Record<E8Strategy, number[]>> = { "patch-operating-systems": [2] };

/** A strategy's title from the Essential Eight framework file, or its id when the file isn't loaded. */
export const e8Title = (catalogue: Pick<Catalogue, "frameworks">, strategy: string) =>
  catalogue.frameworks.get("essential-eight")?.controls.find((c) => c.id === strategy)?.title ?? strategy;

/** The questions tagged as evidence for one Essential Eight strategy at one maturity level. */
export const e8Tagged = (questions: Question[], strategy: E8Strategy, level: number) =>
  questions.filter((q) => q.e8.some((t) => t.strategy === strategy && t.level === level));

export const addsNothing = (strategy: E8Strategy, level: number) => NO_NEW_REQUIREMENTS[strategy]?.includes(level) ?? false;

/**
 * ASD rule: a maturity level is achieved only when every requirement at that level and below is met.
 * A level with no questions cannot be verified, so assessment stops there, unless ASD adds nothing at that level.
 */
export function essentialEight(questions: Question[], answers: Record<string, Answer>): E8Result[] {
  return e8Strategies.map((strategy) => {
    const tagged = (level: number) => e8Tagged(questions, strategy, level);
    let ceiling = [3, 2, 1].find((l) => tagged(l).length > 0) ?? 0;
    if (ceiling === 0) return { strategy, level: null, ceiling, blockers: [], unasked: null };
    // Asking the level below also asks a level that adds nothing above it.
    while (ceiling < 3 && addsNothing(strategy, ceiling + 1)) ceiling++;
    let level: 0 | 1 | 2 | 3 = 0;
    for (const l of [1, 2, 3] as const) {
      const qs = tagged(l);
      const open = qs.filter((q) => !isSatisfied(answers[q.id]));
      if (qs.length === 0 && addsNothing(strategy, l)) {
        level = l;
        if (l === ceiling) break;
        continue;
      }
      if (qs.length === 0) return { strategy, level, ceiling, blockers: [], unasked: l };
      if (open.length) return { strategy, level, ceiling, blockers: open, unasked: null };
      level = l;
      if (l === ceiling) break;
    }
    return { strategy, level, ceiling, blockers: [], unasked: null };
  });
}
