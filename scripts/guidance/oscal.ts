/**
 * Updater for a framework generated from an OSCAL catalog at a release tag (the ISM and ASD's Essentials for
 * enterprise IT). The generator owns the file format; this moves the release, the feed pin and the source
 * that cites the release, and lists the questions whose controls the new release drops or withdraws.
 */
import { parse } from "yaml";
import type { Release } from "./github";
import { feedPin, headerTag, setFeedPin, setSourceRelease, sourceReleaseTag } from "./pins";
import { FEEDS_FILE, type GuidanceUpdater, type ReviewItem } from "./types";

export interface OscalSource {
  id: string;
  label: string;
  name: string;
  /** GitHub repo publishing the catalog as releases, e.g. `AustralianCyberSecurityCentre/ism-oscal`. */
  repo: string;
  /**
   * Files the generator reads from the root of each release tag: `ISM_catalog.json` for the ISM; the catalog, mapping
   * collection and domain profiles for Essentials. Passed to `build` keyed by name.
   */
  files: string[];
  /** Framework id the questions cite (`ism`). */
  framework: string;
  /** The generated framework file, carrying `at release tag <tag>` in its header. */
  frameworkFile: string;
  /** The generated id list, carrying the same tag in its header. */
  idsFile: string;
  /** Feed in scripts/watch/feeds.ts whose `reviewMapping.pinned` follows the release. */
  feed?: string;
  /** The content/sources entry that links the release page (`.../releases/tag/<tag>`). */
  source?: { file: string; id: string };
  /**
   * The generator: release file texts (by name) in, both files' text out. `previousYaml` lets it keep the retrieval date when
   * nothing else moved. Throws when the catalog doesn't parse, so a shape change stops the run for a human.
   */
  build(files: Record<string, string>, opts: { tag: string; retrieved: string; previousYaml?: string }): { yaml: string; ids: string };
}

/** Control ids in a generated framework file, live and withdrawn. */
export function frameworkIds(yamlText: string): { live: Set<string>; withdrawn: Set<string> } {
  const doc = parse(yamlText) as { controls?: { id: string }[]; withdrawn?: string[] };
  return { live: new Set((doc.controls ?? []).map((c) => c.id)), withdrawn: new Set(doc.withdrawn ?? []) };
}

/** Controls a question cites that the new release drops or withdraws. */
export function droppedControls(
  before: ReturnType<typeof frameworkIds>,
  after: ReturnType<typeof frameworkIds>,
  citing: Map<string, string[]>,
  file: string,
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const id of [...before.live].sort()) {
    if (after.live.has(id)) continue;
    const questions = citing.get(id);
    if (!questions?.length) continue;
    out.push({ id, file, questions, reason: after.withdrawn.has(id) ? "withdrawn in this release" : "gone from the catalog" });
  }
  return out;
}

export function oscalUpdater(def: OscalSource): GuidanceUpdater {
  return {
    id: def.id,
    label: def.label,
    name: def.name,
    repo: def.repo,
    feed: def.feed,
    paths: [def.frameworkFile, def.idsFile, ...(def.feed ? [FEEDS_FILE] : []), ...(def.source ? [def.source.file] : [])],
    pins(ws) {
      return {
        [def.frameworkFile]: headerTag(ws.read(def.frameworkFile)),
        [def.idsFile]: headerTag(ws.read(def.idsFile)),
        ...(def.feed ? { [`${FEEDS_FILE}#${def.feed}`]: feedPin(ws.read(FEEDS_FILE), def.feed) } : {}),
        ...(def.source ? { [`${def.source.file}#${def.source.id}`]: sourceReleaseTag(ws.read(def.source.file), def.source.id) } : {}),
      };
    },
    async update(ws, gh, release: Release, from) {
      const previousYaml = ws.read(def.frameworkFile);
      const inputs: Record<string, string> = {};
      for (const name of def.files) inputs[name] = await gh.raw(def.repo, release.tag, name);
      const { yaml, ids } = def.build(inputs, { tag: release.tag, retrieved: ws.today, previousYaml });
      const files: Record<string, string> = { [def.frameworkFile]: yaml, [def.idsFile]: ids };
      if (def.feed) files[FEEDS_FILE] = setFeedPin(ws.read(FEEDS_FILE), def.feed, release.tag);
      if (def.source) {
        const text = ws.read(def.source.file);
        files[def.source.file] = setSourceRelease(text, def.source.id, sourceReleaseTag(text, def.source.id), release.tag, ws.today);
      }
      const before = frameworkIds(previousYaml);
      const after = frameworkIds(yaml);
      const review = droppedControls(before, after, ws.citing(def.framework), def.frameworkFile);
      const added = [...after.live].filter((id) => !before.live.has(id)).length;
      const gone = [...before.live].filter((id) => !after.live.has(id)).length;
      const notes = [
        `${def.frameworkFile}: ${after.live.size} controls (${added} added, ${gone} dropped or withdrawn since ${from}).`,
        "Read the release notes for amended controls, then re-read the questions mapped to them (see docs/content-guide.md).",
      ];
      // The generated files are the pins, so they always move; questions citing a dropped control only warn.
      return { files, pinsMoved: true, review, notes };
    },
  };
}
