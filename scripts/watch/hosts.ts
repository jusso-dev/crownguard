import type { HostProfile } from "./types";

/** Fallback for hosts without a profile: the usual main-content containers, no quoting. */
export const DEFAULT_PROFILE: HostProfile = {
  host: "*",
  label: "Other",
  content: ["main article", "article", "main", "[role=main]", "#content", ".content"],
  strip: ["nav", "header", "footer", "aside", "[role=navigation]", "[role=banner]", "[role=contentinfo]", "[hidden]", "[aria-hidden=true]"],
  volatile: [],
  sectionHeadings: "h2, h3",
  excerpts: "none",
  concurrency: 2,
};

export const PROFILES: HostProfile[] = [
  {
    host: "learn.microsoft.com",
    label: "Microsoft Learn",
    // Exactly two parts on every Learn article: the h1 block and the body. Tab panels are [hidden]; keep them.
    content: ["main#main div[data-main-column] > div > div.content", "main#main .content", "main"],
    expectRoots: 2,
    strip: [
      "#article-metadata",
      "#article-metadata-footer",
      "#user-feedback",
      "[data-id=ai-summary]",
      "#ms--ai-summary-cta",
      "#ms--ai-summary-header",
      "nav.doc-outline",
      "#center-doc-outline",
      "#ms--in-this-article",
      "#site-user-feedback-footer",
      "#ms--additional-resources-mobile",
      "#ms--inline-notifications",
      ".visually-hidden",
      "[data-bi-name=permission-content-unauthorized-private]",
    ],
    volatile: [],
    sectionHeadings: "h2, h3",
    // Learn's terms of use don't allow republishing; only pages whose public GitHub mirror carries an open licence
    // may be quoted (LEARN_MIRROR_LICENCES).
    excerpts: "none",
    concurrency: 4,
  },
];

/** Licences of the public MicrosoftDocs mirrors (checked October 2026). Pages from other Learn repos aren't quoted. */
export const LEARN_MIRROR_LICENCES: Record<string, { label: string; url: string }> = {
  "MicrosoftDocs/entra-docs": { label: "MIT licence, © Microsoft Corporation", url: "https://github.com/MicrosoftDocs/entra-docs/blob/main/LICENSE" },
  "MicrosoftDocs/azure-docs": { label: "CC BY 4.0, Microsoft", url: "https://creativecommons.org/licenses/by/4.0/" },
  "MicrosoftDocs/power-platform": { label: "CC BY 4.0, Microsoft", url: "https://creativecommons.org/licenses/by/4.0/" },
};

/** The licence under which text from `url` may be quoted, or undefined when it may not. */
export function licenceFor(url: string, repo?: string): { label: string; url?: string } | undefined {
  if (!URL.canParse(url)) return undefined;
  const p = profileFor(new URL(url).hostname.toLowerCase());
  if (p.excerpts !== "none") return { label: p.licence ?? p.label, url: p.licenceUrl };
  return repo ? LEARN_MIRROR_LICENCES[repo] : undefined;
}

/** Google's DevSite engine serves both Workspace Help and Cloud docs: same markup, CC BY 4.0 text. */
const devsite = (host: string, label: string): HostProfile => ({
  host,
  label,
  content: ["article.devsite-article div.devsite-article-body"],
  expectRoots: 1,
  strip: [
    "devsite-hats-survey",
    "devsite-thumb-rating",
    "devsite-feedback",
    "devsite-toc",
    "devsite-actions",
    "devsite-bookmark",
    "devsite-video",
    "devsite-key-takeaways-panel",
    "cloud-free-trial",
    ".nocontent",
  ],
  volatile: [],
  sectionHeadings: "h2, h3",
  title: "og",
  // Without hl=en, some requests land on a random machine translation.
  fetchParams: { hl: "en" },
  lang: /^en(?:-US)?$/i,
  // "Last updated" is stamped on every page at each site rebuild.
  ignoreUpdated: true,
  excerpts: "cc-by-4.0",
  licence: "CC BY 4.0, Google",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  concurrency: 3,
});

