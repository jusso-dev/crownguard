import { DOMParser } from "linkedom";
import type { Fetcher, Finding, WatchState } from "./types";
import { collapse, isHttpUrl, normalizeUrl, truncate } from "./util";

export interface FeedDef {
  id: string;
  name: string;
  url: string;
  /** "posts": one announcement per entry (blogs). "release-notes": entries hold several typed notes under h3 headings. */
  kind: "posts" | "release-notes";
  /** Posts: report entries carrying one of these labels (Atom categories). */
  labels?: string[];
  /** Posts: report entries whose title matches. */
  include?: RegExp[];
  exclude?: RegExp[];
  /** Release notes: report notes of these types, e.g. "Deprecated". */
  noteTypes?: string[];
  /** Report entries or notes that link to a page crownguard cites. */
  linksToCited?: boolean;
  /** Most items reported per run. */
  max?: number;
  /** Quote a short excerpt (only for openly licensed feeds). */
  excerpts?: boolean;
}

export interface FeedNote {
  type: string;
  text: string;
  links: string[];
}

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  /** ISO timestamp the entry was first published. */
  published: string;
  labels: string[];
  links: string[];
  notes: FeedNote[];
  summary: string;
}

/** Plain text from an HTML fragment (Atom `type="html"` titles and summaries arrive entity-encoded). */
function stripTags(html: string): string {
  const decoded = html.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return collapse(decoded.replace(/<[^>]*>/g, " "));
}

function hrefs(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), base);
      if (u.protocol === "https:" || u.protocol === "http:") out.add(u.toString());
    } catch {
      // ignore malformed links
    }
  }
  return [...out];
}

/** Split release-note HTML into its typed notes: each `<h3>Type</h3>` starts one. */
function notesOf(html: string, base: string): FeedNote[] {
  const parts = html.split(/<h3[^>]*>/i).slice(1);
  return parts.map((part) => {
    const [heading, ...rest] = part.split(/<\/h3>/i);
    const body = rest.join(" ");
    return { type: stripTags(heading), text: stripTags(body), links: hrefs(body, base) };
  });
}

function iso(raw: string): string | undefined {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

type Node = { textContent: string | null };
const text = (el: Node | null | undefined) => collapse(el?.textContent ?? "");
/** Element text without collapsing: Atom html content is markup we still need to split. */
const raw = (el: Node | null | undefined) => el?.textContent ?? "";

/** Entries of an Atom or RSS 2.0 feed, newest first. Entries without a parseable date or http(s) link are dropped. */
export function parseFeed(xml: string): FeedEntry[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entries: FeedEntry[] = [];
  for (const e of doc.querySelectorAll("entry")) {
    const link =
      [...e.querySelectorAll("link")].find((l) => (l.getAttribute("rel") ?? "alternate") === "alternate")?.getAttribute("href") ??
      e.querySelector("link")?.getAttribute("href") ??
      "";
    const published = iso(text(e.querySelector("published")) || text(e.querySelector("updated")));
    if (!published || !isHttpUrl(link)) continue;
    const html = raw(e.querySelector("content")) || raw(e.querySelector("summary"));
    entries.push({
      id: text(e.querySelector("id")) || link,
      title: stripTags(text(e.querySelector("title"))),
      url: link,
      published,
      labels: [...e.querySelectorAll("category")].map((c) => c.getAttribute("term") ?? "").filter(Boolean),
      links: hrefs(html, link),
      notes: notesOf(html, link),
      summary: stripTags(html),
    });
  }
  for (const item of doc.querySelectorAll("item")) {
    const link = text(item.querySelector("link")) || text(item.querySelector("guid"));
    const published = iso(text(item.querySelector("pubDate")) || text(item.querySelector("date")));
    if (!published || !isHttpUrl(link)) continue;
    const html = raw(item.querySelector("description"));
    entries.push({
      id: text(item.querySelector("guid")) || link,
      title: stripTags(text(item.querySelector("title"))),
      url: link,
      published,
      labels: [...item.querySelectorAll("category")].map((c) => text(c)).filter(Boolean),
      links: hrefs(html, link),
      notes: notesOf(html, link),
      summary: stripTags(html),
    });
  }
  return entries.sort((a, b) => b.published.localeCompare(a.published));
}

/** Google Cloud links in release notes still use cloud.google.com; cited pages live on docs.cloud.google.com. */
function citedKey(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "cloud.google.com") u.hostname = "docs.cloud.google.com";
    u.search = "";
    return normalizeUrl(u.toString());
  } catch {
    return url;
  }
}

