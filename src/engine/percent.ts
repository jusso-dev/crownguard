/**
 * A 0–1 share as a whole percentage. Only exactly 1 shows 100% and only exactly 0 shows 0%,
 * so 99.6% with an open gap reads 99%, not 100%.
 */
export const percent = (n: number) => (n >= 1 ? 100 : n <= 0 ? 0 : Math.min(99, Math.max(1, Math.round(n * 100))));

/** A 0–1 share as "42%", or `empty` when there is nothing to score. */
export const pct = (n: number | null, empty = "–") => (n === null ? empty : `${percent(n)}%`);
