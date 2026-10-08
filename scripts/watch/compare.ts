import { diffLines, diffWords } from "diff";
import type { Catalogue } from "../../src/content/schema";
import type { ChangeDetail, Extracted, Finding, Section, SourceState } from "./types";
import { cleanTitle, collapse, escapeRegExp, hostOf, isLifecycleTerm, normalizeUrl, titleSimilarity, truncate, wordCount } from "./util";

/** Thresholds for calling a change "major" (worth a maintainer's look). */
export const MAJOR = {
  /** Share of words added or removed relative to old + new word counts. */
  ratio: 0.08,
  /** Absolute words added + removed. */
  words: 250,
  /** Sections added or removed smaller than this are ignored. */
  sectionWords: 40,
  /** Titles less similar than this count as a title change. */
  titleSimilarity: 0.7,
};

export interface DiffLine {
  op: " " | "+" | "-";
  text: string;
}

export interface TextDiff {
  wordsAdded: number;
  wordsRemoved: number;
  changedRatio: number;
  /** Changed lines with one line of context either side; `null` separates hunks. */
  lines: (DiffLine | null)[];
}

const WORD_DIFF_LIMIT = 20_000;

/** Line diff of two normalised texts, with word-level counts inside each changed block. */
export function diffTexts(oldText: string, newText: string): TextDiff {
  const parts = diffLines(oldText, newText);
  let wordsAdded = 0;
  let wordsRemoved = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      if (p.value.length + next.value.length <= WORD_DIFF_LIMIT) {
        for (const w of diffWords(p.value, next.value)) {
          if (w.added) wordsAdded += wordCount(w.value);
          else if (w.removed) wordsRemoved += wordCount(w.value);
        }
      } else {
        wordsRemoved += wordCount(p.value);
        wordsAdded += wordCount(next.value);
      }
      i++;
    } else if (p.added) wordsAdded += wordCount(p.value);
    else if (p.removed) wordsRemoved += wordCount(p.value);
  }
  const total = wordCount(oldText) + wordCount(newText);
  return {
    wordsAdded,
    wordsRemoved,
    changedRatio: total === 0 ? 0 : (wordsAdded + wordsRemoved) / total,
    lines: hunkLines(parts),
  };
}

function hunkLines(parts: ReturnType<typeof diffLines>): (DiffLine | null)[] {
  const all: DiffLine[] = [];
  for (const p of parts) {
    const op: DiffLine["op"] = p.added ? "+" : p.removed ? "-" : " ";
    for (const text of p.value.split("\n")) if (text.trim()) all.push({ op, text });
  }
  const keep = new Set<number>();
  all.forEach((l, i) => {
    if (l.op !== " ") for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < all.length) keep.add(j);
  });
  const out: (DiffLine | null)[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1 && out.length) out.push(null);
    out.push(all[i]);
    last = i;
  }
  return out;
}

/** A unified-diff style excerpt capped at `maxLines` lines and `maxChars` characters, long lines shortened. */
export function excerpt(diff: TextDiff, maxLines = 40, maxChars = 3000): string {
  const out: string[] = [];
  let chars = 0;
  let shown = 0;
  const changed = diff.lines.filter((l) => l && l.op !== " ").length;
  for (const line of diff.lines) {
    const text = line === null ? "…" : `${line.op} ${line.op === " " ? truncate(line.text, 120) : truncate(line.text, 240)}`;
    if (out.length >= maxLines || chars + text.length > maxChars) break;
    out.push(text);
    chars += text.length + 1;
    if (line && line.op !== " ") shown++;
  }
  if (shown < changed) out.push(`… ${changed - shown} more changed line${changed - shown === 1 ? "" : "s"} not shown`);
  return out.join("\n");
}

const headingKey = (h: string) => collapse(h).toLowerCase();

/** Match sections by heading text (repeated headings by occurrence) and report what was added, removed or edited. */
export function compareSections(before: Section[] = [], after: Section[] = []) {
  const keyed = (list: Section[]) => {
    const seen = new Map<string, number>();
    return new Map(
      list.map((s) => {
        const k = headingKey(s.h);
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        return [n > 1 ? `${k}#${n}` : k, s] as const;
      }),
    );
  };
  const a = keyed(before);
  const b = keyed(after);
  const added = [...b].filter(([k]) => !a.has(k)).map(([, s]) => s);
  const removed = [...a].filter(([k]) => !b.has(k)).map(([, s]) => s);
  const changed = [...b].filter(([k, s]) => a.has(k) && a.get(k)!.hash !== s.hash).map(([k, s]) => ({ before: a.get(k)!, after: s }));
  return { added, removed, changed };
}

export interface Classified {
  severity: "major" | "minor";
  detail: ChangeDetail;
  /** Plain-text reasons, most important first. */
  reasons: string[];
}

/**
 * Describe how a page changed between the baseline fingerprint and the current one, and decide whether it needs a
 * maintainer. `diff` is the text diff when earlier text was available (cache snapshot or Learn Markdown); without
 * it, word counts are estimated from section sizes.
 */