export interface FeedRun {
  findings: Finding[];
  feeds: WatchState["feeds"];
  skipped: string[];
}

/**
 * New entries since each feed's baseline timestamp that match its filters. The first time a feed is seen it only
 * records the newest timestamp, so the first run doesn't report a feed's whole history.
 * `cited` maps normalised cited URLs to source ids.
 */
export async function checkFeeds(defs: FeedDef[], baseline: WatchState["feeds"], fetcher: Fetcher, cited: Map<string, string>): Promise<FeedRun> {
  const run: FeedRun = { findings: [], feeds: {}, skipped: [] };
  const hits = (links: string[]) => [...new Set(links.map((l) => cited.get(citedKey(l))).filter((id): id is string => !!id))].sort();

  for (const def of defs) {
    const res = await fetcher.fetchPage(def.url, { accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" });
    const keepBaseline = () => {
      if (baseline[def.id]) run.feeds[def.id] = baseline[def.id];
    };
    if (res.outcome !== "ok" || res.body === undefined) {
      run.skipped.push(`${def.name} feed: ${res.error ?? res.outcome}`);
      keepBaseline();
      continue;
    }
    const entries = parseFeed(res.body);
    if (!entries.length) {
      run.skipped.push(`${def.name} feed: no entries could be read`);
      keepBaseline();
      continue;
    }
    const newest = entries[0].published;
    const since = baseline[def.id]?.latest;
    run.feeds[def.id] = { latest: since && since > newest ? since : newest };
    if (!since) continue;

    const found: Finding[] = [];
    for (const e of entries.filter((x) => x.published > since)) {
      const date = e.published.slice(0, 10);
      if (def.kind === "posts") {
        if (def.exclude?.some((re) => re.test(e.title))) continue;
        const why: string[] = [];
        const labels = e.labels.filter((l) => def.labels?.includes(l));
        if (labels.length) why.push(`labelled ${labels.join(", ")}`);
        else if (def.include?.some((re) => re.test(e.title))) why.push("security-related title");
        const linked = def.linksToCited ? hits(e.links) : [];
        if (linked.length) why.push(`links to cited ${linked.length === 1 ? "source" : "sources"} ${linked.join(", ")}`);
        if (!why.length) continue;
        found.push(candidate(def, e.title || e.url, e.url, date, why.join("; "), def.excerpts ? e.summary : undefined));
      } else {
        for (const note of e.notes) {
          const linked = def.linksToCited ? hits(note.links) : [];
          const typed = def.noteTypes?.some((t) => t.toLowerCase() === note.type.toLowerCase());
          if (!typed && !linked.length) continue;
          const first = note.text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? note.text;
          const why = [`${note.type} note`, ...(linked.length ? [`links to cited ${linked.length === 1 ? "source" : "sources"} ${linked.join(", ")}`] : [])];
          found.push(candidate(def, `${def.name}: ${truncate(first, 140)}`, e.url, date, why.join("; "), def.excerpts ? note.text : undefined));
        }
      }
    }
    const max = def.max ?? 10;
    run.findings.push(...found.slice(0, max));
    if (found.length > max) run.skipped.push(`${def.name} feed: ${found.length - max} more matching items not listed (cap ${max})`);
  }
  return run;
}

function candidate(def: FeedDef, title: string, url: string, published: string, why: string, excerpt?: string): Finding {
  return {
    kind: "candidate",
    title,
    url,
    actionable: true,
    detail: `${def.name}, ${published}: ${why}`,
    citedBy: [],
    candidate: { origin: "feed", feedId: def.id, feedName: def.name, published, summary: excerpt ? `${why}. ${truncate(excerpt, 280)}` : why },
  };
}

const releaseNotes = (slug: string, name: string): FeedDef => ({
  id: `gcp-${slug}`,
  name,
  url: `https://docs.cloud.google.com/feeds/${slug}-release-notes.xml`,
  kind: "release-notes",
  noteTypes: ["Deprecated", "Breaking", "Security", "Announcement"],
  linksToCited: true,
  excerpts: true,
  max: 5,
});

/**
 * Announcement feeds checked for new guidance. Google Workspace Updates is filtered to security and admin topics, or
 * posts that link to a page we cite. Google Cloud release notes are filtered to deprecations, breaking changes,
 * security notes and announcements, or notes that link to a page we cite. ASD, CIS and NIST feeds are filtered to the
 * frameworks crownguard maps to. (The Organization Policy and Architecture Center feeds were a year out of date in
 * October 2026, and the Microsoft 365 roadmap is a 1,900-item snapshot of mostly future features, so they aren't used;
 * new Microsoft Learn pages are found through the tables of contents instead.)
 */
export const FEEDS: FeedDef[] = [
  {
    id: "workspace-updates",
    name: "Google Workspace Updates",
    url: "https://workspaceupdates.googleblog.com/feeds/posts/default?redirect=false&max-results=50",
    kind: "posts",
    labels: ["Security and Compliance", "Admin console", "Identity", "SSO", "SAML", "MDM", "Google Vault", "Admin SDK"],
    include: [
      /\b(?:security|DLP|data loss prevention|data protection|2-Step Verification|2SV|passkeys?|context-aware access|retention|Vault|audit logs?|encryption|endpoint management|device management|phishing|malware|classification labels?|trust rules|super admins?|admin roles?)\b/i,
    ],
    linksToCited: true,
    max: 10,
  },
  releaseNotes("scc", "Security Command Center"),
  releaseNotes("iam", "Identity and Access Management"),
  releaseNotes("access-context-manager", "Access Context Manager"),
  releaseNotes("vpc-sc", "VPC Service Controls"),
  releaseNotes("kms", "Cloud Key Management Service"),
  releaseNotes("logging", "Cloud Logging"),
  releaseNotes("cloudresourcemanager", "Resource Manager"),
  releaseNotes("cloudidentity", "Cloud Identity"),
  releaseNotes("storage", "Cloud Storage"),
  releaseNotes("bigquery", "BigQuery"),
  releaseNotes("cloud-sql-mysql", "Cloud SQL for MySQL"),
  releaseNotes("dlp", "Sensitive Data Protection"),
  releaseNotes("backupdr", "Backup and DR"),
  {
    id: "asd-publications",
    name: "ASD publications",
    url: "https://www.cyber.gov.au/rss/publications",
    kind: "posts",
    include: [/\b(?:Essential Eight|Essentials|maturity model|ISM|Information Security Manual|Microsoft|Office|Google|cloud|identity|multi-factor|MFA|phishing-resistant|ransomware|backups?|privileged access)\b/i],
    max: 5,
  },
  {
    id: "asd-news",
    name: "ASD news",
    url: "https://www.cyber.gov.au/rss/news",
    kind: "posts",
    include: [/\b(?:Essential Eight|Essentials|maturity model|ISM|Information Security Manual)\b/i],
    max: 5,
  },
  {
    id: "cis-blog",
    name: "CIS blog",
    url: "https://www.cisecurity.org/feed/blog",
    kind: "posts",
    // One post a month lists every new and updated benchmark.
    include: [/^CIS Benchmarks \w+ \d{4} Update$/i],
    max: 3,
  },
  {
    id: "nist-cybersecurity-insights",
    name: "NIST Cybersecurity Insights",
    url: "https://www.nist.gov/blogs/cybersecurity-insights/rss.xml",
    kind: "posts",
    include: [/\b(?:CSF|Cybersecurity Framework)\b/i],
    max: 3,
  },
];
