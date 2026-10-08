import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WatchCache } from "./types";
import { stableStringify } from "./util";

const SAFE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * File-backed cache restored from and saved to the Actions cache between runs:
 * `snapshots/<source id>/<hash>.txt` holds page text for diffs, `failures.json` counts consecutive failed runs.
 */
export function openCache(dir: string): WatchCache {
  const snapshots = join(dir, "snapshots");
  const failuresFile = join(dir, "failures.json");
  let failures: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(failuresFile, "utf8"));
    if (parsed && typeof parsed === "object")
      for (const [k, v] of Object.entries(parsed)) if (SAFE.test(k) && Number.isInteger(v) && (v as number) > 0) failures[k] = v as number;
  } catch {
    failures = {};
  }

  const file = (id: string, hash: string) => {
    if (!SAFE.test(id) || !/^[a-z0-9-]+$/.test(hash)) throw new Error(`unsafe cache key ${id}/${hash}`);
    return join(snapshots, id, `${hash}.txt`);
  };

  return {
    failures,
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
      const clean = Object.fromEntries(Object.entries(this.failures).filter(([, v]) => v > 0));
      writeFileSync(failuresFile, stableStringify(clean));
    },
  };
}
