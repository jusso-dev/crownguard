import { allQuestionIds } from "./catalogue";

/** Ids of every question this build asks, across all platforms and the SOC module. */
export function questionIdSet(): ReadonlySet<string> {
  return allQuestionIds;
}
