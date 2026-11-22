import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The repository root. Repo-relative paths in scripts/ (`content/frameworks/ism.yaml`) resolve against it. */
export const ROOT = join(import.meta.dirname, "..", "..");

export const repoPath = (...parts: string[]): string => join(ROOT, ...parts);

export const readRepoFile = (path: string): string => readFileSync(repoPath(path), "utf8");
