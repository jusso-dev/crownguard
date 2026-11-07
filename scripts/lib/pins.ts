/**
 * The version pins the generated guidance carries, read and moved: release tags in file headers, `checkedAgainst` in
 * content/imports and the release a source in content/sources cites. Every edit is a targeted text replacement, so
 * comments and layout survive.
 */
import { escapeRegExp } from "./text";
import { isTag } from "./versions";

function must(text: string, re: RegExp, what: string): RegExpMatchArray {
  const m = text.match(re);
  if (!m) throw new Error(`could not find ${what}`);
  return m;
}

/** The `at release tag v2026.09.4` pin in a generated OSCAL framework file's header. */
export const headerTag = (text: string): string => must(text, /\bat release tag (v[\d.]+)\b/, "the release tag in the file header")[1];

/** The tag in a pinned id list's first line: `... at tag 5.44.0 (...` or `... at ScubaGoggles tag v1.0.1 (...`. */
export const listTag = (text: string): string => must(text, /^#.*\btag (v?[\d.]+) \(/m, "the tag in the id list header")[1];

/** `checkedAgainst` in a content/imports mapping. */
export const checkedAgainst = (text: string): string => must(text, /^checkedAgainst: (\S+)$/m, "checkedAgainst")[1];

/**
 * Move `checkedAgainst` and the header comment that names the same release. Only the comment line that says what
 * the ids were "checked against" changes; coverage notes stay at the release they were written for.
 */
export function setCheckedAgainst(text: string, to: string, opts: { date?: string } = {}): string {
  if (!isTag(to)) throw new Error(`refusing to set checkedAgainst to ${JSON.stringify(to)}`);
  const from = checkedAgainst(text);
  const out = text.replace(/^checkedAgainst: \S+$/m, `checkedAgainst: ${to}`);
  // "checked against Prowler 5.44.0 (2026-09-29)": the tag, and the release date right after it when there is one.
  return out.replace(new RegExp(`^(#.*checked against\\b.*?)(?<![\\w.])${escapeRegExp(from)}(?![\\w.])( \\(\\d{4}-\\d{2}-\\d{2}\\))?`, "m"), (_m, a: string, d?: string) =>
    `${a}${to}${d && opts.date ? ` (${opts.date})` : (d ?? "")}`,
  );
}

/** One source's block in a content/sources file, from its `- id:` line to the next one. */
function sourceSpan(text: string, sourceId: string): { start: number; end: number } {
  const start = text.search(new RegExp(`^- id: ${escapeRegExp(sourceId)}$`, "m"));
  if (start === -1) throw new Error(`no source ${sourceId}`);
  const next = text.slice(start + 1).search(/^- id: /m);
  return { start, end: next === -1 ? text.length : start + 1 + next };
}

/** The release a source links: the tag at the end of its `.../releases/tag/<tag>` URL. */
export function sourceReleaseTag(text: string, sourceId: string): string {
  const { start, end } = sourceSpan(text, sourceId);
  return must(text.slice(start, end), /^\s+url: \S+\/releases\/tag\/(\S+)$/m, `a release URL on source ${sourceId}`)[1];
}

/** Point a source in content/sources at a new release: the tag in its title and URL, and its retrieval date. */
export function setSourceRelease(text: string, sourceId: string, to: string, retrieved: string): string {
  if (!isTag(to)) throw new Error(`refusing to point source ${sourceId} at ${JSON.stringify(to)}`);
  const from = sourceReleaseTag(text, sourceId);
  const { start, end } = sourceSpan(text, sourceId);
  const moved = text
    .slice(start, end)
    .replace(new RegExp(`(^\\s+title: .*)\\b${escapeRegExp(from)}\\b`, "m"), `$1${to}`)
    .replace(new RegExp(`(^\\s+url: \\S*/)${escapeRegExp(from)}$`, "m"), `$1${to}`)
    .replace(/^(\s+retrieved: )\d{4}-\d{2}-\d{2}$/m, `$1${retrieved}`);
  return text.slice(0, start) + moved + text.slice(end);
}
