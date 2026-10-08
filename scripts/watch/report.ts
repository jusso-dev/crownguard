import type { Finding, FindingKind, RunResult } from "./types";
import { isHttpUrl, truncate } from "./util";

/** GitHub rejects PR bodies over 65,536 characters. */
export const PR_BODY_LIMIT = 65_000;

export interface ReportOptions {
  /** Link to the workflow run, shown when the report had to be shortened. */
  runUrl?: string;
  /** Absolute link to the content guide's source watch section (a PR body can't use repo-relative links). */
  guideUrl?: string;
  maxChars?: number;
}

export const DEFAULT_GUIDE_URL = "https://github.com/jusso-dev/crownguard/blob/main/docs/content-guide.md#source-watch";

/**
 * Escape text from fetched pages and feeds for Markdown: no formatting, links, HTML, mentions or issue references
 * can be injected through a page title or feed entry.
 */
export function md(text: string, max = 200): string {
  // GitHub decodes entities before it links mentions and references, so those are broken with a zero-width space
  // (added after truncate(), whose collapse() would strip it).
  const zw = "\u200B";
  return truncate(text, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]|~]/g, (c) => `\\${c}`)
    .replace(/^([#+\-=]|\d+\.)(\s)/, "\\$1$2")
    .replace(/@/g, `@${zw}`)
    .replace(/#(?=\d)/g, `#${zw}`)
    .replace(/\b(gh)-(?=\d)/gi, `$1${zw}-`)
    .replace(/(https?):\/\//gi, `$1:/${zw}/`)
    .replace(/\bwww\./gi, `www${zw}.`)
    .replace(/\/(issues|pull|discussions)\/(?=\d)/gi, `/$1${zw}/`);
}

function safeUrl(url: string): string | undefined {
  if (!isHttpUrl(url)) return undefined;
  return new URL(url).href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

/** A link whose text is escaped and whose target is an http(s) URL, or plain escaped text when it isn't. */
export function link(text: string, url: string, max = 200): string {
  const href = safeUrl(url);
  return href ? `[${md(text, max)}](${href})` : md(text, max);
}

function code(text: string): string {
  const clean = truncate(text, 300).replace(/`/g, "'");
  return `\`${clean}\``;
}

function fence(body: string, lang = ""): string {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const GROUPS: { kind: FindingKind; heading: string; lead?: string; info?: boolean }[] = [
  { kind: "broken", heading: "Broken", lead: "These pages are gone or have failed on consecutive runs. Replace or remove the source, and check the questions that cite it." },
  { kind: "moved", heading: "Moved: URL updated in this PR", lead: "Each page now lives at a new address with the same content, so this PR updates the citation." },
  { kind: "redirected", heading: "Redirected elsewhere", lead: "These now land on a different page (often a hub or landing page). Pick the replacement guidance by hand." },
  { kind: "deadline", heading: "Dates passed", lead: "These pages give a date for a retirement or change that has now passed. Check the guidance and the questions that cite it." },
  { kind: "retired", heading: "Retired or deprecated", lead: "These pages are retired or archived, or newly carry deprecation or retirement language. Check whether the cited guidance still stands, and cite the current page." },
  { kind: "changed", heading: "Changed substantially", lead: "The cited guidance changed enough to re-read it against the questions that cite it." },
  {
    kind: "template",
    heading: "Site template changes",
    lead: "Many pages on one site changed together, which usually means the site's page furniture changed rather than its guidance. Merging re-baselines the listed pages: open one or two first, and if the watch now picks up navigation or boilerplate, fix the selectors in scripts/watch/hosts.ts instead.",
  },
  { kind: "version", heading: "Newer version available", lead: "The publisher has a newer version than the one cited." },
  { kind: "candidate", heading: "New guidance to consider", lead: "New pages and announcements that may deserve a question or a citation." },
  { kind: "unmonitored", heading: "Not being monitored", lead: "These couldn't be checked for a week of nights in a row. Check them by hand, or adjust their host profile." },
  { kind: "recovered", heading: "Recovered", lead: "Sources recorded as broken, unmonitored, redirected or retired that are fine again." },
  { kind: "baseline", heading: "Baseline updates", lead: "Bookkeeping: sources, feeds and Learn sections that started or stopped being tracked." },
];

function citedBy(f: Finding): string {
  if (!f.citedBy.length) return "";
  const shown = f.citedBy.slice(0, 12).map((c) => code(c.replace(/^(framework|platform):/, "$1 ")));
  return ` · cited by ${shown.join(", ")}${f.citedBy.length > 12 ? ` and ${f.citedBy.length - 12} more` : ""}`;
}

function sourceLine(f: Finding): string {
  return `${f.sourceId ? `${code(f.sourceId)} ` : ""}${link(f.title, f.url)}`;
}

function changeBlock(f: Finding, withExcerpts: boolean): string[] {
  const c = f.change;
  const lines = [`#### ${f.sourceId ? `${code(f.sourceId)} ` : ""}${md(f.title)}`, "", `${link("Open the page", f.newUrl ?? f.url)}${citedBy(f)}`, ""];
  lines.push(`- ${md(f.detail, 400)}`);
  if (c) {
    const sec: string[] = [];
    if (c.sectionsAdded.length) sec.push(`added ${c.sectionsAdded.slice(0, 6).map((s) => `“${md(s, 80)}”`).join(", ")}`);
    if (c.sectionsRemoved.length) sec.push(`removed ${c.sectionsRemoved.slice(0, 6).map((s) => `“${md(s, 80)}”`).join(", ")}`);
    if (c.sectionsChanged.length) sec.push(`edited ${c.sectionsChanged.slice(0, 6).map((s) => `“${md(s, 80)}”`).join(", ")}`);
    if (sec.length) lines.push(`- Sections: ${sec.join("; ")}`);
    if (c.termsAdded.length) lines.push(`- Now mentions: ${c.termsAdded.map(code).join(", ")}`);
    if (c.termsRemoved.length) lines.push(`- No longer mentions: ${c.termsRemoved.map(code).join(", ")}`);
    if (c.oldTitle && c.newTitle) lines.push(`- Title: “${md(c.oldTitle)}” → “${md(c.newTitle)}”`);
    if (c.newUpdated && c.newUpdated !== c.oldUpdated) lines.push(`- Page date: ${c.oldUpdated ?? "none"} → ${c.newUpdated}`);
    if (c.commits?.length) {
      const shown = c.commits.slice(0, 5).map((k) => `${link(k.sha.slice(0, 7), k.url)} ${k.date} ${md(k.message, 120)}`);
      lines.push(`- Commits: ${shown.join("; ")}${c.commits.length > 5 ? `; and ${c.commits.length - 5} more` : ""}${c.compareUrl ? ` (${link("full diff", c.compareUrl)})` : ""}`);
    } else if (c.compareUrl) lines.push(`- ${link("Full diff on GitHub", c.compareUrl)}`);
    if (c.noPreviousText) lines.push("- No earlier copy of the text was cached, so word counts are estimated from section sizes.");
    if (c.triage) {
      const t = c.triage;
      lines.push(`- Claude's read (${md(t.model, 40)}): **${t.impact}**. ${md(t.summary, 600)}`);
      for (const q of t.questions.slice(0, 8)) lines.push(`  - ${code(q.id)}: ${md(q.note, 300)}`);
    }
    if (withExcerpts && c.excerpt) {
      lines.push(
        "",
        "<details><summary>Diff excerpt</summary>",
        "",
        fence(c.excerpt, "diff"),
        "",
        `Quoted from ${link(f.title, f.newUrl ?? f.url, 120)} under ${c.excerptLicenceUrl ? link(c.excerptNote ?? "its licence", c.excerptLicenceUrl, 120) : md(c.excerptNote ?? "its licence", 120)}.`,
        "",
        "</details>",
      );
    } else if (c.excerptNote && !c.excerpt) lines.push(`- ${md(c.excerptNote, 200)}`);
  }
  lines.push("");
  return lines;
}

function findingLine(f: Finding): string {
  switch (f.kind) {
    case "moved":
      return `- ${sourceLine(f)}${citedBy(f)}\n  ${code(f.url)} → ${code(f.newUrl ?? "")}${f.applied ? "" : " (not applied)"}`;
    case "redirected":
      return `- ${sourceLine(f)}${citedBy(f)}\n  now lands on ${link(f.newUrl ?? "", f.newUrl ?? "", 120)}. ${md(f.detail, 300)}`;
    case "candidate": {
      const c = f.candidate;
      const where = c?.origin === "feed" ? `${md(c.feedName ?? "feed", 60)}${c.published ? `, ${c.published}` : ""}` : `new page beside ${code(c?.near ?? "")}`;
      const licence = c?.licence ? ` (text: ${link(c.licence.label, c.licence.url, 60)})` : "";
      return `- ${link(f.title, f.url, 160)} · ${where}${c?.summary ? `\n  ${md(c.summary, 300)}${licence}` : ""}`;
    }
    case "baseline":
      return f.sourceId ? `- ${sourceLine(f)}\n  ${md(f.detail, 400)}` : `- ${md(f.detail, 400)}`;
    case "template": {
      const held = f.held ?? [];
      // Every held page is listed: merging re-baselines exactly these.
      return `- ${link(f.title, f.url, 120)}: ${md(f.detail, 400)}\n\n  <details><summary>The ${held.length} pages</summary>\n\n  ${held.map(code).join(", ")}\n\n  </details>`;
    }
    default:
      return `- ${sourceLine(f)}${citedBy(f)}\n  ${md(f.detail, 400)}`;
  }
}

interface RenderParts {
  excerpts: boolean;
  info: boolean;
  runDetails: boolean;
  /** Set when the report had to be shortened: shown right under the headline. */
  shortened?: string;
}

function render(result: RunResult, parts: RenderParts, guide: string): string {
  const actionable = result.findings.filter((f) => f.actionable);
  const { attention, candidates, recovered, bookkeeping } = tally(result);
  const out: string[] = [];
  if (result.simulated) out.push("> [!WARNING]", "> Simulated run to test the pull request path. Close this PR without merging.", "");
  out.push(`## Source watch · ${result.date}`, "");
  const said = [
    attention ? `${plural(attention, "source needs", "sources need")} attention` : "",
    candidates ? `${plural(candidates, "new page or announcement", "new pages or announcements")} may be worth citing` : "",
    recovered ? `${plural(recovered, "source")} recovered` : "",
    bookkeeping ? `${plural(bookkeeping, "baseline update")}` : "",
  ].filter(Boolean);
  const headline = said.length ? `${said.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) : "Nothing needs attention.";
  out.push(`${headline} Checked ${result.stats.checked} sources.`, "");
  if (parts.shortened) out.push(`_${parts.shortened}_`, "");

  const counts = GROUPS.map((g) => [g, actionable.filter((f) => f.kind === g.kind)] as const).filter(([, list]) => list.length);
  if (counts.length) {
    out.push("| In this PR | Count |", "|---|---|", ...counts.map(([g, list]) => `| ${g.heading} | ${list.length} |`), "");
  }

  for (const [g, list] of counts) {
    out.push(`### ${g.heading}`, "");
    if (g.lead) out.push(g.lead, "");
    for (const f of list) {
      if (f.change) out.push(...changeBlock(f, parts.excerpts));
      else out.push(findingLine(f));
    }
    out.push("");
  }

  const acknowledged = result.findings.filter((f) => f.acknowledged);
  if (acknowledged.length) {
    out.push(
      "### Still unresolved",
      "",
      "Accepted into the baseline by an earlier PR but not fixed yet. They don't open a PR on their own.",
      "",
      ...acknowledged.map(findingLine),
      "",
    );
  }

  if (parts.info) {
    const minor = result.findings.filter((f) => !f.actionable && f.kind === "changed");
    const unverifiable = result.findings.filter((f) => f.kind === "unverifiable");
    const details = (summary: string, lines: string[]) => out.push(`<details><summary>${summary}</summary>`, "", ...lines, "", "</details>", "");
    if (minor.length) details(`For information: ${plural(minor.length, "minor change")}`, minor.map(findingLine));
    if (unverifiable.length) details(`For information: ${plural(unverifiable.length, "source")} couldn't be checked this run`, unverifiable.map(findingLine));
  }

  const s = result.stats;
  const hosts = Object.entries(s.byHost)
    .sort(([, a], [, b]) => b - a)
    .map(([h, n]) => `${md(h, 60)} ${n}`)
    .join(" · ");
  const outcomes = Object.entries(s.outcomes)
    .map(([o, n]) => `${o} ${n}`)
    .join(" · ");
  const runLines = [
    `- Hosts: ${hosts}`,
    `- Fetch outcomes: ${outcomes}`,
    `- GitHub API calls: ${s.githubCalls}${s.triageCalls ? ` · Claude triage calls: ${s.triageCalls}` : ""} · took ${Math.round(s.durationMs / 1000)}s`,
    ...s.skipped.map((x) => `- Skipped: ${md(x, 300)}`),
  ];
  if (parts.runDetails) out.push("<details><summary>Run details</summary>", "", ...runLines, "", "</details>", "");

  out.push(
    "---",
    "",
    "**Handling this PR.** Merging accepts the new baseline in `watch/state.json` and any URL updates above, so the next run compares against it. " +
      "Fix broken or redirected sources and update affected questions in a separate PR; this branch is rewritten on every run. " +
      `Closing without merging just means the next run reports the same items again. See ${link("the content guide", guide)}.`,
  );
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/**
 * The Markdown report used as the PR body and job summary. When `maxChars` is set and the full report is too long,
 * diff excerpts go first, then the informational sections, then the report is cut at a line boundary.
 */
export function renderReport(result: RunResult, opts: ReportOptions = {}): string {
  const max = opts.maxChars ?? Infinity;
  const guide = opts.guideUrl ?? DEFAULT_GUIDE_URL;
  const full = render(result, { excerpts: true, info: true, runDetails: true }, guide);
  if (full.length <= max) return full;
  const shortened = `Report shortened to fit.${opts.runUrl && safeUrl(opts.runUrl) ? ` The full report is in the [workflow run](${safeUrl(opts.runUrl)}).` : ""}`;
  for (const parts of [
    { excerpts: false, info: true, runDetails: true },
    { excerpts: false, info: false, runDetails: true },
    { excerpts: false, info: false, runDetails: false },
  ]) {
    const text = render(result, { ...parts, shortened }, guide);
    if (text.length <= max) return text;
  }
  // Last resort: cut at a line boundary and close any <details> left open so the rest of the page renders.
  const text = render(result, { excerpts: false, info: false, runDetails: false, shortened }, guide);
  let cut = text.slice(0, max - 200);
  cut = cut.slice(0, cut.lastIndexOf("\n"));
  const open = (cut.match(/<details>/g) ?? []).length - (cut.match(/<\/details>/g) ?? []).length;
  return `${cut}\n${"\n</details>\n".repeat(Math.max(0, open))}\n_…list cut short._\n`;
}

/** Counts behind the headline and title: sources needing attention, new guidance, recoveries and bookkeeping. */
function tally(result: RunResult) {
  const actionable = result.findings.filter((f) => f.actionable);
  const quiet = new Set(["candidate", "baseline", "recovered", "template"]);
  return {
    attention: new Set(actionable.filter((f) => !quiet.has(f.kind)).map((f) => f.sourceId ?? f.url)).size,
    templates: actionable.filter((f) => f.kind === "template").length,
    candidates: actionable.filter((f) => f.kind === "candidate").length,
    recovered: new Set(actionable.filter((f) => f.kind === "recovered").map((f) => f.sourceId)).size,
    bookkeeping: actionable.filter((f) => f.kind === "baseline").length,
  };
}

export function prTitle(result: RunResult): string {
  const { attention, candidates, recovered, templates } = tally(result);
  const parts = [
    attention ? plural(attention, "source needs", "sources need") + " attention" : "",
    templates ? plural(templates, "site template change") : "",
    candidates ? plural(candidates, "new guidance item") : "",
    recovered ? plural(recovered, "source") + " recovered" : "",
  ].filter(Boolean);
  return `${result.simulated ? "[simulated] " : ""}Source watch: ${parts.join(", ") || "baseline update"} (${result.date})`;
}

/** One line for logs and the workflow output. */
export function summaryLine(result: RunResult): string {
  const counts = new Map<string, number>();
  for (const f of result.findings) counts.set(f.kind + (f.kind === "changed" ? `:${f.severity}` : ""), (counts.get(f.kind + (f.kind === "changed" ? `:${f.severity}` : "")) ?? 0) + 1);
  const detail = [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
  return `${result.stats.checked} sources checked; ${result.actionable ? "action needed" : "nothing actionable"}${detail ? ` (${detail})` : ""}`;
}
