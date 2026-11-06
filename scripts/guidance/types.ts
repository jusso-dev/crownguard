import type { Release, ReleaseGitHub } from "../lib/github";

/** What an updater can see of the checkout. Paths are relative to the repo root. */
export interface Workspace {
  read(path: string): string;
  /** Question ids citing each ref of a framework (`ISM-1504` → `[GO-ID-002, ...]`). */
  citing(framework: string): Map<string, string[]>;
  /** The run date, YYYY-MM-DD. */
  today: string;
}

/** Something a maintainer has to look at before the pull request can merge. */
export interface ReviewItem {
  /** The check, policy or control id. */
  id: string;
  /** The file that still uses it. */
  file: string;
  questions: string[];
  reason: string;
}

export interface UpdateResult {
  /** Full intended text of every file the updater touches; the run drops the ones that come out unchanged. */
  files: Record<string, string>;
  /** False when the pins (`checkedAgainst`) stayed put because something needs review first. */
  pinsMoved: boolean;
  review: ReviewItem[];
  /** Things worth reading in the pull request that don't block it. */
  notes: string[];
}

/**
 * One upstream source of machine-readable guidance. To add one, describe the upstream in scripts/lib/upstreams.ts,
 * write an entry in `registry.ts` and list its files in the `add-paths` of .github/workflows/guidance-update.yml.
 * `scripts/guidance/run.test.ts` checks the two lists agree.
 */
export interface GuidanceUpdater {
  /** Short id for `--only` (`ism`, `prowler`). */
  id: string;
  /** Short name for the PR title (`ISM`, `Prowler`). */
  label: string;
  /** What gets regenerated, for the PR body. */
  name: string;
  /** GitHub repo the releases come from. */
  repo: string;
  /** Every repo file this updater may write. The apply step and the workflow's `add-paths` allow nothing else. */
  paths: string[];
  /** The committed pins, keyed by where each lives. The oldest one is the current version. */
  pins(ws: Workspace): Record<string, string>;
  /** Regenerate everything for `release`. `from` is the current version. */
  update(ws: Workspace, gh: ReleaseGitHub, release: Release, from: string): Promise<UpdateResult>;
}
