/**
 * Updaters for the scanner check id lists in e2e/fixtures. Each list pins the ids of one scanner release, and the
 * import mapping it backs records that release as `checkedAgainst`. The list always moves to the latest release;
 * `checkedAgainst` and the feed pin move only when every id the mapping uses is still there.
 */
import { parse } from "yaml";
import { checkFamily } from "../watch/mappings";
import type { GuidanceGitHub, Release } from "./github";
import { checkedAgainst, feedPin, listTag, setCheckedAgainst, setFeedPin } from "./pins";
import { FEEDS_FILE, type GuidanceUpdater, type ReviewItem } from "./types";

export interface IdList {
  /** The pinned list, e.g. `e2e/fixtures/prowler-checks-aws.txt`. */
  file: string;
  /** The import mapping it backs, e.g. `content/imports/prowler-aws.yaml`. */
  mapping: string;
  /** Every id upstream has at `tag`. */
  fetch(gh: GuidanceGitHub, tag: string): Promise<string[]>;
  /** The comment lines at the top of the list, without the leading `# `. */
  header(release: Release): string[];
}

/** The list file's text: header comment, then the ids sorted (code-point order, like `LC_ALL=C sort`). */
export const idListText = (header: string[], ids: Iterable<string>): string =>
  `${[...header.map((l) => `# ${l}`), ...[...new Set(ids)].sort()].join("\n")}\n`;

/** Check id → questions that use it, from an import mapping's YAML. */
export function mappedChecks(yamlText: string): Map<string, string[]> {
  const doc = parse(yamlText) as { mappings?: { question: string; checks: string[] }[] };
  const out = new Map<string, string[]>();
  for (const row of doc.mappings ?? []) for (const c of row.checks) out.set(c, [...(out.get(c) ?? []), row.question]);
  return out;
}

/** Mapped ids gone from `upstream`: these block the pin bump. */
export function removedChecks(mapped: Map<string, string[]>, upstream: Set<string>, file: string): ReviewItem[] {
  return [...mapped]
    .filter(([id]) => !upstream.has(id))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, questions]) => ({ id, file, questions, reason: "removed upstream" }));
}

/** New upstream ids in a family the mapping already uses: worth a look, never blocking. */
export function newInMappedFamilies(mapped: Map<string, string[]>, before: Set<string>, after: Set<string>): string[] {
  const families = new Set([...mapped.keys()].map(checkFamily));
  return [...after].filter((id) => !before.has(id) && !mapped.has(id) && families.has(checkFamily(id))).sort();
}

const parseIds = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

export function scannerUpdater(def: { id: string; label: string; name: string; repo: string; feed: string; lists: IdList[] }): GuidanceUpdater {
  const mappings = [...new Set(def.lists.map((l) => l.mapping))];
  return {
    id: def.id,
    label: def.label,
    name: def.name,
    repo: def.repo,
    feed: def.feed,
    paths: [...def.lists.map((l) => l.file), ...mappings, FEEDS_FILE],
    pins(ws) {
      return {
        ...Object.fromEntries(def.lists.map((l) => [l.file, listTag(ws.read(l.file))])),
        ...Object.fromEntries(mappings.map((m) => [m, checkedAgainst(ws.read(m))])),
        [`${FEEDS_FILE}#${def.feed}`]: feedPin(ws.read(FEEDS_FILE), def.feed),
      };
    },
    async update(ws, gh, release) {
      const files: Record<string, string> = {};
      const review: ReviewItem[] = [];
      const notes: string[] = [];
      for (const list of def.lists) {
        const before = new Set(parseIds(ws.read(list.file)));
        const ids = new Set(await list.fetch(gh, release.tag));
        if (!ids.size) throw new Error(`${def.repo} ${release.tag}: no ids found for ${list.file}`);
        files[list.file] = idListText(list.header(release), ids);
        const mapped = mappedChecks(ws.read(list.mapping));
        review.push(...removedChecks(mapped, ids, list.mapping));
        const added = [...ids].filter((id) => !before.has(id)).length;
        const dropped = [...before].filter((id) => !ids.has(id)).length;
        notes.push(`${list.file}: ${ids.size} ids (${added} added, ${dropped} removed).`);
        const fresh = newInMappedFamilies(mapped, before, ids);
        if (fresh.length) notes.push(`New in families ${list.mapping} already maps, worth a look: ${fresh.map((i) => `\`${i}\``).join(", ")}.`);
      }
      const pinsMoved = review.length === 0;
      if (!pinsMoved) notes.push(`\`checkedAgainst\` and the ${def.feed} feed pin stay put until the removed ids are dealt with; \`pnpm test\` fails until then.`);
      if (pinsMoved) {
        for (const m of mappings) files[m] = setCheckedAgainst(ws.read(m), release.tag, { date: release.date });
        files[FEEDS_FILE] = setFeedPin(ws.read(FEEDS_FILE), def.feed, release.tag);
      }
      return { files, pinsMoved, review, notes };
    },
  };
}

/** Prowler: the check directory names under `prowler/providers/<provider>/services/<service>/`. */
export function prowlerList(repo: string, provider: "aws" | "azure"): IdList {
  const base = `prowler/providers/${provider}`;
  return {
    file: `e2e/fixtures/prowler-checks-${provider}.txt`,
    mapping: `content/imports/prowler-${provider}.yaml`,
    async fetch(gh, tag) {
      const services = (await gh.dir(repo, base, tag)).find((e) => e.name === "services" && e.type === "dir");
      if (!services) throw new Error(`${repo} ${tag}: no ${base}/services`);
      return prowlerCheckIds(await gh.tree(repo, services.sha));
    },
    header: (r) => [
      `Check ids in Prowler ${provider} at tag ${r.tag} (${r.date}), taken from the check directory names in`,
      `https://github.com/${repo}/tree/${r.tag}/${base}/services.`,
      `One id per line. Regenerate when content/imports/prowler-${provider}.yaml moves to a newer Prowler.`,
    ],
  };
}

/** Directory names one level below each service, from a recursive listing of the services tree. */
export const prowlerCheckIds = (tree: { path: string; type: string }[]): string[] =>
  tree.filter((e) => e.type === "tree" && e.path.split("/").length === 2).map((e) => e.path.split("/")[1]);

/** ScubaGoggles: every `#### GWS.<PRODUCT>.<group>.<policy>v<version>` heading in `scubagoggles/baselines/*.md`. */
export function scubaList(repo: string): IdList {
  const dir = "scubagoggles/baselines";
  return {
    file: "e2e/fixtures/scubagoggles-controls.txt",
    mapping: "content/imports/scubagoggles.yaml",
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
      "content/imports/scubagoggles.yaml moves to a newer ScubaGoggles release.",
    ],
  };
}

export const scubaPolicyIds = (markdown: string): string[] =>
  [...markdown.matchAll(/^#### (GWS\.[A-Z]+\.\d+\.\d+v\d+)[ \t]*$/gm)].map((m) => m[1]);
