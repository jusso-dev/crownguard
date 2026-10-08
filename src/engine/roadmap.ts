import { severities, type Question } from "../content/schema";
import { answerValue, impactOf, isGap, questionsForJewel } from "./risk";
import type { Answer, CrownJewel } from "./types";

export type Phase = "0–30 days" | "31–60 days" | "61–90 days";

export interface RoadmapItem {
  question: Question;
  answer: Answer | undefined;
  /** Weighted risk reduction across the crown jewels this control protects. */
  reduction: number;
  priority: number;
  jewels: CrownJewel[];
  phase: Phase;
}

const effortCost = { S: 1, M: 2, L: 3 } as const;

export function buildRoadmap(questions: Question[], jewels: CrownJewel[], answers: Record<string, Answer>): RoadmapItem[] {
  const items = questions
    .filter((q) => isGap(answers[q.id]))
    .map((question) => {
      const answer = answers[question.id];
      const shortfall = 1 - (answerValue(answer) ?? 1);
      const protects = jewels.filter((j) => questionsForJewel(j, [question]).length > 0);
      const impactSum = protects.reduce((sum, j) => sum + impactOf(j), 0) || 1;
      const reduction = severities[question.severity] * shortfall * impactSum;
      return { question, answer, reduction, priority: reduction / effortCost[question.effort], jewels: protects };
    })
    .sort((a, b) => b.priority - a.priority || a.question.id.localeCompare(b.question.id));

  const n = items.length;
  return items.map((item, i) => {
    const urgent = item.question.severity === "critical" && item.question.effort !== "L";
    const phase: Phase = i < n / 3 || urgent ? "0–30 days" : i < (2 * n) / 3 ? "31–60 days" : "61–90 days";
    return { ...item, phase };
  });
}
