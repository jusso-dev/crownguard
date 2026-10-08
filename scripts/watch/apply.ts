import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { WatchState } from "./types";
import { escapeRegExp, isHttpUrl, stableStringify } from "./util";

export interface UrlUpdate {
  id: string;
  url: string;
  /** YYYY-MM-DD written to `retrieved`. */
  retrieved: string;
}

/** Characters that may appear unquoted in a YAML plain scalar URL. Anything else gets double quotes. */
const PLAIN_URL = /^https?:\/\/[A-Za-z0-9\-._~/?&=%+,;:@!$()*[\]']+$/;

function yamlScalar(url: string): string {
  return PLAIN_URL.test(url) && !url.includes(" #") ? url : JSON.stringify(url);
}

/**
 * Rewrite the `url:` and `retrieved:` lines of the listed sources in place, leaving every other line untouched so
 * the PR diff shows only what moved. `files` maps paths under content/sources to their text. Returns the changed
 * files only. Throws if a source can't be found, a URL isn't http(s), or the edited file doesn't parse back to the
 * same entries with just those two fields changed.
 */
export function applyUrlUpdates(files: Record<string, string>, updates: UrlUpdate[]): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const update of updates) {
    if (!isHttpUrl(update.url)) throw new Error(`${update.id}: refusing non-http URL ${update.url}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(update.retrieved)) throw new Error(`${update.id}: bad retrieved date ${update.retrieved}`);
    const path = Object.keys(files).find((p) => new RegExp(`^\\s*-\\s+id:\\s*["']?${escapeRegExp(update.id)}["']?\\s*(#.*)?$`, "m").test(changed[p] ?? files[p]));
    if (!path) throw new Error(`${update.id}: not found in content/sources`);
    const before = changed[path] ?? files[path];
    const after = editEntry(before, update);
    verify(before, after, update);
    changed[path] = after;
  }
  return changed;
}

function editEntry(text: string, { id, url, retrieved }: UrlUpdate): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*["']?${escapeRegExp(id)}["']?\\s*(#.*)?$`).test(l));
  const indent = lines[start].match(/^(\s*)-/)![1].length;
  let end = start + 1;
  while (end < lines.length) {
    const m = lines[end].match(/^(\s*)-\s/);
    if (m && m[1].length <= indent) break;
    if (/^\S/.test(lines[end]) && !lines[end].startsWith("#")) break;
    end++;
  }
  let sawUrl = false;
  let sawRetrieved = false;
  for (let i = start; i < end; i++) {
    const urlLine = lines[i].match(/^(\s*(?:-\s+)?)url:(\s*)\S.*$/);
    if (urlLine) {
      lines[i] = `${urlLine[1]}url:${urlLine[2] || " "}${yamlScalar(url)}`;
      sawUrl = true;
      continue;
    }
    const dateLine = lines[i].match(/^(\s*(?:-\s+)?)retrieved:(\s*)\S.*$/);
    if (dateLine) {
      lines[i] = `${dateLine[1]}retrieved:${dateLine[2] || " "}${retrieved}`;
      sawRetrieved = true;
    }
  }
  if (!sawUrl || !sawRetrieved) throw new Error(`${id}: entry has no single-line url/retrieved to update`);
  return lines.join("\n");
}

type Entry = Record<string, unknown>;

function verify(before: string, after: string, { id, url, retrieved }: UrlUpdate) {
  const a = parse(before) as Entry[];
  const b = parse(after) as Entry[];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) throw new Error(`${id}: edit changed the number of entries`);
  for (let i = 0; i < a.length; i++) {
    const expected = a[i].id === id ? { ...a[i], url, retrieved } : a[i];
    // `retrieved` parses as a string in our files (YAML 1.2 core schema), so a JSON comparison is exact.
    if (JSON.stringify(normalise(expected)) !== JSON.stringify(normalise(b[i]))) throw new Error(`${id}: edit changed more than url/retrieved`);
  }
}

function normalise(entry: Entry): Entry {
  return Object.fromEntries(
    Object.entries(entry)
      .map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v] as const)
      .sort(([x], [y]) => x.localeCompare(y)),
  );
}

const section = z.object({ h: z.string(), hash: z.string(), words: z.number().int().nonnegative() }).strict();

const sourceState = z
  .object({
    url: z.string(),
    finalUrl: z.string().optional(),
    status: z.enum(["ok", "broken", "unverifiable"]),
    httpStatus: z.number().int().optional(),
    title: z.string().optional(),
    contentHash: z.string().optional(),
    words: z.number().int().nonnegative().optional(),
    sections: z.array(section).optional(),
    updated: z.string().optional(),
    learn: z
      .object({ repo: z.string().optional(), branch: z.string().optional(), path: z.string(), commit: z.string().optional(), documentId: z.string().optional() })
      .strict()
      .optional(),
    terms: z.array(z.string()).optional(),
    versions: z.array(z.string()).optional(),
    retired: z.string().optional(),
  })
  .strict();

/** Shape of `watch/state.json`. Unknown keys are rejected so a corrupted or tampered file fails loudly. */
export const stateSchema = z
  .object({
    version: z.literal(1),
    sources: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/), sourceState),
    neighbours: z.record(z.string(), z.array(z.string())).default({}),
    feeds: z.record(z.string(), z.object({ latest: z.string() }).strict()).default({}),
  })
  .strict();

export function emptyState(): WatchState {
  return { version: 1, sources: {}, neighbours: {}, feeds: {} };
}

/** Read the committed baseline; a missing file is an empty baseline (first run). */
export function readState(path: string): WatchState {
  if (!existsSync(path)) return emptyState();
  const parsed = stateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${path}: not a valid version 1 watch state: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return parsed.data as WatchState;
}

export function writeState(path: string, state: WatchState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableStringify(state));
}