export function classifyChange(baseline: SourceState, current: SourceState, diff?: TextDiff): Classified {
  const sections = compareSections(baseline.sections, current.sections);
  const termsBefore = new Set(baseline.terms ?? []);
  const termsAfter = new Set(current.terms ?? []);
  const termsAdded = [...termsAfter].filter((t) => !termsBefore.has(t)).sort();
  const termsRemoved = [...termsBefore].filter((t) => !termsAfter.has(t)).sort();

  let wordsAdded: number;
  let wordsRemoved: number;
  let changedRatio: number;
  if (diff) {
    ({ wordsAdded, wordsRemoved, changedRatio } = diff);
  } else {
    wordsAdded = sections.added.reduce((n, s) => n + s.words, 0);
    wordsRemoved = sections.removed.reduce((n, s) => n + s.words, 0);
    for (const { before, after } of sections.changed) {
      const delta = after.words - before.words;
      if (delta > 0) wordsAdded += delta;
      else wordsRemoved -= delta;
    }
    const total = (baseline.words ?? 0) + (current.words ?? 0);
    changedRatio = total === 0 ? 0 : (wordsAdded + wordsRemoved) / total;
  }

  const oldTitle = baseline.title && cleanTitle(baseline.title);
  const newTitle = current.title && cleanTitle(current.title);
  const titleChanged = !!oldTitle && !!newTitle && oldTitle !== newTitle;

  const reasons: string[] = [];
  const lifecycle = termsAdded.filter(isLifecycleTerm);
  if (lifecycle.length) reasons.push(`now says ${lifecycle.map((t) => `"${t}"`).join(", ")}`);
  if (titleChanged && titleSimilarity(oldTitle, newTitle) < MAJOR.titleSimilarity) reasons.push(`retitled "${newTitle}"`);
  const bigAdded = sections.added.filter((s) => s.words >= MAJOR.sectionWords);
  const bigRemoved = sections.removed.filter((s) => s.words >= MAJOR.sectionWords);
  if (bigAdded.length) reasons.push(`${bigAdded.length} section${bigAdded.length === 1 ? "" : "s"} added`);
  if (bigRemoved.length) reasons.push(`${bigRemoved.length} section${bigRemoved.length === 1 ? "" : "s"} removed`);
  const licenceAdded = termsAdded.filter((t) => !isLifecycleTerm(t));
  if (licenceAdded.length) reasons.push(`now mentions ${licenceAdded.join(", ")}`);
  const licenceRemoved = termsRemoved.filter((t) => !isLifecycleTerm(t));
  if (licenceRemoved.length) reasons.push(`no longer mentions ${licenceRemoved.join(", ")}`);
  if (changedRatio >= MAJOR.ratio || wordsAdded + wordsRemoved >= MAJOR.words)
    reasons.push(`${Math.round(changedRatio * 100)}% of the text changed (+${wordsAdded}/−${wordsRemoved} words)`);

  const severity = reasons.length ? "major" : "minor";
  if (!reasons.length) {
    if (wordsAdded + wordsRemoved > 0) reasons.push(`small edit (+${wordsAdded}/−${wordsRemoved} words)`);
    else if (titleChanged) reasons.push(`title reworded to "${newTitle}"`);
    else if (sections.changed.length || sections.added.length || sections.removed.length) reasons.push("formatting or wording tweaks");
  }

  return {
    severity,
    reasons,
    detail: {
      changedRatio: Math.round(changedRatio * 1000) / 1000,
      wordsAdded,
      wordsRemoved,
      sectionsAdded: sections.added.map((s) => s.h),
      sectionsRemoved: sections.removed.map((s) => s.h),
      sectionsChanged: sections.changed.map((c) => c.after.h),
      termsAdded,
      termsRemoved,
      ...(titleChanged ? { oldTitle, newTitle } : {}),
      ...(baseline.updated !== current.updated ? { oldUpdated: baseline.updated, newUpdated: current.updated } : {}),
      ...(diff ? {} : { noPreviousText: true }),
    },
  };
}

/** Version written in a source title, e.g. `v7.0.0` in "CIS Microsoft 365 Foundations Benchmark v7.0.0". */
export function citedVersion(title: string): { product: string; version: string } | undefined {
  const m = title.match(/^(.*?)\s+v(\d+(?:\.\d+)*)\b/i) ?? title.match(/^(.*?)\s+(\d+\.\d+(?:\.\d+)?)\b/);
  if (!m) return undefined;
  const words = m[1].split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  return { product: words.slice(-3).join(" "), version: m[2] };
}

/**
 * Versions of the product named in `title` that appear in `text`, ascending. The product is matched by its full name
 * (without a leading "CIS" or trailing "Benchmark", as CIS pages list "Microsoft 365 Foundations (7.0.0)") or by the
 * last three words before the version; CIS mixes "Foundation" and "Foundations".
 */
