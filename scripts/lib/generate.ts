/**
 * Running an OSCAL generator by hand (`pnpm ism:build`, `pnpm essentials:build`): read the release files from GitHub
 * or a copy on disk, build, and write both generated files. The nightly guidance update runs the same generators
 * through scripts/guidance/oscal.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { keepRetrievalDate, today } from "./dates";
import { createReleaseGitHub } from "./github";
import { repoPath } from "./repo";
import type { OscalUpstream } from "./upstreams";
import { parseIdList } from "./text";

export interface OscalGenerator {
  /** Files the generator reads from the root of a release tag, passed to `build` keyed by name. */
  files: string[];
  /** Release file texts in, both generated files' text out. Throws when a file doesn't parse, so a shape change stops for a human. */
  build(files: Record<string, string>, opts: { tag: string; retrieved: string }): { yaml: string; ids: string };
}

export async function generate(
  upstream: OscalUpstream,
  gen: OscalGenerator,
  opts: { tag: string; retrieved?: string; read?: (name: string) => string },
): Promise<void> {
  const files: Record<string, string> = {};
  const gh = createReleaseGitHub();
  for (const name of gen.files) files[name] = opts.read ? opts.read(name) : await gh.raw(upstream.repo, opts.tag, name);
  const { yaml, ids } = gen.build(files, { tag: opts.tag, retrieved: opts.retrieved ?? today() });
  const yamlPath = repoPath(upstream.frameworkFile);
  // A rerun that changes nothing but the fetch date keeps the date already in the file, so it is a true no-op.
  writeFileSync(yamlPath, keepRetrievalDate(yaml, existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : undefined));
  writeFileSync(repoPath(upstream.idsFile), ids);
  console.log(`${upstream.frameworkFile}: ${yaml.split("\n").filter((l) => l.startsWith("  - id: ")).length} controls`);
  console.log(`${upstream.idsFile}: ${parseIdList(ids).length} pinned ids`);
}
