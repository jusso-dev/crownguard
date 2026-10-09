import { catalogue } from "./catalogue";

let ids: Set<string> | undefined;

/** Ids of every question this build asks, across all platforms and the SOC module. */
export function questionIdSet(): ReadonlySet<string> {
  ids ??= new Set([
    ...[...catalogue.platforms.values()].flatMap((b) => b.questions.map((q) => q.id)),
    ...(catalogue.soc?.questions.map((q) => q.id) ?? []),
  ]);
  return ids;
}
