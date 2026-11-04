/**
 * Reading and moving the version pins the generated guidance carries: release tags in file headers,
 * `checkedAgainst` in content/imports, `reviewMapping.pinned` in scripts/watch/feeds.ts and the release a source
 * in content/sources cites. Every edit is a targeted text replacement, so comments and layout survive.
 */

const TAG = /^v?\d+(?:\.\d+){1,3}$/;

/** True for a plain version tag: `5.47.0`, `v1.1.0`, `v2026.09.4`. Pre-release suffixes are not tags we follow. */
export const isTag = (tag: string): boolean => TAG.test(tag);

/** Compare two version tags numerically, part by part (`v2026.10.15` > `v2026.09.4`, `5.47.0` > `5.9.0`). */
export function compareTags(a: string, b: string): number {
  if (!isTag(a) || !isTag(b)) throw new Error(`cannot compare ${a} with ${b}: not version tags`);
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Escape a string for use inside a RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  return out.replace(new RegExp(`^(#.*checked against\\b.*?)(?<![\\w.])${esc(from)}(?![\\w.])( \\(\\d{4}-\\d{2}-\\d{2}\\))?`, "m"), (_m, a: string, d?: string) =>
    `${a}${to}${d && opts.date ? ` (${opts.date})` : (d ?? "")}`,
  );
}

/** The source of one feed definition in scripts/watch/feeds.ts, from its `id:` to the end of its object. */
function feedSpan(text: string, feedId: string): { start: number; end: number } {
  const start = text.indexOf(`id: "${feedId}",`);
  if (start === -1) throw new Error(`no feed ${feedId} in scripts/watch/feeds.ts`);
  const end = text.indexOf("\n  },", start);
  return { start, end: end === -1 ? text.length : end };
}

const PINNED = /reviewMapping: \{ file: "[^"]+", pinned: "([^"]+)" \}/;

/** `reviewMapping.pinned` of one feed. */
export function feedPin(text: string, feedId: string): string {
  const { start, end } = feedSpan(text, feedId);
  return must(text.slice(start, end), PINNED, `reviewMapping.pinned for feed ${feedId}`)[1];
}

/** Move one feed's `reviewMapping.pinned`. Only a validated tag is ever written into this TypeScript file. */
export function setFeedPin(text: string, feedId: string, to: string): string {
  if (!isTag(to)) throw new Error(`refusing to pin feed ${feedId} to ${JSON.stringify(to)}`);
  const { start, end } = feedSpan(text, feedId);
  const span = text.slice(start, end);
  must(span, PINNED, `reviewMapping.pinned for feed ${feedId}`);
  return text.slice(0, start) + span.replace(PINNED, (m, old: string) => m.replace(`pinned: "${old}"`, `pinned: "${to}"`)) + text.slice(end);
}

/** One source's block in a content/sources file, from its `- id:` line to the next one. */
function sourceSpan(text: string, sourceId: string): { start: number; end: number } {
  const start = text.search(new RegExp(`^- id: ${esc(sourceId)}$`, "m"));
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
export function setSourceRelease(text: string, sourceId: string, from: string, to: string, retrieved: string): string {
  if (!isTag(to)) throw new Error(`refusing to point source ${sourceId} at ${JSON.stringify(to)}`);
  const { start, end } = sourceSpan(text, sourceId);
  const block = text.slice(start, end);
  if (!block.includes(from)) throw new Error(`source ${sourceId} does not cite ${from}`);
  const moved = block
    .replace(new RegExp(`(^\\s+title: .*)\\b${esc(from)}\\b`, "m"), `$1${to}`)
    .replace(new RegExp(`(^\\s+url: \\S*/)${esc(from)}$`, "m"), `$1${to}`)
    .replace(/^(\s+retrieved: )\d{4}-\d{2}-\d{2}$/m, `$1${retrieved}`);
  return text.slice(0, start) + moved + text.slice(end);
}

const DATES = /\b(Retrieved |retrieved: )\d{4}-\d{2}-\d{2}\b/g;
const masked = (line: string) => line.replace(DATES, "$1#");

/**
 * Keep the open pull request's retrieval dates where the regenerated text differs from it only in a date, so the
 * PR doesn't get a new commit (and a force-push) every night just because the fetch date moved. Only lines the
 * update itself changed (`produced` against `current`, the base branch) are eligible: a date the base branch moved
 * on its own is never rolled back.
 */
export function keepDates(produced: string, current: string, previous: string | undefined): string {
  if (previous === undefined || produced === previous) return produced;
  const p = produced.split("\n");
  const c = current.split("\n");
  const o = previous.split("\n");
  if (p.length !== o.length || p.length !== c.length) return produced;
  return p.map((line, i) => (line !== c[i] && line !== o[i] && masked(line) === masked(o[i]) ? o[i] : line)).join("\n");
}
