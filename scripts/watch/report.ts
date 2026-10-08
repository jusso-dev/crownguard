import type { Finding, FindingKind, RunResult } from "./types";
import { isHttpUrl, truncate } from "./util";

/** GitHub rejects PR bodies over 65,536 characters. */
export const PR_BODY_LIMIT = 65_000;

export interface ReportOptions {
  /** Link to the workflow run, shown when the report had to be shortened. */
  runUrl?: string;
  maxChars?: number;
}

/**
 * Escape text from fetched pages and feeds for Markdown: no formatting, links, HTML, mentions or issue references
 * can be injected through a page title or feed entry.
 */
export function md(text: string, max = 200): string {
  return truncate(text, max)
    .replace(/&/g, "&amp;")
    .replace(/#(?=\d)/g, "&#35;")
    .replace(/@/g, "&#64;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]|~]/g, (c) => `\\${c}`)
    .replace(/^([#+\-=]|\d+\.)(\s)/, "\\$1$2")
    .replace(/(https?):\/\//gi, "$1&#58;//");
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
  { kind: "retired", heading: "Retired or deprecated", lead: "These pages are retired or archived, or newly carry deprecation or retirement language. Check whether the cited guidance still stands, and cite the current page." },
  { kind: "changed", heading: "Changed substantially", lead: "The cited guidance changed enough to re-read it against the questions that cite it." },
  { kind: "version", heading: "Newer version available", lead: "The publisher has a newer version than the one cited." },
  { kind: "candidate", heading: "New guidance to consider", lead: "New pages and announcements that may deserve a question or a citation." },
  { kind: "orphan", heading: "Not cited anywhere", lead: "No question, framework or platform cites these sources. Cite them or remove them." },
  { kind: "duplicate", heading: "Duplicate sources", lead: "These sources point at the same page." },
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
      lines.push("", `<details><summary>Diff excerpt${c.excerptNote ? ` (${md(c.excerptNote, 160)})` : ""}</summary>`, "", fence(c.excerpt, "diff"), "", "</details>");
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
      return `- ${link(f.title, f.url, 160)} · ${where}${c?.summary ? `\n  ${md(c.summary, 300)}` : ""}`;
    }
    case "orphan":
      return `- ${sourceLine(f)}`;
    default:
      return `- ${sourceLine(f)}${citedBy(f)}\n  ${md(f.detail, 400)}`;
  }
}

interface RenderParts {
  excerpts: boolean;
  info: boolean;
}

function render(result: RunResult, parts: RenderParts): string {
  const actionable = result.findings.filter((f) => f.actionable);
  const attention = new Set(actionable.filter((f) => f.kind !== "candidate").map((f) => f.sourceId ?? f.url)).size;
  const candidates = actionable.filter((f) => f.kind === "candidate").length;
  const out: string[] = [];
  if (result.simulated) out.push("> [!WARNING]", "> Simulated run to test the pull request path. Close this PR without merging.", "");
  out.push(`## Source watch · ${result.date}`, "");
  const headline = actionable.length
    ? `${plural(attention, "source needs", "sources need")} attention${candidates ? ` and ${plural(candidates, "new page or announcement", "new pages or announcements")} may be worth citing` : ""}.`
    : "Nothing needs attention.";
  out.push(`${headline} Checked ${result.stats.checked} sources.`, "");

  const counts = GROUPS.map((g) => [g, actionable.filter((f) => f.kind === g.kind)] as const).filter(([, list]) => list.length);
  if (counts.length) {
    out.push("| Needs attention | Count |", "|---|---|", ...counts.map(([g, list]) => `| ${g.heading} | ${list.length} |`), "");
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

  if (parts.info) {
    const minor = result.findings.filter((f) => !f.actionable && f.kind === "changed");
    const unverifiable = result.findings.filter((f) => f.kind === "unverifiable");
    const baseline = result.findings.filter((f) => f.kind === "baseline");
    const details = (summary: string, lines: string[]) => out.push(`<details><summary>${summary}</summary>`, "", ...lines, "", "</details>", "");
    if (minor.length) details(`For information: ${plural(minor.length, "minor change")}`, minor.map(findingLine));
    if (unverifiable.length) details(`For information: ${plural(unverifiable.length, "source")} couldn't be checked this run`, unverifiable.map(findingLine));
    if (baseline.length) details(`For information: ${plural(baseline.length, "new source")} fingerprinted for the first time`, baseline.map(findingLine));
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
  out.push("<details><summary>Run details</summary>", "", ...runLines, "", "</details>", "");

  out.push(
    "---",
    "",
    "**Handling this PR.** Merging accepts the new baseline in `watch/state.json` and any URL updates above, so the next run compares against it. " +
      "Fix broken or redirected sources and update affected questions in a separate PR; this branch is rewritten on every run. " +
      "Closing without merging just means the next run reports the same items again. See [the content guide](docs/content-guide.md#source-watch).",
  );
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/**
 * The Markdown report used as the PR body and job summary. When `maxChars` is set and the full report is too long,
 * diff excerpts go first, then the informational sections, then the report is cut at a line boundary.
 */
export function renderReport(result: RunResult, opts: ReportOptions = {}): string {
  const max = opts.maxChars ?? Infinity;
  for (const parts of [
    { excerpts: true, info: true },
    { excerpts: false, info: true },
    { excerpts: false, info: false },
  ]) {
    const text = render(result, parts);
    if (text.length <= max) return text;
  }
  const note = `\n\n_Report shortened to fit.${opts.runUrl && safeUrl(opts.runUrl) ? ` The full report is in the [workflow run](${safeUrl(opts.runUrl)}).` : ""}_\n`;
  const text = render(result, { excerpts: false, info: false });
  const cut = text.slice(0, max - note.length);
  return `${cut.slice(0, cut.lastIndexOf("\n"))}${note}`;
}

export function prTitle(result: RunResult): string {
  const actionable = result.findings.filter((f) => f.actionable);
  const sources = new Set(actionable.filter((f) => f.kind !== "candidate").map((f) => f.sourceId ?? f.url)).size;
  const candidates = actionable.filter((f) => f.kind === "candidate").length;
  const parts = [sources ? plural(sources, "source needs", "sources need") + " attention" : "", candidates ? plural(candidates, "new guidance item") : ""].filter(Boolean);
  return `${result.simulated ? "[simulated] " : ""}Source watch: ${parts.join(", ") || "baseline update"} (${result.date})`;
}

/** One line for logs and the workflow output. */
export function summaryLine(result: RunResult): string {
  const counts = new Map<string, number>();
  for (const f of result.findings) counts.set(f.kind + (f.kind === "changed" ? `:${f.severity}` : ""), (counts.get(f.kind + (f.kind === "changed" ? `:${f.severity}` : "")) ?? 0) + 1);
  const detail = [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
  return `${result.stats.checked} sources checked; ${result.actionable ? "action needed" : "nothing actionable"}${detail ? ` (${detail})` : ""}`;
}