export function versionsOnPage(title: string, text: string): string[] {
  const cited = citedVersion(title);
  if (!cited) return [];
  const full = title
    .replace(new RegExp(`\\s+v?${escapeRegExp(cited.version)}\\b.*$`, "i"), "")
    .replace(/^CIS\s+/i, "")
    .replace(/\s+Benchmark$/i, "");
  const found = new Set<string>();
  for (const name of new Set([full, cited.product])) {
    const pattern = escapeRegExp(name).replace(/\s+/g, "\\s+").replace(/Foundations?/gi, "Foundations?");
    const re = new RegExp(`${pattern}\\s*(?:Benchmark\\s*)?(?:[-–:(]\\s*)?v?(\\d+(?:\\.\\d+)*)\\b`, "gi");
    for (const m of text.matchAll(re)) found.add(m[1]);
  }
  return [...found].sort(compareVersions);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Hosts that serve the same documentation set, so a redirect between them can still be the same page. */
const FAMILIES = [
  ["learn.microsoft.com", "docs.microsoft.com"],
  ["support.google.com", "knowledge.workspace.google.com"],
  ["cloud.google.com", "docs.cloud.google.com"],
  ["www.microsoft.com", "microsoft.com"],
  ["www.cyber.gov.au", "cyber.gov.au"],
  ["www.cisecurity.org", "cisecurity.org"],
];

function sameFamily(a: string, b: string): boolean {
  return a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

/** Query parameters sites add on redirect that don't change which page is served. */
const NOISE_PARAMS = new Set(["hl", "sjid", "visit_id", "rd", "ref_topic", "authuser", "co", "utm_source", "utm_medium", "utm_campaign"]);

function comparable(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    for (const k of [...u.searchParams.keys()]) if (NOISE_PARAMS.has(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    u.protocol = "https:";
    if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** True when two URLs differ only in ways that don't change the page (scheme, www, trailing slash, locale or tracking parameters). */
export function equivalentUrls(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/**
 * Decide what a redirect means. "moved": the same document lives at a new URL (safe to update automatically).
 * "redirected": it now lands somewhere else (a hub, a landing page, an archived or unrelated page), so a person must
 * choose. Learn keeps `document_id` across moves and renames and changes it when content is replaced or merged, so
 * that decides when both sides have one; otherwise the titles must match.
 */
export function redirectKind(
  citedUrl: string,
  finalUrl: string,
  page: Pick<Extracted, "title" | "isLanding" | "retired"> & { documentId?: string },
  before: { titles: (string | undefined)[]; documentId?: string },
): "none" | "moved" | "redirected" {
  if (equivalentUrls(citedUrl, finalUrl)) return "none";
  if (!sameFamily(hostOf(citedUrl), hostOf(finalUrl)) || page.isLanding || page.retired) return "redirected";
  if (before.documentId && page.documentId) return before.documentId === page.documentId ? "moved" : "redirected";
  const similarity = Math.max(0, ...before.titles.filter((t): t is string => !!t).map((t) => titleSimilarity(t, page.title)));
  return similarity >= 0.5 ? "moved" : "redirected";
}

/** Question and framework ids that cite each source id. */
export function citedByIndex(catalogue: Catalogue): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (source: string, by: string) => index.set(source, [...(index.get(source) ?? []), by]);
  for (const bundle of [...catalogue.platforms.values()].sort((a, b) => a.platform.id.localeCompare(b.platform.id))) {
    for (const q of bundle.questions) for (const s of q.sources) add(s, q.id);
    for (const s of bundle.platform.sources) add(s, `platform:${bundle.platform.id}`);
  }
  for (const f of catalogue.frameworks.values()) add(f.source, `framework:${f.id}`);
  for (const [k, v] of index) index.set(k, [...new Set(v)].sort());
  return index;
}

/** Sources nothing cites, and sources that point at the same page. Both are housekeeping for a maintainer. */
export function housekeeping(catalogue: Catalogue, citedBy: Map<string, string[]>, states: Record<string, SourceState>): Finding[] {
  const findings: Finding[] = [];
  const sources = [...catalogue.sources.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of sources)
    if (!citedBy.get(s.id)?.length)
      findings.push({ kind: "orphan", sourceId: s.id, title: s.title, url: s.url, actionable: true, detail: "Not cited by any question, framework or platform.", citedBy: [] });

  const byPage = new Map<string, string[]>();
  for (const s of sources) {
    // Citing two sections of one page (different fragments) is deliberate, so fragments stay in the key.
    const page = `${comparable(states[s.id]?.finalUrl ?? s.url)}${URL.canParse(s.url) ? new URL(s.url).hash : ""}`;
    byPage.set(page, [...(byPage.get(page) ?? []), s.id]);
  }
  for (const ids of byPage.values()) {
    if (ids.length < 2) continue;
    const [first, ...rest] = ids.map((id) => catalogue.sources.get(id)!);
    findings.push({
      kind: "duplicate",
      sourceId: first.id,
      title: first.title,
      url: first.url,
      actionable: true,
      detail: `Same page as ${rest.map((r) => r.id).join(", ")}; merge them so each page is cited once.`,
      citedBy: [...new Set(ids.flatMap((id) => citedBy.get(id) ?? []))].sort(),
    });
  }
  return findings;
}
