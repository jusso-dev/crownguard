import type { Catalogue, ImportMapping } from "../../src/content/schema";
import type { Finding } from "./types";

/** Upstream check list for one import mapping, injected by the watch run or a test. */
export interface UpstreamChecks {
  /** Import mapping id, e.g. `m365-secure`. */
  mappingId: string;
  /** Check ids currently published upstream. */
  ids: Iterable<string>;
}

/** Strip a ScubaGoggles policy version suffix (`GWS.GMAIL.7.3v1` → `GWS.GMAIL.7.3`). */
export function scubaBaseId(id: string): string {
  return id.replace(/v\d+$/i, "");
}

/** Family used to suggest new checks near ones already mapped (M365 `ENTRA-ENTAPP-*`, Prowler `backup_*`). */
export function checkFamily(id: string): string {
  const m365 = id.match(/^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-\d+/);
  if (m365) return m365[1];
  const prowler = id.match(/^([a-z][a-z0-9]*)_/);
  if (prowler) return prowler[1];
  // Product family only (`GWS.GMAIL`), so a new policy in the same product is a suggestion.
  const scuba = id.match(/^(GWS\.[A-Z]+)/i);
  if (scuba) return scuba[1].toUpperCase();
  return id;
}

/** Check ids from an M365-Secure `docs/CHECKS.md` table. */
export function parseM365ChecksMd(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([A-Z][A-Z0-9-]+)\s*\|/);
    if (m && m[1].toLowerCase() !== "check id") ids.push(m[1]);
  }
  return ids;
}

/** One id per non-comment line (Prowler / ScubaGoggles pin files). */
export function parseIdList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * Compare crownguard's import mappings with upstream check lists. Missing mapped ids are actionable; new checks in a
 * family that already has mappings are suggestions. `baseId` normalises ids before comparison (Scuba version suffixes).
 */
export function checkMappingDrift(
  catalogue: Catalogue,
  upstream: UpstreamChecks[],
  opts: { baseId?: (mappingId: string, id: string) => string } = {},
): Finding[] {
  const findings: Finding[] = [];
  for (const u of upstream) {
    const mapping = catalogue.imports.get(u.mappingId);
    if (!mapping) {
      findings.push({
        kind: "mapping",
        title: u.mappingId,
        url: "",
        actionable: false,
        detail: `No import mapping named ${u.mappingId} in content/imports.`,
        citedBy: [],
      });
      continue;
    }
    const base = (id: string) => opts.baseId?.(u.mappingId, id) ?? id;
    const upstreamSet = new Set([...u.ids].map(base));
    const mappedByCheck = new Map<string, string[]>();
    for (const row of mapping.mappings) {
      for (const check of row.checks) {
        const key = base(check);
        const list = mappedByCheck.get(key) ?? [];
        list.push(row.question);
        mappedByCheck.set(key, list);
      }
    }
    const mappedFamilies = new Set([...mappedByCheck.keys()].map(checkFamily));

    for (const [check, questions] of [...mappedByCheck.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (upstreamSet.has(check)) continue;
      findings.push({
        kind: "mapping",
        title: `${mapping.name}: ${check} removed upstream`,
        url: mapping.url,
        actionable: true,
        detail: `Mapped check ${check} is gone from upstream; used by ${questions.join(", ")} in content/imports/${mappingFile(mapping)}.`,
        citedBy: questions,
      });
    }

    for (const raw of [...u.ids].sort()) {
      const check = base(raw);
      if (mappedByCheck.has(check)) continue;
      const family = checkFamily(check);
      if (!mappedFamilies.has(family)) continue;
      findings.push({
        kind: "mapping",
        title: `${mapping.name}: new ${check}`,
        url: mapping.url,
        actionable: true,
        detail: `New upstream check ${raw} in mapped family ${family}; consider adding it to content/imports/${mappingFile(mapping)}.`,
        citedBy: [],
      });
    }
  }
  return findings;
}

function mappingFile(mapping: ImportMapping): string {
  return `${mapping.id}.yaml`;
}