PROFILES.push(
  devsite("knowledge.workspace.google.com", "Google Workspace Help"),
  devsite("docs.cloud.google.com", "Google Cloud documentation"),
  {
    host: "support.google.com",
    label: "Google Help Center",
    content: ["article.article section.article-container div.article-content-container div.cc"],
    expectRoots: 1,
    strip: [".article-survey-container", ".need-more-help-container"],
    volatile: [],
    sectionHeadings: "h2, h3",
    fetchParams: { hl: "en" },
    lang: /^en(?:-US)?$/i,
    // Help Center text has no open licence: hashes and section names only.
    excerpts: "none",
    concurrency: 2,
  },
  {
    host: "www.google.com",
    label: "Google",
    content: ["main div.main-content"],
    expectRoots: 1,
    strip: ["i.material-icons", ".glue-c-popover__close-btn", "ul.glue-pagination-page-list", ".photo-credit"],
    volatile: [],
    sectionHeadings: "h2, h3",
    title: "og",
    fetchParams: { hl: "en" },
    lang: /^en(?:-US)?$/i,
    excerpts: "none",
    concurrency: 1,
  },
  {
    host: "www.cisecurity.org",
    label: "CIS",
    // The benchmark page lists every published version, e.g. "Microsoft 365 Foundations (7.0.0)".
    content: ["main .template-main-content.benchmark"],
    expectRoots: 1,
    strip: [".c-site__infoHub", ".template-sidebar"],
    volatile: [],
    sectionHeadings: "h2, h3, h5",
    excerpts: "none",
    botProtected: true,
    concurrency: 1,
    // robots.txt asks for 10 seconds between requests.
    delayMs: 10_000,
  },
  {
    host: "www.cyber.gov.au",
    label: "Cyber.gov.au",
    // The body plus the download link, whose text carries the edition, e.g. "(November 2023)".
    content: ["main article.node--type-publication .field--name--page-components, main .direct-downloads"],
    // Both parts must match: the body alone or the download link alone means the theme changed.
    expectRoots: 2,
    strip: [".reading-time-badge-inc", ".readspeaker", ".cga-glossary-search", "details.content-page-sidebar__audience-topics", ".direct-download__file-size"],
    volatile: [],
    sectionHeadings: "h2, h3",
    updatedSelector: ".field--name--date-last-reviewed time[datetime]",
    excerpts: "cc-by-4.0",
    licence: "CC BY 4.0, © Commonwealth of Australia (ASD)",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    botProtected: true,
    // Its firewall resets or hangs connections it doesn't like instead of answering, so retrying only wastes time.
    blockedOnNetworkError: true,
    retries: 0,
    concurrency: 1,
    delayMs: 1_000,
  },
  {
    host: "nvlpubs.nist.gov",
    label: "NIST",
    content: [],
    strip: [],
    volatile: [],
    sectionHeadings: "h2, h3",
    excerpts: "public-domain",
    licence: "public domain, US Government work (NIST)",
    botProtected: true,
    concurrency: 1,
  },
  {
    host: "www.homeaffairs.gov.au",
    label: "Department of Home Affairs",
    // Cited as PDFs (the IDCF and its guide). The framework is CC BY 4.0 but its companions are CC BY 3.0 AU, so no quoting.
    content: ["main", "#content"],
    strip: [],
    volatile: [],
    sectionHeadings: "h2, h3",
    excerpts: "none",
    concurrency: 1,
  },
  {
    host: "www.soc-cmm.com",
    label: "SOC-CMM",
    // Answers 403 to non-browser user agents (checked 2026-10-09). The watch never pretends to be a browser, so these
    // sources stay "unverifiable" until SOC-CMM allows its user agent; the community feed below covers new releases.
    content: ["div.content[id^=content_]"],
    expectRoots: 1,
    strip: ["#cookiemelding", ".survey_banner", "#main_nav", ".breadcrumb", "#newsletter", "#cta", "#footer", "#bottom_placeholder"],
    volatile: [],
    sectionHeadings: "h1, h2, h3",
    // The site's prose states no licence (only the tools are CC BY-SA), so no quoting.
    excerpts: "none",
    concurrency: 1,
    // robots.txt asks for 10 seconds between requests.
    delayMs: 10_000,
  },
  {
    host: "www.microsoft.com",
    label: "Microsoft",
    content: ["main.microsoft-template-layout-container"],
    expectRoots: 1,
    strip: [],
    volatile: [],
    sectionHeadings: "h2, h3",
    excerpts: "none",
    botProtected: true,
    concurrency: 1,
  },
);

const byHost = new Map(PROFILES.map((p) => [p.host, p]));

/** True when the host has its own profile, so a selector miss means its layout changed. */
export function hasProfile(host: string): boolean {
  return byHost.has(host);
}

export function profileFor(host: string): HostProfile {
  return byHost.get(host) ?? { ...DEFAULT_PROFILE, host };
}
