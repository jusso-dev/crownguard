/**
 * Shared types for the nightly source watch (`pnpm watch:sources`).
 *
 * The watch fetches every page cited in `content/sources/`, fingerprints its main content, and compares the
 * fingerprints with the committed baseline in `watch/state.json`. Page text is never committed: Google Workspace
 * Help and CIS pages aren't openly licensed, so full-text snapshots used for diffs live only in the Actions cache.
 */

/** How much of a page the report may quote. */
export type ExcerptPolicy = "cc-by-4.0" | "public-domain" | "none";

/** Per-host rules for fetching and extracting a page. */
export interface HostProfile {
  /** Exact hostname, e.g. `learn.microsoft.com`. */
  host: string;
  /** Short label used in the report, e.g. `Microsoft Learn`. */
  label: string;
  /** CSS selectors tried in order for the main content element; the first match wins. */
  content: string[];
  /** Selectors removed from the content element before reading text (feedback widgets, TOCs, timestamps). */
  strip: string[];
  /** Text patterns removed before hashing because they change without the guidance changing. */
  volatile: RegExp[];
  /** Selectors for the heading elements that split the page into sections. */
  sectionHeadings: string;
  /** How many elements the first content selector must match; anything else means the page layout changed. */
  expectRoots?: number;
  /** Where the page title comes from. `og` takes og:title up to the first "|" (DevSite h1s contain hidden widget text). */
  title?: "h1" | "og";
  /** Query parameters added when fetching (never stored), e.g. `hl=en` to pin Google's language. */
  fetchParams?: Record<string, string>;
  /** The page's `<html lang>` must match, or the run treats it as a wrong-language response rather than a change. */
  lang?: RegExp;
  /** The site stamps "last updated" dates on whole-site rebuilds, so the date says nothing about this page. */
  ignoreUpdated?: boolean;
  excerpts: ExcerptPolicy;
  /** Licence line shown under excerpts, e.g. `CC BY 4.0`. */
  licence?: string;
  /** The host challenges automated clients from cloud IP ranges; a challenge is "unverifiable", never "broken". */
  botProtected?: boolean;
  /** Maximum concurrent requests to this host. */
  concurrency: number;
  /** Pause after each request to this host (robots.txt crawl-delay). */
  delayMs?: number;
  /** Retries after a network error, 5xx or 429 (default 2). */
  retries?: number;
  /** The host's firewall drops unwanted clients by resetting or hanging the connection, so a network error means "blocked", not "down". */
  blockedOnNetworkError?: boolean;
  /** Element holding the page's own "last reviewed/updated" date (its datetime attribute or text). */
  updatedSelector?: string;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export type FetchOutcome =
  /** 2xx with a body. */
  | "ok"
  /** 404 or 410: the page is gone. */
  | "not-found"
  /** Another 4xx that isn't a challenge (401, 400, 451...). */
  | "http-error"
  /** 5xx or 429 that persisted through retries. */
  | "server-error"
  /** Bot protection, consent or sign-in wall. */
  | "challenge"
  /** DNS, TLS, reset or timeout. */
  | "network";

export interface FetchResult {
  requestedUrl: string;
  /** URL of the final response after following redirects. Equals `requestedUrl` when there were none. */
  finalUrl: string;
  /** Each redirect response in order (its URL and status), excluding the final response. */
  redirects: RedirectHop[];
  /** Final HTTP status, 0 for network errors. */
  status: number;
  outcome: FetchOutcome;
  contentType?: string;
  /** Decoded text for HTML, XML, JSON and text responses. */
  body?: string;
  /** Raw bytes for everything else (PDF). */
  bytes?: Uint8Array;
  /** Short reason for non-ok outcomes. */
  error?: string;
  elapsedMs: number;
}

export interface Fetcher {
  fetchPage(url: string, opts?: { accept?: string }): Promise<FetchResult>;
}

export interface Section {
  /** Heading text, whitespace collapsed. */
  h: string;
  /** Short hash of the section's normalised text (heading excluded). */
  hash: string;
  words: number;
}

/** Microsoft Learn publishing metadata read from the page's `<meta>` tags. */
export interface LearnMeta {
  /** Repo named by `original_content_git_url`, e.g. `MicrosoftDocs/entra-docs-pr` (often private). */
  sourceRepo: string;
  /** Branch named by `original_content_git_url`, e.g. `live`. */
  sourceBranch: string;
  /** Path of the Markdown file in the repo, e.g. `docs/identity/conditional-access/overview.md`. */
  path: string;
  /** `git_commit_id` meta: last commit that changed this file (the same SHA exists in the public mirror). */
  commit?: string;
  /** Public mirror named by `github_feedback_content_git_url`, e.g. `MicrosoftDocs/entra-docs`. */
  publicRepo?: string;
  /** Branch named by `github_feedback_content_git_url`, e.g. `main`. */
  publicBranch?: string;
  /** Path of the file in the public mirror (usually the same as `path`). */
  publicPath?: string;
  /** `ms.date` meta normalised to YYYY-MM-DD: the date the author last reviewed the page. */
  msDate?: string;
  /** `page_type` or `ms.topic` meta, e.g. `conceptual`, `landing-page`. */
  pageType?: string;
  /** `document_id` meta. It survives a move or rename and changes when content is replaced or merged. */
  documentId?: string;
  /** `toc_rel` meta: the section's table of contents, relative to the page. */
  tocRel?: string;
  /** `is_archived` meta or the archive header: the page was moved to /previous-versions/. */
  archived?: boolean;
}

/** What the watch reads from a fetched page. */
export interface Extracted {
  title: string;
  /** Normalised main-content text: one block per line, whitespace collapsed, volatile text removed. */
  text: string;
  /** Short hash of `text`. */
  contentHash: string;
  words: number;
  sections: Section[];
  /** Page-declared last-updated date as YYYY-MM-DD, when the page states one. */
  updated?: string;
  learn?: LearnMeta;
  /** Lowercased tracked terms present in `text` (lifecycle and licence vocabulary), sorted. See `TRACKED_TERMS`. */
  terms: string[];
  /** Hub, landing or table-of-contents pages; a redirect to one is "redirected elsewhere", not "moved". */
  isLanding: boolean;
  /** Why the page itself counts as retired (archived, "(retired)" or "(classic)" in its title, a retirement notice at the top). */
  retired?: string;
  /** False when no content selector matched and the extractor fell back to `<body>`. */
  matchedSelector: boolean;
  /** `<html lang>`. */
  lang?: string;
}

export type SourceStatus = "ok" | "broken" | "unverifiable";

/** Committed fingerprint of one source. Deterministic: no fields that change when the page doesn't. */
export interface SourceState {
  url: string;
  /** Where `url` redirects, when that differs from `url` after normalisation. */
  finalUrl?: string;
  status: SourceStatus;
  httpStatus?: number;
  title?: string;
  contentHash?: string;
  words?: number;
  sections?: Section[];
  updated?: string;
  learn?: {
    /** Public mirror, e.g. `MicrosoftDocs/entra-docs`. Absent when the docs repo has no public mirror. */
    repo?: string;
    branch?: string;
    path: string;
    commit?: string;
    documentId?: string;
  };
  terms?: string[];
  /** Version strings bound to the product named in the source title, e.g. `["1.4.0"]`. */
  versions?: string[];
  /** Why the page itself is retired, if it is. */
  retired?: string;
}

export interface WatchState {
  version: 1;
  sources: Record<string, SourceState>;
  /** Learn table-of-contents sections that hold cited pages, keyed `<toc.json URL>#<section path>`, mapped to the sorted URLs of every page in that section. */
  neighbours: Record<string, string[]>;
  /** Feed id to the ISO timestamp of the newest entry already reviewed. */
  feeds: Record<string, { latest: string }>;
}

export type FindingKind =
  /** 404/410, or a fetch failure that persisted across consecutive runs. */
  | "broken"
  /** Redirects to the same document at a new URL; the URL is updated in this PR. */
  | "moved"
  /** Redirects to a different page (hub, landing or unrelated); someone must pick a replacement. */
  | "redirected"
  /** The page newly carries retirement or deprecation language. */
  | "retired"
  /** The cited guidance changed. `severity` says whether it needs a look. */
  | "changed"
  /** The product named in the source title has a newer version than the one cited. */
  | "version"
  /** New guidance worth considering as a source. */
  | "candidate"
  /** A source no question or framework cites. */
  | "orphan"
  /** Two sources point at the same page. */
  | "duplicate"
  /** Couldn't be checked this run (bot protection, transient failure). Informational. */
  | "unverifiable"
  /** First fingerprint for a source added since the baseline. Informational. */
  | "baseline";

export interface Commit {
  sha: string;
  /** YYYY-MM-DD. */
  date: string;
  /** First line of the commit message, plain text. */
  message: string;
  url: string;
}

export interface Triage {
  impact: "none" | "review" | "update";
  summary: string;
  questions: { id: string; note: string }[];
  model: string;
}

export interface ChangeDetail {
  /** Share of words added or removed, relative to old + new word counts (0..1). */
  changedRatio: number;
  wordsAdded: number;
  wordsRemoved: number;
  sectionsAdded: string[];
  sectionsRemoved: string[];
  sectionsChanged: string[];
  /** Tracked terms that newly appear / no longer appear. */
  termsAdded: string[];
  termsRemoved: string[];
  oldTitle?: string;
  newTitle?: string;
  /** Page-declared update date before and after. */
  oldUpdated?: string;
  newUpdated?: string;
  /** Learn: commits to the page's Markdown file since the baseline commit, newest first. */
  commits?: Commit[];
  /** Learn: GitHub compare link between the baseline and current commit. */
  compareUrl?: string;
  /** Unified-diff excerpt; only when the host's licence allows quoting. */
  excerpt?: string;
  /** Licence attribution for the excerpt, or why there is none. */
  excerptNote?: string;
  /** No earlier text was available to diff against, so word counts are estimates from section hashes. */
  noPreviousText?: boolean;
  triage?: Triage;
}

export interface CandidateDetail {
  origin: "learn-toc" | "feed";
  feedId?: string;
  feedName?: string;
  /** YYYY-MM-DD. */
  published?: string;
  /** Cited source whose Learn section the page was found in. */
  near?: string;
  /** Short plain-text description from front matter or the feed, truncated. */
  summary?: string;
}

export interface Finding {
  kind: FindingKind;
  /** Absent for candidates. */
  sourceId?: string;
  /** Source title from content/sources, or the candidate's title. Plain text; the report escapes it. */
  title: string;
  url: string;
  /** Target of a move or redirect. */
  newUrl?: string;
  severity?: "major" | "minor";
  /** True when the finding needs a maintainer: only actionable findings open a PR. */
  actionable: boolean;
  /** One-line plain-text summary. */
  detail: string;
  /** Question and framework ids that cite this source. */
  citedBy: string[];
  change?: ChangeDetail;
  candidate?: CandidateDetail;
  /** The fix was written to content/sources in this run. */
  applied?: boolean;
}

export interface RunStats {
  checked: number;
  byHost: Record<string, number>;
  outcomes: Partial<Record<FetchOutcome, number>>;
  githubCalls: number;
  triageCalls: number;
  durationMs: number;
  /** Work the run skipped and why (rate limits, caps); never silent. */
  skipped: string[];
}

export interface RunResult {
  /** YYYY-MM-DD the run is stamped with. */
  date: string;
  findings: Finding[];
  actionable: boolean;
  /** The state to commit. Equals the baseline byte-for-byte when nothing changed. */
  state: WatchState;
  /** Source id to the new URL, for moves applied to content/sources. */
  urlUpdates: Record<string, string>;
  stats: RunStats;
  simulated: boolean;
}

/** Snapshot store for diffs and failure counters, kept in the Actions cache between runs. */
export interface WatchCache {
  readSnapshot(sourceId: string, hash: string): string | undefined;
  writeSnapshot(sourceId: string, hash: string, text: string): void;
  /** Consecutive failed runs per source id. */
  failures: Record<string, number>;
  /** Delete snapshots except the listed hashes per source id. */
  prune(keep: Record<string, string[]>): void;
  save(): void;
}
