import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedMemo, SourceMemo, WatchCache } from "./types";
import { stableStringify } from "./util";

const SAFE = /^[a-z0-9][a-z0-9-]*$/;

function readCounters(path: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const out: Record<string, number> = {};
    if (parsed && typeof parsed === "object")
      for (const [k, v] of Object.entries(parsed)) if (SAFE.test(k) && Number.isInteger(v) && (v as number) > 0) out[k] = v as number;
    return out;
  } catch {
    return {};
  }
}

function readDates(path: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const out: Record<string, string> = {};
    if (parsed && typeof parsed === "object")
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function readMemos(path: string): Record<string, SourceMemo> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const out: Record<string, SourceMemo> = {};
    if (parsed && typeof parsed === "object")
      for (const [k, v] of Object.entries(parsed)) {
        if (!SAFE.test(k) || !v || typeof v !== "object") continue;
        const m = v as Record<string, unknown>;
        const memo: SourceMemo = {};
        if (typeof m.url === "string" && m.url.startsWith("https://")) memo.url = m.url;
        if (typeof m.commit === "string" && /^[0-9a-f]{40}$/.test(m.commit)) memo.commit = m.commit;
        for (const k of ["template", "last", "reported"] as const) if (typeof m[k] === "string" && /^[a-z0-9-]+$/.test(m[k] as string)) memo[k] = m[k] as string;
        out[k] = memo;
      }
    return out;
  } catch {
    return {};
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function readFeedMemos(path: string): Record<string, FeedMemo> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const out: Record<string, FeedMemo> = {};
    if (parsed && typeof parsed === "object")
      for (const [k, v] of Object.entries(parsed)) {
        if (!SAFE.test(k) || !v || typeof v !== "object") continue;
        const m = v as Record<string, unknown>;
        const memo: FeedMemo = {};
        if (typeof m.lastRead === "string" && ISO.test(m.lastRead)) memo.lastRead = m.lastRead;
        if (m.reported && typeof m.reported === "object")
          memo.reported = Object.fromEntries(Object.entries(m.reported).filter(([key, at]) => /^[a-z0-9]+$/.test(key) && typeof at === "string" && ISO.test(at)));
        out[k] = memo;
      }
    return out;
  } catch {
    return {};
  }
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
  const failures = readCounters(join(dir, "failures.json"));
  const unverified = readCounters(join(dir, "unverified.json"));
  const seen = readDates(join(dir, "first-seen.json"));
  const counted = readDates(join(dir, "counted.json"));
  const memos = readMemos(join(dir, "sources.json"));
  const feeds = readFeedMemos(join(dir, "feeds.json"));
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
