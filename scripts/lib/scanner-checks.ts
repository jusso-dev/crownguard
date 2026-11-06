/** Comparing an import mapping's check ids with a scanner's published ones. */

/** Family used to suggest new checks near ones already mapped (M365 `ENTRA-ENTAPP-*`, Prowler `backup_*`, SCuBA `GWS.GMAIL`). */
export function checkFamily(id: string): string {
  const m365 = id.match(/^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-\d+/);
  if (m365) return m365[1];
  const prowler = id.match(/^([a-z][a-z0-9]*)_/);
  if (prowler) return prowler[1];
  // Product family only, so a new policy in the same product is a suggestion.
  const scuba = id.match(/^(GWS\.[A-Z]+)/i);
  if (scuba) return scuba[1].toUpperCase();
  return id;
}

/** Check id → questions that use it. */
export function mappedChecks(rows: { question: string; checks: string[] }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows) for (const c of row.checks) out.set(c, [...(out.get(c) ?? []), row.question]);
  return out;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Mapped ids gone from `upstream` (with the questions using each), and upstream ids nobody maps yet in a family the
 * mapping already uses. With `before`, only ids new since then count as added.
 */
export function checkDrift(
  mapped: Map<string, string[]>,
  upstream: Iterable<string>,
  before?: Set<string>,
): { removed: { id: string; questions: string[] }[]; added: string[] } {
  const ids = new Set(upstream);
  const families = new Set([...mapped.keys()].map(checkFamily));
  return {
    removed: [...mapped]
      .filter(([id]) => !ids.has(id))
      .sort(([a], [b]) => byCodePoint(a, b))
      .map(([id, questions]) => ({ id, questions })),
    added: [...ids].filter((id) => !mapped.has(id) && !before?.has(id) && families.has(checkFamily(id))).sort(byCodePoint),
  };
}
