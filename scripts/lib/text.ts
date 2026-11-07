export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ids from a pinned id list: one per line, `#` comments and blank lines skipped. */
export const parseIdList = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/** Longest control or action title the generators write. */
export const TITLE_MAX = 140;

/**
 * A statement shortened to at most `max` characters: the first sentence with its trailing full stop dropped, and a
 * cut at a word boundary marked with an ellipsis so no one mistakes a fragment for the whole statement.
 */
export function shorten(prose: string, max = TITLE_MAX): string {
  const full = prose.trim();
  const end = full.search(/[.!?](?=\s|$)/);
  const sentence = (end === -1 ? full : full.slice(0, end + 1)).replace(/\.$/, "").trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${at > 0 ? cut.slice(0, at) : cut}…`;
}
