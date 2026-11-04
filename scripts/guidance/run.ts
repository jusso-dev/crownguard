import type { GuidanceGitHub, Release } from "./github";
import { compareTags, keepDates } from "./pins";
import type { GuidanceUpdater, ReviewItem, Workspace } from "./types";

export interface UpdateSummary {
  id: string;
  name: string;
  label: string;
  repo: string;
  status: "current" | "updated" | "error";
  /** The version the repo is on: the oldest of its pins. */
  from?: string;
  latest?: Release;
  /** Pins that disagreed with each other before the run (a bump that only half landed). */
  pins?: Record<string, string>;
  pinsMoved?: boolean;
  /** Repo files this update changes. */
  files: string[];
  review: ReviewItem[];
  notes: string[];
  error?: string;
}

export interface RunResult {
  date: string;
  changed: boolean;
  title: string;
  updates: UpdateSummary[];
  /** New text of every changed file, keyed by repo path. */
  files: Record<string, string>;
}

export interface RunOptions {
  updaters: GuidanceUpdater[];
  ws: Workspace;
  gh: GuidanceGitHub;
  only?: Set<string>;
  /** The same file on the open pull request's branch, so a rerun that only moves dates changes nothing. */
  previous?: (path: string) => string | undefined;
  log?: (line: string) => void;
}

/** The oldest of an updater's pins: what the repo can honestly claim to be checked against. */
export const currentVersion = (pins: Record<string, string>): string =>
  Object.values(pins).reduce((a, b) => (compareTags(a, b) <= 0 ? a : b));

export function prTitle(updates: UpdateSummary[]): string {
  const moved = updates.filter((u) => u.status === "updated" && u.files.length);
  if (!moved.length) return "Guidance update: nothing to change";
  const review = moved.some((u) => u.review.length);
  return `Update guidance: ${moved.map((u) => `${u.label} ${u.latest!.tag}`).join(", ")}${review ? " (review needed)" : ""}`;
}

export async function runUpdates(opts: RunOptions): Promise<RunResult> {
  const { gh, log = () => {} } = opts;
  const updates: UpdateSummary[] = [];
  const files: Record<string, string> = {};
  // Several updaters can edit one file (feeds.ts), so each one reads the edits made before it.
  const ws: Workspace = { ...opts.ws, read: (path) => files[path] ?? opts.ws.read(path) };
  for (const u of opts.updaters) {
    if (opts.only && !opts.only.has(u.id)) continue;
    const base = { id: u.id, name: u.name, label: u.label, repo: u.repo, files: [] as string[], review: [] as ReviewItem[], notes: [] as string[] };
    try {
      const pins = u.pins(ws);
      const from = currentVersion(pins);
      const split = new Set(Object.values(pins)).size > 1;
      const latest = await gh.latestRelease(u.repo);
      if (compareTags(latest.tag, from) <= 0) {
        log(`${u.id}: on ${from}, latest ${latest.tag}; nothing to do`);
        updates.push({ ...base, status: "current", from, latest, ...(split ? { pins } : {}) });
        continue;
      }
      log(`${u.id}: ${from} → ${latest.tag}`);
      const result = await u.update(ws, gh, latest, from);
      const changed: string[] = [];
      for (const [path, produced] of Object.entries(result.files)) {
        if (!u.paths.includes(path)) throw new Error(`${u.id} tried to write ${path}, which is not in its paths`);
        const text = keepDates(produced, ws.read(path), opts.previous?.(path));
        if (text === ws.read(path)) continue;
        files[path] = text;
        changed.push(path);
      }
      updates.push({ ...base, status: "updated", from, latest, ...(split ? { pins } : {}), pinsMoved: result.pinsMoved, files: changed, review: result.review, notes: result.notes });
    } catch (e) {
      log(`${u.id}: ${(e as Error).message}`);
      updates.push({ ...base, status: "error", error: (e as Error).message });
    }
  }
  const changed = Object.keys(files).length > 0;
  return { date: ws.today, changed, title: prTitle(updates), updates, files };
}

const code = (s: string) => `\`${s.replace(/`/g, "")}\``;

/** The pull request body: what moved, old → new, links to the releases, and what needs a human. */
export function renderPrBody(result: RunResult, opts: { runUrl?: string; guideUrl: string }): string {
  const lines: string[] = [
    "Nightly regeneration of the machine-readable guidance crownguard pins to upstream releases.",
    `Run on ${result.date}${opts.runUrl ? ` ([workflow run](${opts.runUrl}))` : ""}. How to handle this PR: [Guidance update](${opts.guideUrl}).`,
    "",
  ];
  const review = result.updates.flatMap((u) => u.review.map((r) => ({ u, r })));
  if (review.length) {
    lines.push("## Needs review", "");
    for (const { u, r } of review)
      lines.push(`- **${u.label}** ${code(r.id)} ${r.reason}; used by ${r.questions.join(", ")} in ${code(r.file)}.`);
    const blocked = result.updates.filter((u) => u.pinsMoved === false);
    if (blocked.length)
      lines.push(
        "",
        `The id lists moved, but ${blocked.map((u) => u.label).join(" and ")} pins (\`checkedAgainst\` and the source watch feed pin) did not, ` +
          "so `pnpm test` fails on this PR until the mappings stop using the removed ids. Fix the mappings on a branch of your own and merge that; this PR then moves the pins on its next run.",
      );
    lines.push("");
  }
  lines.push("## Updates", "", "| Source | From | To | Files |", "| --- | --- | --- | --- |");
  for (const u of result.updates) {
    const to = u.latest ? `[${u.latest.tag}](${u.latest.url}) (${u.latest.date})` : "";
    const status = u.status === "error" ? "failed, see below" : u.status === "current" ? "up to date" : u.files.map(code).join("<br>") || "no change";
    lines.push(`| ${u.name} | ${u.from ?? ""} | ${to} | ${status} |`);
  }
  lines.push("");
  for (const u of result.updates.filter((x) => x.notes.length || x.pins || x.error)) {
    lines.push(`### ${u.label}`, "");
    if (u.error) lines.push(`- Failed: ${u.error}`);
    if (u.pins) lines.push(`- Pins disagreed before this run: ${Object.entries(u.pins).map(([k, v]) => `${code(k)} ${v}`).join(", ")}.`);
    for (const n of u.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push("Merging accepts the regenerated files. Check the diff against each release's notes before merging.");
  return `${lines.join("\n")}\n`;
}
