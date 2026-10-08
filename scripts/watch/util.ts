import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level, two-space indent and a trailing newline, so diffs stay stable. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** First 16 hex characters of the SHA-256 of `text`. */
export function shortHash(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** Collapse runs of whitespace to one space and trim. Zero-width, bidirectional and control characters are dropped. */
export function collapse(text: string): string {
  return text
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- removing control characters from page text is the point
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

/**
 * Canonical form of a URL for comparisons: lowercase scheme and host, no default port, no fragment, no trailing
 * slash (except the root). Learn and www.microsoft.com paths are case-insensitive, so they are lowercased too. Query
 * strings are kept because Google Help uses them for locale. Returns the input unchanged when it isn't a URL.
 */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  u.hash = "";
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (u.hostname === "learn.microsoft.com" || u.hostname === "www.microsoft.com") path = path.toLowerCase();
  const port = u.port && !((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) ? `:${u.port}` : "";
  return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port}${path}${u.search}`;
}

export function sameUrl(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Only http(s) URLs are ever followed, stored or linked. */
export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const TITLE_SUFFIXES = [
  /\s*[|\-–—]\s*Microsoft Learn$/i,
  /\s*[|\-–—]\s*Microsoft Docs$/i,
  /\s*[|\-–—]\s*Google Workspace Admin Help$/i,
  /\s*[|\-–—]\s*Google Workspace Knowledge Center$/i,
  /\s*[|\-–—]\s*Google Workspace(?: Help)?$/i,
  /\s*[|\-–—]\s*Google Cloud(?: Documentation)?$/i,
  /\s*[|\-–—]\s*Google Help$/i,
  /\s*[|\-–—]\s*Cyber\.gov\.au$/i,
  /\s*[|\-–—]\s*CIS$/i,
  /\s*[|\-–—]\s*Microsoft$/i,
];

/** Page title without the site name the page appends to it. */
export function cleanTitle(title: string): string {
  let t = collapse(title);
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of TITLE_SUFFIXES) {
      const next = t.replace(re, "");
      if (next !== t && next.length > 0) {
        t = next;
        changed = true;
      }
    }
  }
  return t;
}

const STOPWORDS = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "on", "with", "your", "by", "or", "how", "use", "using", "about"]);

function titleWords(title: string): Set<string> {
  return new Set(
    cleanTitle(title)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity of the significant words in two titles (0..1). Two empty titles count as identical. */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 && wb.size === 0) return 1;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/**
 * Lifecycle and licence vocabulary worth flagging when it appears in or disappears from a cited page. Lifecycle
 * phrases are specific on purpose: "legacy" alone would match "block legacy authentication" on half the pages.
 */
export const TRACKED_TERMS: Record<"lifecycle" | "licence", string[]> = {
  lifecycle: [
    "(deprecated)",
    "is deprecated",
    "has been deprecated",
    "will be deprecated",
    "deprecation",
    "is retired",
    "has been retired",
    "will be retired",
    "retirement date",
    "will be removed",
    "will be discontinued",
    "will be shut down",
    "will be turned down",
    "shut down on",
    "shuts down on",
    "no longer supported",
    "is no longer available",
    "end of support",
    "end of life",
    "end of sale",
    "reached its end of support",
    "discontinued",
    "is being replaced",
    "is being retired",
    "are being retired",
    "will retire",
    "will be replaced by",
    "has been replaced by",
    "superseded by",
    "update your bookmarks",
  ],
  licence: [
    "microsoft 365 e3",
    "microsoft 365 e5",
    "office 365 e3",
    "office 365 e5",
    "business premium",
    "business basic",
    "business standard",
    "entra id p1",
    "entra id p2",
    "entra id governance",
    "entra suite",
    "microsoft 365 copilot",
    "e5 security",
    "e5 compliance",
    "frontline",
    "enterprise plus",
    "enterprise standard",
    "business plus",
    "business starter",
    "education plus",
    "education standard",
    "frontline standard",
    "frontline starter",
    "cloud identity premium",
    "security command center enterprise",
    "security command center premium",
  ],
};

const ALL_TERMS = [...TRACKED_TERMS.lifecycle, ...TRACKED_TERMS.licence];
const TERM_PATTERNS = ALL_TERMS.map(
  (t) => [t, new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu")] as const,
);

/** Tracked terms present in `text`, lowercased and sorted. */
export function findTerms(text: string): string[] {
  return TERM_PATTERNS.filter(([, re]) => re.test(text))
    .map(([t]) => t)
    .sort();
}

export function isLifecycleTerm(term: string): boolean {
  return TRACKED_TERMS.lifecycle.includes(term);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse the date formats pages use into YYYY-MM-DD: ISO (`2026-09-30`, `2026-09-30T...`), US numeric (`09/30/2026`,
 * Learn's `ms.date`) and English month names (`30 September 2026`, `September 30, 2026`). Undefined when unparseable.
 */
export function toIsoDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [m, d, y] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/))) [d, m, y] = [+match[1], MONTHS[match[2].slice(0, 3).toLowerCase()], +match[3]];
  else if ((match = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/))) [m, d, y] = [MONTHS[match[1].slice(0, 3).toLowerCase()], +match[2], +match[3]];
  else return undefined;
  if (!m || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Today's date as YYYY-MM-DD in UTC, or `WATCH_DATE` when set (tests). */
export function runDate(env: NodeJS.ProcessEnv = process.env): string {
  return env.WATCH_DATE && /^\d{4}-\d{2}-\d{2}$/.test(env.WATCH_DATE) ? env.WATCH_DATE : new Date().toISOString().slice(0, 10);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run at most `n` tasks at once. */
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= n) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

/** Truncate to `max` characters on a word boundary, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  const t = collapse(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
