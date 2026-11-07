import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ISO_DATE } from "../../src/format/vocab";
import type { FeedMemo, SourceMemo, WatchCache } from "./types";
import { stableStringify } from "./util";

const SAFE = /^[a-z0-9][a-z0-9-]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/**
 * One cache file: an object keyed by safe ids, each value kept only when `accept` returns one. The cache comes back
 * from the Actions cache, so anything malformed (or a missing file on a cold cache) is dropped rather than trusted.
 */
function readRecord<T>(path: string, accept: (v: unknown, key: string) => T | undefined, keyPattern = SAFE): Record<string, T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  const out: Record<string, T> = {};
  if (parsed && typeof parsed === "object")
    for (const [k, v] of Object.entries(parsed)) {
      const kept = keyPattern.test(k) ? accept(v, k) : undefined;
      if (kept !== undefined) out[k] = kept;
    }
  return out;
}

const count = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);
const date = (v: unknown) => (typeof v === "string" && ISO_DATE.test(v) ? v : undefined);

function sourceMemo(v: unknown): SourceMemo | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  const memo: SourceMemo = {};
  if (typeof m.url === "string" && m.url.startsWith("https://")) memo.url = m.url;
  if (typeof m.commit === "string" && /^[0-9a-f]{40}$/.test(m.commit)) memo.commit = m.commit;
  for (const k of ["template", "last", "reported"] as const) if (typeof m[k] === "string" && /^[a-z0-9-]+$/.test(m[k] as string)) memo[k] = m[k] as string;
  return memo;
}

function feedMemo(v: unknown): FeedMemo | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  const memo: FeedMemo = {};
  if (typeof m.lastRead === "string" && ISO.test(m.lastRead)) memo.lastRead = m.lastRead;
  if (m.reported && typeof m.reported === "object")
    memo.reported = Object.fromEntries(Object.entries(m.reported).filter(([key, at]) => /^[a-z0-9]+$/.test(key) && typeof at === "string" && ISO.test(at)));
  return memo;
}

/**
 * File-backed cache restored from and saved to the Actions cache between runs:
 * `snapshots/<source id>/<hash>.txt` holds page text for diffs, `failures.json` and `unverified.json` count
 * consecutive bad runs, `first-seen.json` remembers when a proposed edit first appeared, and `sources.json` holds each
 * source's memo (the URL its counters belong to, its last Learn commit and page hash, a held template hash), and
 * `feeds.json` each feed's memo (what was read and reported last time).
 */
export function openCache(dir: string): WatchCache {
  const snapshots = join(dir, "snapshots");
  const failures = readRecord(join(dir, "failures.json"), count);
  const unverified = readRecord(join(dir, "unverified.json"), count);
  // Keys here are `moved:<id>:<url>` and `failures:<id>`, not plain ids.
  const seen = readRecord(join(dir, "first-seen.json"), date, /^/);
  const counted = readRecord(join(dir, "counted.json"), date, /^/);
  const memos = readRecord(join(dir, "sources.json"), sourceMemo);
  const feeds = readRecord(join(dir, "feeds.json"), feedMemo);
  const used = new Set<string>();

  const file = (id: string, hash: string) => {
    if (!SAFE.test(id) || !/^[a-z0-9-]+$/.test(hash)) throw new Error(`unsafe cache key ${id}/${hash}`);
    return join(snapshots, id, `${hash}.txt`);
  };

  return {
    failures,
    unverified,
    memos,
    feeds,
    firstSeen(key, date) {
      used.add(key);
      return (seen[key] ??= date);
    },
    bump(counter, id, date) {
      const map = counter === "failures" ? failures : unverified;
      const key = `${counter}:${id}`;
      if (counted[key] !== date) {
        map[id] = (map[id] ?? 0) + 1;
        counted[key] = date;
      }
      return map[id] ?? 0;
    },
    forget(id) {
      delete failures[id];
      delete unverified[id];
      delete counted[`failures:${id}`];
      delete counted[`unverified:${id}`];
    },
    readSnapshot(id, hash) {
      try {
        return readFileSync(file(id, hash), "utf8");
      } catch {
        // A snapshot pruned or never cached: the change is compared without the old text.
        return undefined;
      }
    },
    writeSnapshot(id, hash, text) {
      const path = file(id, hash);
      mkdirSync(join(snapshots, id), { recursive: true });
      writeFileSync(path, text);
    },
    prune(keep) {
      if (!existsSync(snapshots)) return;
      for (const id of readdirSync(snapshots)) {
        const wanted = new Set(keep[id] ?? []);
        const folder = join(snapshots, id);
        if (wanted.size === 0) {
          rmSync(folder, { recursive: true, force: true });
          continue;
        }
        for (const name of readdirSync(folder)) if (!wanted.has(name.replace(/\.txt$/, ""))) rmSync(join(folder, name), { force: true });
      }
    },
    save() {
      mkdirSync(dir, { recursive: true });
      const positive = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v > 0));
      writeFileSync(join(dir, "failures.json"), stableStringify(positive(this.failures)));
      writeFileSync(join(dir, "unverified.json"), stableStringify(positive(this.unverified)));
      const live = (k: string) => (k.startsWith("failures:") ? this.failures : this.unverified)[k.slice(k.indexOf(":") + 1)] > 0;
      writeFileSync(join(dir, "counted.json"), stableStringify(Object.fromEntries(Object.entries(counted).filter(([k]) => live(k)))));
      writeFileSync(join(dir, "sources.json"), stableStringify(Object.fromEntries(Object.entries(this.memos).filter(([, m]) => Object.keys(m).length))));
      writeFileSync(join(dir, "feeds.json"), stableStringify(this.feeds));
      // Keep only dates still in use, so a fix that is merged and later needed again gets a fresh date.
      writeFileSync(join(dir, "first-seen.json"), stableStringify(Object.fromEntries(Object.entries(seen).filter(([k]) => used.has(k)))));
    },
  };
}
