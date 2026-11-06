/**
 * Updater for a framework generated from an OSCAL catalog at a release tag (the ISM and ASD's Essentials for
 * enterprise IT). The generator owns the file format; this moves the release and the source that cites it, and lists
 * the questions whose controls the new release drops or withdraws.
 */
import { parse } from "yaml";
import { keepRetrievalDate } from "../lib/dates";
import type { OscalGenerator } from "../lib/generate";
import { headerTag, setSourceRelease, sourceReleaseTag } from "../lib/pins";
import type { OscalUpstream } from "../lib/upstreams";
import type { GuidanceUpdater, ReviewItem } from "./types";

/** Control ids in a generated framework file, live and withdrawn. */
function frameworkIds(yamlText: string): { live: Set<string>; withdrawn: Set<string> } {
  const doc = parse(yamlText) as { controls?: { id: string }[]; withdrawn?: string[] };
  return { live: new Set((doc.controls ?? []).map((c) => c.id)), withdrawn: new Set(doc.withdrawn ?? []) };
}

export function oscalUpdater(def: { id: string; label: string; name: string; upstream: OscalUpstream; generator: OscalGenerator }): GuidanceUpdater {
  const { upstream: u, generator } = def;
  return {
    id: def.id,
    label: def.label,
    name: def.name,
    repo: u.repo,
    paths: [u.frameworkFile, u.idsFile, ...(u.source ? [u.source.file] : [])],
    pins(ws) {
      return {
        [u.frameworkFile]: headerTag(ws.read(u.frameworkFile)),
        [u.idsFile]: headerTag(ws.read(u.idsFile)),
        ...(u.source ? { [`${u.source.file}#${u.source.id}`]: sourceReleaseTag(ws.read(u.source.file), u.source.id) } : {}),
      };
    },
    async update(ws, gh, release, from) {
      const previousYaml = ws.read(u.frameworkFile);
      const inputs: Record<string, string> = {};
      for (const name of generator.files) inputs[name] = await gh.raw(u.repo, release.tag, name);
      const built = generator.build(inputs, { tag: release.tag, retrieved: ws.today });
      const yaml = keepRetrievalDate(built.yaml, previousYaml);
      const files: Record<string, string> = { [u.frameworkFile]: yaml, [u.idsFile]: built.ids };
      if (u.source) files[u.source.file] = setSourceRelease(ws.read(u.source.file), u.source.id, release.tag, ws.today);
      const before = frameworkIds(previousYaml);
      const after = frameworkIds(yaml);
      const citing = ws.citing(u.framework);
      const review: ReviewItem[] = [...before.live]
        .sort()
        .filter((id) => !after.live.has(id) && citing.get(id)?.length)
        .map((id) => ({ id, file: u.frameworkFile, questions: citing.get(id)!, reason: after.withdrawn.has(id) ? "withdrawn in this release" : "gone from the catalog" }));
      const added = [...after.live].filter((id) => !before.live.has(id)).length;
      const gone = [...before.live].filter((id) => !after.live.has(id)).length;
      const notes = [
        `${u.frameworkFile}: ${after.live.size} controls (${added} added, ${gone} dropped or withdrawn since ${from}).`,
        "Read the release notes for amended controls, then re-read the questions mapped to them (see docs/content-guide.md).",
      ];
      // The generated files are the pins, so they always move; questions citing a dropped control only warn.
      return { files, pinsMoved: true, review, notes };
    },
  };
}
