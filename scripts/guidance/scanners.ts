/**
 * Updaters for the scanner check id lists in e2e/fixtures. Each list pins the ids of one scanner release, and the
 * import mapping it backs records that release as `checkedAgainst`. The list always moves to the latest release;
 * `checkedAgainst` moves only when every id the mapping uses is still there.
 */
import { parse } from "yaml";
import type { Release, ReleaseGitHub } from "../lib/github";
import { checkedAgainst, listTag, setCheckedAgainst } from "../lib/pins";
import { checkDrift, mappedChecks } from "../lib/scanner-checks";
import { parseIdList } from "../lib/text";
import { mappingFile, PROWLER, SCUBAGOGGLES, type ScannerUpstream } from "../lib/upstreams";
import type { GuidanceUpdater, ReviewItem } from "./types";

interface IdList {
  /** The pinned list, e.g. `e2e/fixtures/prowler-checks-aws.txt`. */
  file: string;
  /** The import mapping it backs, e.g. `content/imports/prowler-aws.yaml`. */
  mapping: string;
  /** Every id upstream has at `tag`. */
  fetch(gh: ReleaseGitHub, tag: string): Promise<string[]>;
  /** The comment lines at the top of the list, without the leading `# `. */
  header(release: Release): string[];
}

/** The list file's text: header comment, then the ids sorted (code-point order, like `LC_ALL=C sort`). */
export const idListText = (header: string[], ids: Iterable<string>): string =>
  `${[...header.map((l) => `# ${l}`), ...[...new Set(ids)].sort()].join("\n")}\n`;

export function scannerUpdater(def: { id: string; label: string; name: string; upstream: ScannerUpstream; lists: IdList[] }): GuidanceUpdater {
  const mappings = [...new Set(def.lists.map((l) => l.mapping))];
  return {
    id: def.id,
    label: def.label,
    name: def.name,
    repo: def.upstream.repo,
    paths: [...def.lists.map((l) => l.file), ...mappings],
    pins(ws) {
      return {
        ...Object.fromEntries(def.lists.map((l) => [l.file, listTag(ws.read(l.file))])),
        ...Object.fromEntries(mappings.map((m) => [m, checkedAgainst(ws.read(m))])),
      };
    },
    async update(ws, gh, release) {
      const files: Record<string, string> = {};
      const review: ReviewItem[] = [];
      const notes: string[] = [];
      for (const list of def.lists) {
        const before = new Set(parseIdList(ws.read(list.file)));
        const ids = new Set(await list.fetch(gh, release.tag));
        if (!ids.size) throw new Error(`${def.upstream.repo} ${release.tag}: no ids found for ${list.file}`);
        files[list.file] = idListText(list.header(release), ids);
        const doc = parse(ws.read(list.mapping)) as { mappings?: { question: string; checks: string[] }[] };
        const drift = checkDrift(mappedChecks(doc.mappings ?? []), ids, before);
        review.push(...drift.removed.map((r) => ({ ...r, file: list.mapping, reason: "removed upstream" })));
        const added = [...ids].filter((id) => !before.has(id)).length;
        const dropped = [...before].filter((id) => !ids.has(id)).length;
        notes.push(`${list.file}: ${ids.size} ids (${added} added, ${dropped} removed).`);
        if (drift.added.length) notes.push(`New in families ${list.mapping} already maps, worth a look: ${drift.added.map((i) => `\`${i}\``).join(", ")}.`);
      }
      const pinsMoved = review.length === 0;
      if (pinsMoved) for (const m of mappings) files[m] = setCheckedAgainst(ws.read(m), release.tag, { date: release.date });
      else notes.push("`checkedAgainst` stays put until the removed ids are dealt with; `pnpm test` fails until then.");
      return { files, pinsMoved, review, notes };
    },
  };
}

/**
 * Check directory names one level below each service, from a recursive listing of a Prowler provider's services
 * tree. Directories whose name has no underscore (`lib`, shared helpers) aren't checks: every Prowler check id is
 * `<service>_<what it checks>`.
 */
export const prowlerCheckIds = (tree: { path: string; type: string }[]): string[] =>
  tree
    .filter((e) => e.type === "tree" && e.path.split("/").length === 2)
    .map((e) => e.path.split("/")[1])
    .filter((name) => name.includes("_"));

/** Prowler: the check directory names under `prowler/providers/<provider>/services/<service>/`. */
export function prowlerList(repo: string, list: (typeof PROWLER)["lists"][number]): IdList {
  const base = `prowler/providers/${list.provider}`;
  return {
    file: list.file,
    mapping: mappingFile(list.mapping),
    async fetch(gh, tag) {
      const services = (await gh.dir(repo, base, tag)).find((e) => e.name === "services" && e.type === "dir");
      if (!services) throw new Error(`${repo} ${tag}: no ${base}/services`);
      return prowlerCheckIds(await gh.tree(repo, services.sha));
    },
    header: (r) => [
      `Check ids in Prowler ${list.provider} at tag ${r.tag} (${r.date}), taken from the check directory names in`,
      `https://github.com/${repo}/tree/${r.tag}/${base}/services.`,
      `One id per line. Regenerate when ${mappingFile(list.mapping)} moves to a newer Prowler.`,
    ],
  };
}

export const scubaPolicyIds = (markdown: string): string[] =>
  [...markdown.matchAll(/^#### (GWS\.[A-Z]+\.\d+\.\d+v\d+)[ \t]*$/gm)].map((m) => m[1]);

/** ScubaGoggles: every `#### GWS.<PRODUCT>.<group>.<policy>v<version>` heading in `scubagoggles/baselines/*.md`. */
export function scubaList(repo: string, list: ScannerUpstream["lists"][number]): IdList {
  const dir = "scubagoggles/baselines";
  return {
    file: list.file,
    mapping: mappingFile(list.mapping),
    async fetch(gh, tag) {
      const docs = (await gh.dir(repo, dir, tag)).filter((e) => e.type === "file" && e.name.endsWith(".md"));
      const ids: string[] = [];
      for (const d of docs) ids.push(...scubaPolicyIds(await gh.raw(repo, tag, d.path)));
      return ids;
    },
    header: (r) => [
      `Control ids in the CISA SCuBA Google Workspace baselines at ScubaGoggles tag ${r.tag} (${r.date}),`,
      "taken from the policy headings in",
      `https://github.com/${repo}/tree/${r.tag}/${dir}`,
      "(each `#### GWS.<PRODUCT>.<group>.<policy>v<version>` policy heading).",
      "One id per line, including the policy version suffix. Regenerate when",
      `${mappingFile(list.mapping)} moves to a newer ScubaGoggles release.`,
    ],
  };
}

export const prowlerUpdater = scannerUpdater({
  id: "prowler",
  label: "Prowler",
  name: "Prowler AWS and Azure check ids",
  upstream: PROWLER,
  lists: PROWLER.lists.map((l) => prowlerList(PROWLER.repo, l)),
});

export const scubaUpdater = scannerUpdater({
  id: "scubagoggles",
  label: "ScubaGoggles",
  name: "ScubaGoggles Google Workspace policy ids",
  upstream: SCUBAGOGGLES,
  lists: SCUBAGOGGLES.lists.map((l) => scubaList(SCUBAGOGGLES.repo, l)),
});
