import { e8Strategies, type E8Strategy, type Question } from "../content/schema";
import type { Answer } from "./types";

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

const satisfied = (a: Answer | undefined) => a === "yes" || a === "na";

/**
 * ASD rule: a maturity level is achieved only when every requirement at that level and below is met.
 * A level with no questions cannot be verified, so assessment stops there.
 */
export function essentialEight(questions: Question[], answers: Record<string, Answer>): E8Result[] {
  return e8Strategies.map((strategy) => {
    const tagged = (level: number) => questions.filter((q) => q.e8.some((t) => t.strategy === strategy && t.level === level));
    const ceiling = [3, 2, 1].find((l) => tagged(l).length > 0) ?? 0;
    if (ceiling === 0) return { strategy, level: null, ceiling, blockers: [], unasked: null };
    let level: 0 | 1 | 2 | 3 = 0;
    for (const l of [1, 2, 3] as const) {
      const qs = tagged(l);
      const open = qs.filter((q) => !satisfied(answers[q.id]));
      if (qs.length === 0) return { strategy, level, ceiling, blockers: [], unasked: l };
      if (open.length) return { strategy, level, ceiling, blockers: open, unasked: null };
      level = l;
      if (l === ceiling) break;
    }
    return { strategy, level, ceiling, blockers: [], unasked: null };
  });
}
