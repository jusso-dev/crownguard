import { parseHTML } from "linkedom";
import type { Extracted, HostProfile, LearnMeta, Section } from "./types";
import { cleanTitle, collapse, findTerms, shortHash, toIsoDate, wordCount } from "./util";

/** Elements that never carry guidance text. Hidden elements are left to each profile: Learn hides tab panels. */
const ALWAYS_STRIP = "script, style, noscript, template, svg, iframe, object, button, form, input, select, textarea, dialog, local-time";

const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "CAPTION", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
  "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE",
  "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** Marks a section heading line during extraction; never appears in page text. */
const HEADING = "\u0001";
/** Marks block boundaries during extraction (collapse() strips it from page text). */
const BLOCK = "\u0002";

/** "Last updated" style statements in page chrome, used when no metadata states a date. */
const UPDATED_PATTERNS = [
  /Last updated(?: on)?:?\s+(\d{4}-\d{2}-\d{2})/i,
  /Last updated(?: on)?:?\s+(\d{1,2} [A-Z][a-z]+ \d{4})/,
  /Last updated(?: on)?:?\s+([A-Z][a-z]+ \d{1,2},? \d{4})/,
  /Updated:?\s+(\d{1,2} [A-Z][a-z]+ \d{4})/,
];

type Doc = ReturnType<typeof parseHTML>["document"];
type El = ReturnType<Doc["querySelector"]> & {};

function meta(document: Doc, name: string): string | undefined {
  const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  const v = el?.getAttribute("content")?.trim();
  return v || undefined;
}

/** Learn metadata from `<meta>` tags, when the page is a Learn article. */
export function learnMeta(document: Doc): LearnMeta | undefined {
  const original = meta(document, "original_content_git_url");
  const m = original?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (!m) return undefined;
  const commit = meta(document, "git_commit_id") ?? meta(document, "gitcommit")?.match(/\/blob\/([0-9a-f]{40})\//)?.[1];
  const feedback = meta(document, "github_feedback_content_git_url")?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/);
  return {
    sourceRepo: m[1],
    sourceBranch: m[2],
    path: decodeURIComponent(m[3]),
    ...(commit && /^[0-9a-f]{40}$/.test(commit) ? { commit } : {}),
    ...(feedback ? { publicRepo: feedback[1], publicBranch: feedback[2], publicPath: decodeURIComponent(feedback[3]) } : {}),
    ...(toIsoDate(meta(document, "ms.date")) ? { msDate: toIsoDate(meta(document, "ms.date")) } : {}),
    ...(meta(document, "page_type") || meta(document, "ms.topic") ? { pageType: meta(document, "ms.topic") ?? meta(document, "page_type") } : {}),
    ...(meta(document, "document_id") ? { documentId: meta(document, "document_id") } : {}),
    ...(meta(document, "toc_rel") ? { tocRel: meta(document, "toc_rel") } : {}),
    ...(meta(document, "is_archived") === "true" || meta(document, "uhfHeaderId") === "MSDocsHeader-Archive" ? { archived: true } : {}),
  };
}

/**
 * The page's h1 when it has one: `<title>` and Learn's og:title are often SEO titles that change on their own. DevSite
 * pages put hidden widget text inside the h1, so their profiles take og:title up to the first "|" instead.
 */
function pageTitle(document: Doc, from: HostProfile["title"]): string {
  const og = meta(document, "og:title");
  if (from === "og" && og) return cleanTitle(og.split(/\s\|\s/)[0]);
  const h1 = collapse(document.querySelector("main h1, article h1, h1")?.textContent ?? "");
  return cleanTitle(h1 || og || document.querySelector("title")?.textContent || "");
}

function contentRoots(document: Doc, selectors: string[], expect?: number): { roots: El[]; matched: boolean } {
  for (const [i, sel] of selectors.entries()) {
    const found = [...document.querySelectorAll(sel)] as El[];
    // Skip elements nested inside another match so text isn't counted twice.
    const roots = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    if (!roots.length) continue;
    // For hosts with a known layout, a fallback selector or the wrong number of parts means the layout changed:
    // extract anyway, but say so.
    return { roots, matched: expect === undefined || (i === 0 && roots.length === expect) };
  }
  return { roots: document.body ? [document.body as El] : [], matched: false };
}

/**
 * Text lines of an element, one per line of the page source, with section headings marked; plus the text of each
 * block on one line. Lines feed the fingerprint; blocks feed lifecycle dates, because sites such as DevSite hard-wrap
 * sentences in their HTML ("will be shut\ndown on October 30, 2026").
 */
