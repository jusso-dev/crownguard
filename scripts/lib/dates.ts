/** Today's date in UTC, YYYY-MM-DD. */
export const today = (): string => new Date().toISOString().slice(0, 10);

export { ISO_DATE } from "../../src/format/vocab";

/** The retrieval dates generated files carry: `Retrieved 2026-10-10.` in headers, `retrieved: 2026-10-10` in sources. */
const RETRIEVED = /\b(Retrieved |retrieved: )\d{4}-\d{2}-\d{2}\b/g;
const masked = (text: string) => text.replace(RETRIEVED, "$1#");

/**
 * A generator's output, or `previous` when the two differ only in retrieval dates, so a rerun that fetched nothing new
 * is a true no-op.
 */
export const keepRetrievalDate = (produced: string, previous: string | undefined): string =>
  previous !== undefined && masked(previous) === masked(produced) ? previous : produced;

/**
 * Keep the open pull request's retrieval dates where the regenerated text differs from it only in a date, so the
 * PR doesn't get a new commit (and a force-push) every night just because the fetch date moved. Only lines the
 * update itself changed (`produced` against `current`, the base branch) are eligible: a date the base branch moved
 * on its own is never rolled back. Unlike `keepRetrievalDate` this works line by line, because the PR's other
 * changes are expected.
 */
export function keepDates(produced: string, current: string, previous: string | undefined): string {
  if (previous === undefined || produced === previous) return produced;
  const p = produced.split("\n");
  const c = current.split("\n");
  const o = previous.split("\n");
  if (p.length !== o.length || p.length !== c.length) return produced;
  return p.map((line, i) => (line !== c[i] && line !== o[i] && masked(line) === masked(o[i]) ? o[i] : line)).join("\n");
}