function blockLines(root: El, headingSelector: string): { lines: string[]; blocks: string[] } {
  for (const h of root.querySelectorAll(headingSelector)) h.prepend(HEADING);
  for (const el of root.querySelectorAll("*")) {
    if (!BLOCKS.has(el.tagName)) continue;
    el.before(`${BLOCK}\n`);
    el.after(`${BLOCK}\n`);
  }
  const raw = root.textContent ?? "";
  const lines = raw
    .split("\n")
    .map((line) => {
      const marked = line.includes(HEADING);
      const text = collapse(line.replaceAll(HEADING, ""));
      return marked && text ? `${HEADING}${text}` : text;
    })
    .filter(Boolean);
  const blocks = raw
    .split(BLOCK)
    .map((b) => collapse(b.replaceAll(HEADING, "").replace(/\s+/g, " ")))
    .filter(Boolean);
  return { lines, blocks };
}

function stripVolatile(lines: string[], volatile: RegExp[]): string[] {
  return lines
    .map((line) => {
      const heading = line.startsWith(HEADING);
      let text = heading ? line.slice(1) : line;
      for (const re of volatile) text = text.replace(re, " ");
      text = collapse(text);
      return text ? (heading ? `${HEADING}${text}` : text) : "";
    })
    .filter(Boolean);
}

function sectionsOf(lines: string[]): { text: string; sections: Section[] } {
  const sections: { h: string; body: string[] }[] = [{ h: "(top)", body: [] }];
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith(HEADING)) {
      const h = line.slice(1);
      sections.push({ h, body: [] });
      out.push(h);
    } else {
      sections[sections.length - 1].body.push(line);
      out.push(line);
    }
  }
  return {
    text: out.join("\n"),
    sections: sections
      .filter((s) => s.h !== "(top)" || s.body.length > 0)
      .map((s) => {
        const body = s.body.join("\n");
        return { h: s.h, hash: shortHash(body).slice(0, 12), words: wordCount(body) };
      }),
  };
}

function linkDensity(roots: El[]): number {
  let all = 0;
  let linked = 0;
  for (const r of roots) {
    all += wordCount(r.textContent ?? "");
    for (const a of r.querySelectorAll("a")) linked += wordCount(a.textContent ?? "");
  }
  return all === 0 ? 0 : linked / all;
}

const LANDING_TYPES = /^(?:landing|landing-?page|hub|hub-?page|hubpage|landingpage|index-page|toc)$/i;

function declaredUpdate(document: Doc, rawText: string): string | undefined {
  // Learn's displayed "Last updated" date ignores metadata-only republishes, unlike ms.date and updated_at.
  const learnDate = toIsoDate(document.querySelector("local-time[data-article-date-source]")?.getAttribute("datetime"));
  if (learnDate) return learnDate;
  const fromMeta =
    meta(document, "ms.date") ??
    meta(document, "article:modified_time") ??
    meta(document, "og:updated_time") ??
    meta(document, "last-modified") ??
    meta(document, "dcterms.modified") ??
    meta(document, "dc.date.modified");
  const iso = toIsoDate(fromMeta);
  if (iso) return iso;
  for (const re of UPDATED_PATTERNS) {
    const m = rawText.match(re);
    if (m && toIsoDate(m[1])) return toIsoDate(m[1]);
  }
  return undefined;
}

/** Read an HTML page: title, normalised main-content text, sections, dates, Learn metadata and tracked terms. */
export function extractHtml(html: string, profile: HostProfile): Extracted {
  const { document } = parseHTML(html);
  const title = pageTitle(document, profile.title);
  const learn = learnMeta(document);
  const lang = document.documentElement?.getAttribute("lang") ?? undefined;
  const pageText = collapse(document.body?.textContent ?? "");
  const updatedEl = profile.updatedSelector ? document.querySelector(profile.updatedSelector) : null;
  const updated = profile.ignoreUpdated
    ? undefined
    : (toIsoDate(updatedEl?.getAttribute("datetime")) ?? toIsoDate(collapse(updatedEl?.textContent ?? "")) ?? declaredUpdate(document, pageText));
  for (const el of document.querySelectorAll(ALWAYS_STRIP)) el.remove();
  // Google Workspace Help draws admin console paths with "and then" arrow images: keep them readable.
  for (const img of document.querySelectorAll('img[alt="and then"]')) img.replaceWith(" > ");

  const { roots, matched } = contentRoots(document, profile.content, profile.expectRoots);
  const retired = retirement(title, learn, roots, profile.sectionHeadings);
  for (const root of roots) for (const sel of profile.strip) for (const el of root.querySelectorAll(sel)) el.remove();
  const density = linkDensity(roots);
  const extracted = roots.map((r) => blockLines(r, profile.sectionHeadings));
  const lines = stripVolatile(
    extracted.flatMap((x) => x.lines),
    profile.volatile,
  );
  const { text, sections } = sectionsOf(lines);
  const words = wordCount(text);
  const isLanding = (learn?.pageType ? LANDING_TYPES.test(learn.pageType) : false) || LANDING_TYPES.test(meta(document, "page_type") ?? "") || (density > 0.6 && words < 600);

  return {
    title,
    text,
    contentHash: shortHash(text),
    words,
    sections,
    ...(updated ? { updated } : {}),
    ...(learn ? { learn } : {}),
    terms: findTerms(text),
    isLanding,
    ...(retired ? { retired } : {}),
    deadlines: lifecycleDates(extracted.flatMap((x) => x.blocks)),
    blocks: extracted.flatMap((x) => x.blocks),
    matchedSelector: matched,
    ...(lang ? { lang } : {}),
  };
}

const LIFECYCLE_LINE =
  /\b(?:retir\w*|deprecat\w*|end of (?:support|life|sale)|shut(?:s|ting)? down|will be (?:removed|disabled|discontinued|turned off|turned down)|no longer (?:be )?(?:supported|available)|stop(?:s|ped)? (?:working|synchroni[sz]ing)|disabled by default|switched off|sunset)\b/i;
const MONTH = "(January|February|March|April|May|June|July|August|September|October|November|December)";
const DATES = new RegExp(`(\\d{1,2}) ${MONTH},? (\\d{4})|${MONTH} (\\d{1,2}),? (\\d{4})|(\\d{4})-(\\d{2})-(\\d{2})|${MONTH} (\\d{4})`, "g");
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Dates given on lines that talk about retirement, deprecation or switching something off, as YYYY-MM-DD. A month
 * without a day counts as its last day, so "December 2026" passes only once December is over.
 */
export function lifecycleDates(lines: string[]): string[] {
  return [...new Set(lines.flatMap(datesOnLine))].sort();
}

/** The first block with lifecycle wording that gives `date`. */
export function lifecycleLine(blocks: string[], date: string): string | undefined {
  return blocks.find((b) => datesOnLine(b).includes(date));
}

function datesOnLine(line: string): string[] {
  if (!LIFECYCLE_LINE.test(line)) return [];
  const out = new Set<string>();
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  for (const m of line.matchAll(DATES)) {
    if (m[1]) out.add(iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]));
    else if (m[4]) out.add(iso(+m[6], MONTHS.indexOf(m[4].toLowerCase()) + 1, +m[5]));
    else if (m[7]) out.add(iso(+m[7], +m[8], +m[9]));
    else if (m[10]) {
      const y = +m[11];
      const month = MONTHS.indexOf(m[10].toLowerCase()) + 1;
      out.add(iso(y, month, new Date(Date.UTC(y, month, 0)).getUTCDate()));
    }
  }
  return [...out].filter((d) => /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d));
}

const RETIRED_TITLE = /\((retired|deprecated|classic|archived)\)/i;
const RETIRED_NOTICE = /this (?:article|page|content|feature) (?:is|has been) (?:retired|deprecated|archived)|replaced (?:with|by) a new version|classic version of|no longer (?:supported|maintained|updated)/i;

/** Learn alert boxes and Google DevSite asides (lowercase classes). */
const ALERTS = ".NOTE, .IMPORTANT, .WARNING, .CAUTION, .alert, [role=alert], aside.caution, aside.warning, aside.deprecated, aside.special";

/**
 * Page-level retirement only: archived pages, "(retired)"-style titles, or a notice at the top, before the first
 * section heading. Notes about a feature retiring further down the page are tracked as terms instead, because they
 * rarely mean the page is obsolete.
 */
function retirement(title: string, learn: LearnMeta | undefined, roots: El[], headingSelector: string): string | undefined {
  if (learn?.archived) return "archived by Microsoft (moved to previous versions)";
  const t = title.match(RETIRED_TITLE);
  if (t) return `title marks it as ${t[1].toLowerCase()}`;
  // The first two notices above the first section heading.
  const alerts: El[] = [];
  for (const root of roots)
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(headingSelector)) break;
      if (el.matches(ALERTS) && !alerts.some((a) => a.contains(el))) alerts.push(el as El);
    }
  alerts.splice(2);
  for (const alert of alerts) {
    // Only the matched stock phrase is kept: notice prose isn't always openly licensed, and this ends up in state.json.
    const hit = collapse(alert.textContent ?? "").match(RETIRED_NOTICE);
    if (hit) return `a notice at the top says "${hit[0].toLowerCase()}"`;
  }
  return undefined;
}

/** Read a PDF: text of every page, so the fingerprint ignores metadata-only rebuilds. */
export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(collapse(content.items.map((it) => ("str" in it ? it.str : "")).join(" ")));
  }
  const info = (await doc.getMetadata().catch(() => undefined))?.info as { Title?: string } | undefined;
  await task.destroy();
  const sections: Section[] = pages.map((p, i) => ({ h: `Page ${i + 1}`, hash: shortHash(p).slice(0, 12), words: wordCount(p) }));
  const text = pages.join("\n");
  return {
    title: collapse(info?.Title ?? ""),
    deadlines: lifecycleDates(pages),
    blocks: pages,
    text,
    contentHash: shortHash(text),
    words: wordCount(text),
    sections,
    terms: findTerms(text),
    isLanding: false,
    matchedSelector: true,
  };
}
